@file:JvmName("PubbaGuide")

package com.tharinduathapaththu.pubba

/** The headless guide (SPEC section 9): replies, chips, the trail and nudges, with no UI. */

public val DEFAULT_GUIDE_TEMPLATES: Map<String, String> = mapOf(
    "open" to "Here's {item}.",
    "similar" to "{reason}",
    "none" to "I couldn't find that here. These might help:",
    "notHere" to "{name} isn't here. These might help:",
    "start" to "Where would you like to start?",
    "nudge" to "{reason} Want a look?",
)

private val TOKEN = Regex("""\{(\w+)\}""")

/** A follow-up button: a place to go, or a question to ask the guide. */
public sealed interface Chip {
    public val label: String
}

/** A place to go, with why. */
public data class EntityChip @JvmOverloads constructor(
    val id: String,
    override val label: String,
    val reason: Reason,
    val text: String,
    val url: String? = null,
) : Chip

/** A question to ask the guide (`guide.ask(question)` when tapped). */
public data class QuestionChip @JvmOverloads constructor(override val label: String, val question: String = label) : Chip

/** Navigate to an entity: `url` is the route the guide's `route` gave it, if any. */
public data class Action @JvmOverloads constructor(val id: String, val url: String? = null, val type: String = "open")

/** A reply: `kind` is "open", "similar", "none", "not-here" or "start". Show `text` and `chips`; perform `action`. */
public data class Reply @JvmOverloads constructor(
    val kind: String,
    val text: String,
    val chips: List<Chip> = emptyList(),
    val action: Action? = null,
    val match: Match? = null,
    val similar: List<EntityChip>? = null,
)

public data class NudgePolicy @JvmOverloads constructor(val delayMs: Double = 9000.0, val gapMs: Double = 60000.0, val minScore: Double = 0.3)

/** What a fallback is asked for: kind "start", "none", "not-here", "open" (with the entity) or "chips". */
public data class FallbackContext(val kind: String, val entity: Entity? = null)

/** Everything a guide can be told. All optional. */
public class GuideOptions {
    /** The visitor's trail; give it a [TrailStorage] to keep it between launches. */
    public var trail: Trail? = null

    /** Where an entity lives in this site or app (a url, a route, a deep link). Default: the entity's url. */
    public var route: ((Entity) -> String?)? = null

    /** How many chips a reply carries. */
    public var chips: Int = 3

    public var nudge: NudgePolicy = NudgePolicy()

    /** Which suggestions a nudge prefers. Default: those with a route. */
    public var prefer: ((Entity) -> Boolean)? = null

    /** Which entities the guide may offer at all. */
    public var accept: ((Entity) -> Boolean)? = null

    /** Chips for when nothing is suggested: question chips, or places. Null for the default starters. */
    public var fallback: ((FallbackContext) -> List<Chip>?)? = null

    /** A short line about an entity, for the `{line}` token. */
    public var line: ((Entity) -> String?)? = null

    /** Words: override any of [DEFAULT_GUIDE_TEMPLATES], or add `open.<type>`, `nudge.<type>`, `similar.<type>`. */
    public var templates: Map<String, String> = emptyMap()

    /** The clock, in milliseconds. */
    public var now: (() -> Double)? = null
}

private fun fill(text: String, values: Map<String, String>): String = collapse(TOKEN.replace(text) { values[it.groupValues[1]] ?: "" })

/** The navigator: a typed question becomes a reply; steps are recorded; nudges come at the right moments. */
public class Guide @JvmOverloads constructor(public val pubba: Pubba, options: GuideOptions = GuideOptions()) {
    public val trail: Trail = options.trail ?: Trail()
    public val nudgePolicy: NudgePolicy = options.nudge
    private val route: (Entity) -> String? = options.route ?: { it.url }
    private val limit = options.chips
    private val prefer: (Entity) -> Boolean = options.prefer ?: { route(it) != null }
    private val accept = options.accept
    private val fallback = options.fallback
    private val line = options.line
    private val t: Map<String, String> = DEFAULT_GUIDE_TEMPLATES + options.templates
    private val now: () -> Double = options.now ?: { System.currentTimeMillis().toDouble() }
    private var lastStepAt = Double.NEGATIVE_INFINITY
    private var lastStepSelf = false
    private var lastNudgeAt = Double.NEGATIVE_INFINITY
    private val nudgedFrom = HashSet<String>()

    // --- helpers

    private fun tpl(key: String, e: Entity? = null): String = (if (e != null) t["$key.${e.type}"] else null) ?: t.getValue(key)

    private fun vars(e: Entity): Map<String, String> = mapOf("item" to e.shortLabel, "label" to e.label, "line" to (line?.invoke(e) ?: ""))

    private fun chip(e: Entity, reason: Reason, text: String) = EntityChip(e.id, e.shortLabel, reason, text, route(e))

    private fun open(e: Entity) = Action(e.id, route(e))

    private fun starters(n: Int): List<Chip> {
        val g = pubba.graph
        val es = g.entities.values.filter { g.isDestination(it) && (accept == null || accept.invoke(it)) }
        val reason = Reason("section")
        return es.sortedBy { -g.degree(it.id) }.take(n).map { chip(it, reason, pubba.explain(reason, it)) }
    }

    private fun chipsFor(n: Int, extra: List<String>, context: FallbackContext): List<Chip> {
        val out = pubba.next(trail.get() + extra, limit = n, accept = accept).map { chip(it.entity, it.reason, it.text) }
        if (out.isNotEmpty()) return out
        fallback?.invoke(context)?.let { return it.take(n) }
        return starters(n)
    }

    // --- the guide

    /** Answer a typed question. Doesn't move the visitor: perform the action, then call [follow]. */
    public fun ask(question: String): Reply {
        if (jsTrim(question).isEmpty()) return Reply("start", fill(tpl("start"), emptyMap()), chipsFor(limit, emptyList(), FallbackContext("start")))
        val m = pubba.match(question)
        if (m.intent == "none") {
            m.notHere?.let { return Reply("not-here", fill(tpl("notHere"), mapOf("name" to it)), chipsFor(limit, emptyList(), FallbackContext("not-here"))) }
            return Reply("none", fill(tpl("none"), emptyMap()), chipsFor(limit, emptyList(), FallbackContext("none")))
        }
        val entity = m.entity!!
        val similar = m.similar.filter { accept == null || accept.invoke(it.entity) }
        if (m.intent == "similar" && similar.isNotEmpty()) {
            val first = similar[0]
            val listed = similar.joinToString(", ") { r -> r.entity.label + (r.reason.via?.takeIf { it.isNotEmpty() }?.let { " (" + it.take(2).joinToString(", ") + ")" } ?: "") }
            return Reply(
                "similar",
                fill(tpl("similar", entity), vars(first.entity) + mapOf("reason" to first.text, "of" to entity.label, "list" to listed)),
                similar.drop(1).take(limit).map { chip(it.entity, it.reason, it.text) },
                open(first.entity),
                m.match,
                similar.map { chip(it.entity, it.reason, it.text) },
            )
        }
        val context = FallbackContext("open", entity)
        val chips = if (entity.id in pubba.graph.entities) {
            chipsFor(limit, listOf(entity.id), context).filter { it !is EntityChip || it.id != entity.id }
        } else {
            chipsFor(limit, emptyList(), context)
        }
        return Reply("open", fill(tpl("open", entity), vars(entity)), chips, open(entity), m.match)
    }

    /** Follow-ups for where the visitor is now. */
    @JvmOverloads
    public fun chips(limit: Int? = null): List<Chip> = chipsFor(limit ?: this.limit, emptyList(), FallbackContext("chips"))

    /** The visitor went somewhere on their own. */
    public fun visited(id: String) {
        if (pubba.graph.find(id) == null && !id.startsWith("section:")) return
        trail.record(id)
        lastStepAt = now()
        lastStepSelf = true
    }

    /** The visitor went somewhere because the guide sent them (`via`: one of [GUIDE_VIAS]). */
    public fun follow(id: String, via: String) {
        if (pubba.graph.find(id) == null) return
        trail.record(id)
        lastStepAt = now()
        lastStepSelf = false
        pubba.track.guidedTo(id, via)
    }

    /** A suggestion to show unprompted now, or null. Call it [NudgePolicy.delayMs] after a step. */
    public fun nudge(): Reply? {
        val steps = trail.get()
        val last = steps.lastOrNull()
        val at = now()
        if (last.isNullOrEmpty() || !lastStepSelf || last.startsWith("section:") || last in nudgedFrom) return null
        if (at - lastStepAt < nudgePolicy.delayMs || at - lastNudgeAt < nudgePolicy.gapMs) return null
        val options = pubba.next(steps, limit = 5, accept = accept).filter { it.reason.kind != "section" && it.score >= nudgePolicy.minScore }
        val top = options.firstOrNull { prefer(it.entity) } ?: options.firstOrNull() ?: return null
        lastNudgeAt = at
        nudgedFrom.add(last)
        return Reply(
            "open",
            fill(tpl("nudge", top.entity), vars(top.entity) + mapOf("reason" to top.text)),
            listOf(chip(top.entity, top.reason, top.text)),
            open(top.entity),
        )
    }

    public fun opened() {
        pubba.track.guideOpened()
    }

    public fun reached(goal: String) {
        pubba.track.reached(goal)
    }
}

@JvmOverloads
public fun createGuide(pubba: Pubba, options: GuideOptions = GuideOptions()): Guide = Guide(pubba, options)

/** `createGuide(pubba) { route = { "app://item/${it.id}" } }` */
public fun createGuide(pubba: Pubba, configure: GuideOptions.() -> Unit): Guide = Guide(pubba, GuideOptions().apply(configure))
