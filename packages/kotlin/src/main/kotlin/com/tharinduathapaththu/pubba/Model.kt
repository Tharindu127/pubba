@file:JvmName("PubbaBundle")

package com.tharinduathapaththu.pubba

import kotlin.math.floor

/** The bundle format this runtime reads. */
public const val BUNDLE_FORMAT: Int = 1

/** One thing on the site: a project, a skill, a product, a page. */
public data class Entity @JvmOverloads constructor(
    val id: String,
    val type: String,
    val label: String,
    val short: String? = null,
    val aliases: List<String> = emptyList(),
    val url: String? = null,
    val text: String? = null,
    val data: Map<String, Any?>? = null,
) {
    /** How it reads inside a sentence. */
    val shortLabel: String get() = short ?: label
}

/** A typed, weighted link between two entities. */
public data class Link @JvmOverloads constructor(
    val from: String,
    val kind: String,
    val to: String,
    val weight: Double,
    val via: List<String>? = null,
    val rule: String? = null,
) {
    public fun otherEnd(id: String): String = if (from == id) to else from
}

/** Why something was suggested or matched, as data. [Pubba.explain] turns it into a sentence. */
public data class Reason @JvmOverloads constructor(
    val kind: String,
    val to: String? = null,
    val direction: String? = null,
    val via: List<String>? = null,
    val seed: String? = null,
    val by: String? = null,
    val name: String? = null,
) {
    /** The reason as plain JSON-shaped data, absent fields left out. */
    public fun toMap(): Map<String, Any> = buildMap {
        put("kind", kind)
        to?.let { put("to", it) }
        direction?.let { put("direction", it) }
        via?.let { put("via", it) }
        seed?.let { put("seed", it) }
        by?.let { put("by", it) }
        name?.let { put("name", it) }
    }

    public companion object {
        @JvmStatic
        public fun fromMap(m: Map<String, Any?>): Reason = Reason(
            kind = m.str("kind") ?: error("pubba: a reason needs a kind"),
            to = m.str("to"),
            direction = m.str("direction"),
            via = m.strings("via"),
            seed = m.str("seed"),
            by = m.str("by"),
            name = m.str("name"),
        )
    }
}

public data class Suggestion(val entity: Entity, val score: Double, val reason: Reason, val text: String)

public data class Related(val entity: Entity, val weight: Double, val link: Link, val reason: Reason, val text: String)

public data class Match(val entity: Entity, val score: Double, val tier: Int, val reason: Reason, val text: String)

/** What a query means: `intent` is "entity", "similar" or "none". */
public data class MatchResult @JvmOverloads constructor(
    val query: String,
    val intent: String,
    val entity: Entity? = null,
    val match: Match? = null,
    val similar: List<Related> = emptyList(),
    val notHere: String? = null,
)

/** A sentence template written in code, for wording a bundle's string templates can't express. */
public fun interface TemplateFn {
    public fun render(reason: Reason, item: Entity, other: Entity?): String
}

/** The graph inside a bundle: linked entities, unlinked ones (matchable, never suggested), links and config. */
public class Graph internal constructor(
    public val entities: Map<String, Entity>,
    public val unlinked: Map<String, Entity>,
    public val links: List<Link>,
    public val adjacent: Map<String, List<Link>>,
    public val config: Map<String, Any?>,
    public val distinctWords: Set<String>,
) {
    public fun allEntities(): List<Entity> = entities.values + unlinked.values

    public fun find(id: String): Entity? = entities[id] ?: unlinked[id]

    public fun degree(id: String): Int = adjacent[id]?.size ?: 0

    public fun typeConfig(type: String): Map<String, Any?> = config.obj("types").obj(type)

    public fun isDestination(e: Entity): Boolean = typeConfig(e.type)["destination"] != false

    public fun pull(kind: String): Double = config.obj("kinds").obj(kind).num("pull", 0.5)

    public fun kindLabel(kind: String): String = config.obj("kinds").obj(kind).str("label") ?: kind.replace("-", " ")
}

private fun entityFrom(raw: Map<String, Any?>): Entity = Entity(
    id = raw.str("id") ?: error("pubba: an entity needs an id"),
    type = raw.str("type") ?: error("pubba: an entity needs a type"),
    label = raw.str("label") ?: error("pubba: an entity needs a label"),
    short = raw.str("short"),
    aliases = raw.strings("aliases") ?: emptyList(),
    url = raw.str("url"),
    text = raw.str("text"),
    data = raw["data"].asObj(),
)

/** The graph inside a bundle (JSON text), after checking it is one this runtime can read. */
public fun graphFromBundle(json: String): Graph = graphFromBundle(Json.parse(json).asObj() ?: throw IllegalArgumentException("pubba: not a pubba bundle"))

/** The graph inside an already parsed bundle. */
public fun graphFromBundle(b: Map<String, Any?>): Graph {
    val format = b["format"] as? Number
    val rawEntities = b["entities"] as? List<*>
    val rawLinks = b["links"] as? List<*>
    if (format == null || rawEntities == null || rawLinks == null) throw IllegalArgumentException("pubba: not a pubba bundle")
    if (floor(format.toDouble()) > BUNDLE_FORMAT) {
        throw IllegalArgumentException("pubba: bundle format ${Json.stringify(format)} is newer than this runtime reads ($BUNDLE_FORMAT); upgrade pubba")
    }
    val links = rawLinks.map {
        val l = it.asObj() ?: throw IllegalArgumentException("pubba: not a pubba bundle")
        Link(l.str("from")!!, l.str("kind")!!, l.str("to")!!, (l["weight"] as Number).toDouble(), l.strings("via"), l.str("rule"))
    }
    val adjacent = LinkedHashMap<String, MutableList<Link>>()
    for (l in links) {
        adjacent.getOrPut(l.from) { ArrayList() }.add(l)
        adjacent.getOrPut(l.to) { ArrayList() }.add(l)
    }
    val linked = LinkedHashMap<String, Entity>()
    val unlinked = LinkedHashMap<String, Entity>()
    for (raw in rawEntities + ((b["unlinked"] as? List<*>) ?: emptyList<Any?>())) {
        val e = entityFrom(raw.asObj() ?: continue)
        if (e.id in adjacent) linked[e.id] = e else unlinked[e.id] = e
    }
    return Graph(linked, unlinked, links, adjacent, b["config"].asObj() ?: emptyMap(), b.obj("index").strings("distinctWords")?.toSet() ?: emptySet())
}
