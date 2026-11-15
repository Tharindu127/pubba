@file:JvmName("PubbaIntent")

package com.tharinduathapaththu.pubba

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

// Intent profiles (SPEC 5.7, 5.8): a guess at why this visit is happening, from
// the trail alone. Once one intent is likely, it leans suggestions towards what
// it boosts, within 0.5-2x, so it reorders but never hides. Nothing is stored.

/** The visitor's likely intent moved this suggestion: which intent, and its boost. */
public data class ReasonIntent(val id: String, val boost: Double)

/** A trail step that pointed to an intent; [via] is the neighbour it pointed through, when that counted more. */
public data class IntentEvidence(val step: String, val via: String?, val weight: Double) {
    public fun toMap(): Map<String, Any> = buildMap {
        put("step", step)
        via?.let { put("via", it) }
        put("weight", weight)
    }
}

/** Why a visit is likely happening: [likely] is null while browsing, with too few steps, or with no intents. */
public data class IntentReading(
    val likely: String?,
    val confidence: Double,
    /** Each intent's share, then `browsing`'s. */
    val scores: Map<String, Double>,
    /** The steps behind the top intent. */
    val evidence: List<IntentEvidence>,
) {
    public fun toMap(): Map<String, Any?> = linkedMapOf("likely" to likely, "confidence" to confidence, "scores" to scores, "evidence" to evidence.map { it.toMap() })
}

/** The configured intents, in order ("browsing" is reserved). */
public fun intentsOf(g: Graph): List<Pair<String, Map<String, Any?>>> =
    g.config.obj("intents").mapNotNull { (id, c) -> if (id == "browsing") null else c.asObj()?.let { id to it } }

private fun findIntent(g: Graph, intent: String): Map<String, Any?>? = intentsOf(g).firstOrNull { it.first == intent }?.second

/** Why this visit is likely happening, from the trail alone. */
public fun readIntent(g: Graph, trail: List<String>): IntentReading {
    val intents = intentsOf(g)
    val settings = g.config.obj("intent")
    val minConfidence = settings.num("minConfidence", 0.5)
    val minSteps = settings.num("minSteps", 2.0)
    val share = settings.num("neighbours", 0.5)
    val next = g.config.obj("next")
    val recency = next.num("recency", 0.6)
    val sections = next.obj("sections")

    val seeds = LinkedHashMap<String, Double>()
    for (id in trail.asReversed()) if (id !in seeds) seeds[id] = recency.pow(seeds.size)
    val steps = seeds.keys.count { !it.startsWith("section:") && g.find(it) != null }

    val raw = ArrayList<Double>()
    val evidence = ArrayList<List<IntentEvidence>>()
    for ((_, intent) in intents) {
        val signals = intent.obj("signals")
        val e = signals.obj("entities")
        val t = signals.obj("types")
        val k = signals.obj("kinds")
        var sum = 0.0
        val ev = ArrayList<IntentEvidence>()
        for ((step, w) in seeds) {
            var via: String? = null
            val part: Double
            if (step.startsWith("section:")) {
                val type = sections.str(step.substring(8))
                if (type.isNullOrEmpty()) continue
                part = w * t.num(type, 0.0)
            } else {
                val entity = g.find(step) ?: continue
                val self = e.num(entity.id, 0.0) + t.num(entity.type, 0.0)
                var best = 0.0
                var bestVia: String? = null
                for (l in g.adjacent[step] ?: emptyList()) {
                    val n = l.otherEnd(step)
                    val v = l.weight * (e.num(n, 0.0) + k.num(l.kind, 0.0))
                    if (v > best) {
                        best = v
                        bestVia = n
                    }
                }
                val near = share * best
                if (near > self) via = bestVia
                part = w * (self + near)
            }
            sum += part
            if (part > 0) ev.add(IntentEvidence(step, via, part))
        }
        raw.add(max(0.0, sum))
        evidence.add(ev)
    }

    var sumRaw = 0.0
    for (r in raw) sumRaw += r
    val total = 1 + sumRaw
    val scores = LinkedHashMap<String, Double>()
    var top = -1
    for (i in intents.indices) {
        scores[intents[i].first] = raw[i] / total
        if (top < 0 || raw[i] > raw[top]) top = i
    }
    scores["browsing"] = 1 / total
    val confidence = if (top < 0) 0.0 else raw[top] / total
    val likely = if (top >= 0 && raw[top] > 0 && confidence >= minConfidence && steps >= minSteps) intents[top].first else null
    return IntentReading(likely, confidence, scores, if (top < 0) emptyList() else evidence[top])
}

/** The intent to apply: "auto" works it out from the trail, an id names one, null is none. */
public fun resolveIntent(g: Graph, trail: List<String>, option: String?): String? {
    if (option == null || intentsOf(g).isEmpty()) return null
    if (option == "auto") return readIntent(g, trail).likely
    return if (findIntent(g, option) != null) option else null
}

/** How much an intent leans towards an entity reached by a link: clamped to 0.5-2. */
public fun intentBoost(g: Graph, intent: String, e: Entity, link: Link?): Double {
    val b = findIntent(g, intent).obj("boost")
    val v = b.obj("types").num(e.type, 1.0) * b.obj("entities").num(e.id, 1.0) * (if (link != null) b.obj("kinds").num(link.kind, 1.0) else 1.0)
    return min(2.0, max(0.5, v))
}

/** An intent's label, for the `{intent}` token. */
public fun intentLabel(g: Graph, intent: String): String = findIntent(g, intent).str("label") ?: intent
