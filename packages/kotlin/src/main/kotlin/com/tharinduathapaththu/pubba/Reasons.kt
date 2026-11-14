@file:JvmName("PubbaReasons")

package com.tharinduathapaththu.pubba

/** Sentences (SPEC section 6). */
public val DEFAULT_TEMPLATES: Map<String, Any> = mapOf(
    "section" to "{item} is worth a look.",
    "typed" to "{item} matches what you typed.",
    "match" to "{item} matches “{name}”.",
)

private val TOKEN = Regex("""\{(\w+)\}""")
private val OPTIONAL = Regex("""\[([^\]]*)\]""")

/** The reason a link gives for the entity at one of its ends. */
@JvmOverloads
public fun reasonFromLink(link: Link, itemId: String, seed: String? = null): Reason {
    val to = link.otherEnd(itemId)
    return Reason(
        kind = link.kind,
        to = to,
        direction = if (link.from == itemId) "out" else "in",
        via = link.via?.takeIf { it.isNotEmpty() },
        seed = if (!seed.isNullOrEmpty() && seed != to) seed else null,
    )
}

private fun fill(text: String, values: Map<String, String>): String {
    val kept = OPTIONAL.replace(text) { m ->
        val inner = m.groupValues[1]
        if (TOKEN.findAll(inner).all { !values[it.groupValues[1]].isNullOrEmpty() }) inner else ""
    }
    return TOKEN.replace(kept) { m -> values[m.groupValues[1]] ?: "" }
}

private fun pick(t: Any, reason: Reason, item: Entity, other: Entity?): String? {
    if (t is String) return t
    if (t is TemplateFn) return t.render(reason, item, other)
    val m = t.asObj() ?: return null
    for (c in (m["cases"] as? List<*>) ?: emptyList<Any?>()) {
        val case = c.asObj() ?: continue
        val ci = case.str("item")
        val co = case.str("other")
        val cd = case.str("direction")
        if ((ci.isNullOrEmpty() || ci == item.type) && (co.isNullOrEmpty() || (other != null && co == other.type)) && (cd.isNullOrEmpty() || cd == reason.direction)) {
            return case.str("text")
        }
    }
    if (reason.direction == "out" && !m.str("out").isNullOrEmpty()) return m.str("out")
    if (reason.direction == "in" && !m.str("in").isNullOrEmpty()) return m.str("in")
    for (k in listOf("default", "out", "in")) m.str(k)?.let { return it }
    return null
}

/** A reason as one sentence. Templates: a String, a JSON-shaped map (cases, out, in, default) or a [TemplateFn]. */
@JvmOverloads
public fun renderReason(g: Graph, reason: Reason, item: Entity, templates: Map<String, Any>? = null): String {
    val every = LinkedHashMap<String, Any?>(DEFAULT_TEMPLATES)
    every.putAll(g.config.obj("templates"))
    templates?.let { every.putAll(it) }
    val other = reason.to?.takeIf { it.isNotEmpty() }?.let { g.entities[it] }
    val t = every["${reason.kind}.${item.type}"] ?: every[reason.kind]
    var text = if (t != null && truthy(t)) pick(t, reason, item, other) else null
    if (text == null) {
        text = if (other != null) {
            if (reason.direction == "in") "{other}: {kind} {item}[ ({via})]." else "{item}: {kind} {other}[ ({via})]."
        } else "{item} is worth a look."
    }
    if (t is TemplateFn) return text
    val otherLabel = other?.shortLabel ?: ""
    return fill(
        text,
        mapOf(
            "item" to item.shortLabel,
            "other" to otherLabel,
            "otherLower" to otherLabel.lowercase(),
            "via" to (reason.via ?: emptyList()).take(3).joinToString(", "),
            "kind" to g.kindLabel(reason.kind),
            "name" to (reason.name ?: ""),
        ),
    )
}
