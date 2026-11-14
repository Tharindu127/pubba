@file:JvmName("PubbaRuntime")

package com.tharinduathapaththu.pubba

import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sqrt

private val DEFAULT_STOP_WORDS = listOf("the", "app", "and", "for", "web", "application", "mobile", "portal", "site", "website")
private const val DEFAULT_SIMILAR = """\b(like|similar|alike|same stack|related to|anything else)\b"""
private const val STRONG = 50.0

private class Settings(val stop: Set<String>, val typo: Double, val partial: Boolean, val precise: Boolean, val distinct: Set<String>?)

private class Scored(val score: Double, val by: String, val name: String)

private fun significant(name: String, stop: Set<String>) = name.split(" ").filter { it.length > 2 && it !in stop }

private fun coverage(q: String, name: String, typo: Double): Double {
    val nameTokens = name.split(" ")
    val queryTokens = q.split(" ")
    val inQuery = nameTokens.count { hasPhrase(q, it, typo) }.toDouble() / nameTokens.size
    val explained = queryTokens.count { t -> nameTokens.any { w -> t == w || hasPhrase(t, w, typo) } }.toDouble() / queryTokens.size
    return 0.5 * inQuery + 0.4 * explained
}

private fun scoreName(q: String, name: String, isAlias: Boolean, m: Map<String, Any?>, s: Settings): Scored? {
    if (name.isEmpty() || name.length < m.num("minLength", 0.0)) return null
    val has = { w: String -> hasPhrase(q, w, s.typo) }
    if ((m.str("mode") ?: "title") == "phrase") {
        if (name.length < 2 || !has(name)) return null
        val exact = !s.precise || containsName(q, name)
        return Scored((if (exact) 100.0 else 95.0) + name.length, if (isAlias) "alias" else "phrase", name)
    }
    if (containsName(q, name)) return Scored(100.0 + name.length, if (isAlias) "alias" else "name", name)
    if (s.precise && ' ' in name && has(name)) return Scored(95.0 + name.length, if (isAlias) "alias" else "name", name)
    val words = significant(name, s.stop)
    val hits = words.count(has)
    if (hits > 0 && hits == words.size && words.joinToString("").length > m.num("minWordsLength", 0.0)) {
        return Scored(50.0 + hits + (if (s.precise) coverage(q, name, s.typo) else 0.0), "words", name)
    }
    if (s.partial && words.size >= 3 && hits >= 2 && hits == words.size - 1) return Scored(40.0 + hits, "words", name)
    if (s.distinct != null) {
        for (w in words) if (w.length >= 5 && w in s.distinct && hasPhrase(q, w, Double.POSITIVE_INFINITY)) return Scored(25.0, "distinct-word", w)
    }
    val first = words.firstOrNull()
    if (truthy(m["firstWord"]) && first != null && first.length > 3 && has(first)) return Scored(20.0, "first-word", first)
    return null
}

/** Why an entity lights up for a trail: the strongest single contribution. */
public data class Why(val link: Link, val from: String, val seed: String, val part: Double)

/** How brightly each entity lights up for a trail. */
public data class Spread(val score: Map<String, Double>, val why: Map<String, Why>, val seeds: Map<String, Double>, val sectionOnly: Set<String>)

/** Answers from one graph: related items, what next, matching, sentences, measurement. */
public class Pubba @JvmOverloads constructor(public val graph: Graph, private val events: Events? = null) {
    public val track: Track = Track(graph, events)
    private val similarRe: Regex by lazy { Regex(graph.config.obj("match").str("similarPattern") ?: DEFAULT_SIMILAR) }

    public companion object {
        /** Answers from a compiled bundle's JSON text. From Java: `Pubba.load(json)`. */
        @JvmStatic
        @JvmOverloads
        public fun load(json: String, events: Events? = null): Pubba = Pubba(graphFromBundle(json), events)
    }

    public fun get(id: String): Entity? = graph.entities[id]

    /** The same graph, reporting to these events. */
    public fun withEvents(events: Events?): Pubba = Pubba(graph, events)

    private fun suggested(source: String, ids: List<String>, kinds: List<String>) {
        if (events != null && ids.isNotEmpty()) {
            events.emit(mapOf("type" to "suggested", "source" to source, "ids" to ids, "reasonKinds" to kinds.distinct()))
        }
    }

    // --- matching

    /** Every entity a query could mean, best first. */
    @JvmOverloads
    public fun search(query: String, limit: Int = 10, types: Collection<String>? = null, templates: Map<String, Any>? = null): List<Match> {
        val q = normalize(query)
        if (q.isEmpty()) return emptyList()
        val mc = graph.config.obj("match")
        val s = Settings(
            stop = (mc.strings("stopWords") ?: DEFAULT_STOP_WORDS).toSet(),
            typo = mc.num("typoMinLength", 4.0),
            partial = truthy(mc["partialWords"]),
            precise = truthy(mc["precise"]),
            distinct = if (truthy(mc["distinctWords"])) graph.distinctWords else null,
        )
        val ignore = (mc.strings("ignore") ?: emptyList()).map(::normalize).filter { it.isNotEmpty() }
        val out = ArrayList<Match>()
        for (entity in graph.allEntities()) {
            if (types != null && entity.type !in types) continue
            val m = graph.typeConfig(entity.type).obj("match")
            if (truthy(m["skip"])) continue
            var best: Scored? = null
            val names = listOf(entity.label to false) + entity.aliases.map { it to true }
            for ((raw, isAlias) in names) {
                val name = normalize(raw)
                if (ignore.any { name.contains(it) }) continue
                val sc = scoreName(q, name, isAlias, m, s)
                if (sc != null && (best == null || sc.score > best.score)) best = sc
            }
            if (best == null) continue
            val reason = Reason(kind = "match", by = best.by, name = best.name)
            out.add(Match(entity, best.score, m.num("tier", 1.0).toInt(), reason, renderReason(graph, reason, entity, templates)))
        }
        val sorted = out.sortedWith(compareBy<Match>({ if (s.precise && it.score < STRONG) 1 else 0 }, { it.tier }, { -it.score }))
        return sorted.take(limit)
    }

    /** What a query means: one entity, things like one, or nothing here. */
    @JvmOverloads
    public fun match(query: String, similarLimit: Int = 3, templates: Map<String, Any>? = null): MatchResult {
        val result = matchQuietly(query, similarLimit, templates)
        if (events != null) {
            val event = LinkedHashMap<String, Any?>()
            event["type"] = "matched"
            event["intent"] = result.intent
            result.entity?.let { event["entityType"] = it.type }
            result.match?.reason?.by?.takeIf { it.isNotEmpty() }?.let { event["by"] = it }
            events.emit(event)
        }
        return result
    }

    private fun matchQuietly(query: String, similarLimit: Int, templates: Map<String, Any>?): MatchResult {
        val best = search(query, 1, null, templates).firstOrNull()
        val q = normalize(query)
        val mc = graph.config.obj("match")
        val typo = mc.num("typoMinLength", 4.0)
        var missing: Pair<String, String>? = null
        for (raw in mc.strings("notHere") ?: emptyList()) {
            val name = normalize(raw)
            if (name.isNotEmpty() && hasPhrase(q, name, typo) && (missing == null || name.length > missing.second.length)) missing = raw to name
        }
        if (missing != null && (best == null || missing.second.length > (best.reason.name?.takeIf { it.isNotEmpty() } ?: normalize(best.entity.label)).length)) {
            return MatchResult(query, "none", notHere = missing.first)
        }
        if (best == null) return MatchResult(query, "none")
        val kinds = graph.typeConfig(best.entity.type)["similar"]
        if (kinds != false && similarRe.containsMatchIn(q)) {
            val similar = neighbours(best.entity.id, (kinds as? List<*>)?.filterIsInstance<String>())
                .filter { graph.isDestination(it.first) }
                .take(similarLimit)
                .map { (e, l) -> reasonFromLink(l, e.id).let { r -> Related(e, l.weight, l, r, renderReason(graph, r, e, templates)) } }
            if (similar.isNotEmpty()) return MatchResult(query, "similar", best.entity, best, similar)
        }
        return MatchResult(query, "entity", best.entity, best)
    }

    // --- related and next

    private fun neighbours(id: String, kinds: Collection<String>?): List<Pair<Entity, Link>> {
        val out = ArrayList<Pair<Entity, Link>>()
        for (l in graph.adjacent[id] ?: emptyList()) {
            if (kinds != null && l.kind !in kinds) continue
            graph.entities[l.otherEnd(id)]?.let { out.add(it to l) }
        }
        return out.sortedBy { -it.second.weight }
    }

    /** What is related to one entity, strongest link first, each with why. */
    @JvmOverloads
    public fun related(
        id: String,
        kinds: Collection<String>? = null,
        limit: Int? = null,
        destinationsOnly: Boolean = true,
        accept: ((Entity) -> Boolean)? = null,
        templates: Map<String, Any>? = null,
    ): List<Related> {
        var pairs = neighbours(id, kinds)
            .sortedWith(compareBy({ -it.second.weight }, { -graph.pull(it.second.kind) }))
            .filter { (e, _) -> (!destinationsOnly || graph.isDestination(e)) && (accept == null || accept(e)) }
        if (limit != null) pairs = pairs.take(limit)
        val out = pairs.map { (e, l) -> reasonFromLink(l, e.id).let { r -> Related(e, l.weight, l, r, renderReason(graph, r, e, templates)) } }
        suggested("related", out.map { it.entity.id }, out.map { it.reason.kind })
        return out
    }

    /** How brightly each entity lights up for this trail, with the strongest reason for each. */
    public fun spread(trail: List<String>): Spread {
        val cfg = graph.config.obj("next")
        val recency = cfg.num("recency", 0.6)
        val second = cfg.num("secondStep", 0.4)
        val hub = cfg.num("hubDamping", 3.0)
        val boost = cfg.num("sectionBoost", 0.08)
        val sections = cfg.obj("sections")
        val score = LinkedHashMap<String, Double>()
        val why = LinkedHashMap<String, Why>()
        val sectionOnly = LinkedHashSet<String>()

        fun give(id: String, part: Double, link: Link, src: String, seed: String) {
            score[id] = (score[id] ?: 0.0) + part
            if (part > (why[id]?.part ?: 0.0)) why[id] = Why(link, src, seed, part)
        }

        val seeds = LinkedHashMap<String, Double>()
        for (id in trail.asReversed()) if (id !in seeds) seeds[id] = recency.pow(seeds.size)
        for ((seed, w) in seeds) {
            if (seed.startsWith("section:")) {
                val type = sections.str(seed.substring(8))
                if (type.isNullOrEmpty()) continue
                for (e in graph.entities.values) {
                    if (e.type != type) continue
                    score[e.id] = (score[e.id] ?: 0.0) + w * boost * min(1.0, graph.degree(e.id) / 8.0)
                    sectionOnly.add(e.id)
                }
                continue
            }
            for (l1 in graph.adjacent[seed] ?: emptyList()) {
                val mid = l1.otherEnd(seed)
                val a = w * l1.weight * graph.pull(l1.kind)
                give(mid, a, l1, seed, seed)
                val carry = (a * second) / sqrt(1 + graph.degree(mid) / hub)
                for (l2 in graph.adjacent[mid] ?: emptyList()) {
                    val far = l2.otherEnd(mid)
                    if (far == seed) continue
                    give(far, carry * l2.weight * graph.pull(l2.kind), l2, mid, seed)
                }
            }
        }
        return Spread(score, why, seeds, sectionOnly)
    }

    /** The next things to suggest after this trail: unseen, worth going to, and mixed. */
    @JvmOverloads
    public fun next(
        trail: List<String>,
        limit: Int = 3,
        exclude: Collection<String> = emptyList(),
        accept: ((Entity) -> Boolean)? = null,
        templates: Map<String, Any>? = null,
    ): List<Suggestion> {
        val sp = spread(trail)
        val skip = sp.seeds.keys + exclude
        val ranked = ArrayList<Triple<Entity, Double, Why?>>()
        for ((id, s) in sp.score) {
            val e = graph.entities[id] ?: continue
            if (!(id in sp.why || id in sp.sectionOnly) || !graph.isDestination(e) || id in skip || (accept != null && !accept(e))) continue
            ranked.add(Triple(e, s, sp.why[id]))
        }
        val byScore = ranked.sortedBy { -it.second }
        val cap = maxOf(1, limit - 1)
        val taken = ArrayList<Int>()
        val perType = HashMap<String, Int>()
        for ((i, r) in byScore.withIndex()) {
            if (taken.size == limit) break
            if ((perType[r.first.type] ?: 0) >= cap) continue
            perType[r.first.type] = (perType[r.first.type] ?: 0) + 1
            taken.add(i)
        }
        for (i in byScore.indices) if (taken.size < limit && i !in taken) taken.add(i)
        val out = taken.map { byScore[it] }.sortedBy { -it.second }.map { (e, s, w) ->
            val reason = if (w != null) reasonFromLink(w.link, e.id, w.seed) else Reason("section")
            Suggestion(e, s, reason, renderReason(graph, reason, e, templates))
        }
        suggested("next", out.map { it.entity.id }, out.map { it.reason.kind })
        return out
    }

    /** Type-ahead: names that start with (or contain) what's typed, nearest the trail first. */
    @JvmOverloads
    public fun autocomplete(
        typed: String,
        trail: List<String> = emptyList(),
        limit: Int = 3,
        accept: ((Entity) -> Boolean)? = null,
        templates: Map<String, Any>? = null,
    ): List<Suggestion> {
        val q = normalize(typed)
        if (q.length < 2) return emptyList()
        val near = spread(trail).score
        val hits = ArrayList<Triple<Entity, String, Double>>()
        for (e in graph.entities.values) {
            if (!graph.isDestination(e) || (accept != null && !accept(e))) continue
            val name = normalize(e.label)
            val kind = when {
                name.startsWith(q) -> 3
                name.split(" ").any { it.startsWith(q) } -> 2
                q.length >= 3 && name.contains(q) -> 1
                else -> 0
            }
            if (kind == 0) continue
            val by = when (kind) { 3 -> "prefix"; 2 -> "word-prefix"; else -> "contains" }
            hits.add(Triple(e, by, kind * 10 + (near[e.id] ?: 0.0) * 5 + min(graph.degree(e.id), 20) / 20.0))
        }
        return hits.sortedBy { -it.third }.take(limit).map { (e, by, rank) ->
            val reason = Reason(kind = "typed", by = by)
            Suggestion(e, rank, reason, renderReason(graph, reason, e, templates))
        }
    }

    /** A reason as a sentence. */
    @JvmOverloads
    public fun explain(reason: Reason, item: Entity, templates: Map<String, Any>? = null): String = renderReason(graph, reason, item, templates)

    /** A reason as a sentence, for an entity id. */
    @JvmOverloads
    public fun explain(reason: Reason, itemId: String, templates: Map<String, Any>? = null): String =
        renderReason(graph, reason, graph.entities[itemId] ?: throw NoSuchElementException("pubba: no entity $itemId"), templates)
}

/** Answers from a compiled bundle (`pubba compile`), exactly as the content it was compiled from. */
@JvmOverloads
public fun loadBundle(json: String, events: Events? = null): Pubba = Pubba(graphFromBundle(json), events)

/** Answers from an already parsed bundle. */
@JvmOverloads
public fun loadBundle(bundle: Map<String, Any?>, events: Events? = null): Pubba = Pubba(graphFromBundle(bundle), events)
