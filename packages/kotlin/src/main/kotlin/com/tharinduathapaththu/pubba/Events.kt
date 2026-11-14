@file:JvmName("PubbaEvents")

package com.tharinduathapaththu.pubba

/*
 * Privacy-safe measurement events (SPEC section 8). pubba only emits: no
 * storage, no network, no visitor ids, no timestamps. Event fields hold entity
 * ids, types, kinds and declared goals; never a query.
 */

/** How a visitor can be guided somewhere, for `guided-to` events. */
public val GUIDE_VIAS: List<String> = listOf("suggestion", "chip", "typed", "match", "related")

public fun interface EventListener {
    public fun onEvent(event: Map<String, @JvmSuppressWildcards Any?>)
}

public class Events @JvmOverloads constructor(goals: List<String> = listOf("contact", "resume")) {
    public val goals: List<String> = goals.toList()
    private val listeners = ArrayList<EventListener>()

    /** Listen to every event; returns an unsubscribe function. A listener that throws is ignored. */
    public fun on(listener: EventListener): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }

    public fun emit(event: Map<String, Any?>) {
        for (l in listeners.toList()) {
            try {
                l.onEvent(LinkedHashMap(event))
            } catch (_: Exception) {
                // Measurement must never break the guide.
            }
        }
    }
}

@JvmOverloads
public fun createEvents(goals: List<String> = listOf("contact", "resume")): Events = Events(goals)

/** One visit's funnel. */
public data class Summary(
    val usedGuide: Boolean,
    val guidedTo: List<String>,
    val guidedToTypes: List<String>,
    val reached: List<String>,
    val guidedBeforeGoal: Boolean,
) {
    public fun toMap(): Map<String, Any> = mapOf(
        "usedGuide" to usedGuide, "guidedTo" to guidedTo, "guidedToTypes" to guidedToTypes,
        "reached" to reached, "guidedBeforeGoal" to guidedBeforeGoal,
    )
}

/** Was the guide used, where did it lead, which goals were reached. */
public fun summarise(events: Iterable<Map<String, Any?>>): Summary {
    val guidedTo = ArrayList<String>()
    val types = ArrayList<String>()
    val reached = ArrayList<String>()
    var used = false
    var beforeGoal = false
    for (e in events) {
        when (e["type"]) {
            "guide-opened", "matched" -> used = true
            "guided-to" -> {
                used = true
                (e["to"] as? String)?.let { if (it !in guidedTo) guidedTo.add(it) }
                (e["entityType"] as? String)?.let { if (it !in types) types.add(it) }
            }
            "reached" -> {
                (e["goal"] as? String)?.let { if (it !in reached) reached.add(it) }
                if (guidedTo.isNotEmpty()) beforeGoal = true
            }
        }
    }
    return Summary(used, guidedTo, types, reached, beforeGoal)
}

/** The moments a site reports to its measurement, checked so no visitor text gets in. */
public class Track internal constructor(private val graph: Graph, private val events: Events?) {
    public fun guideOpened() {
        events?.emit(mapOf("type" to "guide-opened"))
    }

    public fun guidedTo(id: String, via: String): Boolean {
        val e = graph.find(id)
        if (events == null || e == null || via !in GUIDE_VIAS) return false
        events.emit(mapOf("type" to "guided-to", "to" to e.id, "entityType" to e.type, "via" to via))
        return true
    }

    public fun reached(goal: String): Boolean {
        if (events == null || goal !in events.goals) return false
        events.emit(mapOf("type" to "reached", "goal" to goal))
        return true
    }
}
