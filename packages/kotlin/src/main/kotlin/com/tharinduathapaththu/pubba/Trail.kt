@file:JvmName("PubbaTrail")

package com.tharinduathapaththu.pubba

/** Where a trail is kept between launches: SharedPreferences, DataStore, a file. */
public interface TrailStorage {
    public fun getItem(key: String): String?
    public fun setItem(key: String, value: String)
}

/** A visitor's trail through the site or app, in entity ids, most recent last. Never sent anywhere. */
public class Trail @JvmOverloads constructor(
    private val max: Int = 24,
    private val storage: TrailStorage? = null,
    private val key: String = "pubba-trail",
) {
    private var steps: List<String> = emptyList()
    private var loaded = false
    private val listeners = ArrayList<() -> Unit>()

    private fun load() {
        if (loaded) return
        loaded = true
        try {
            val saved = Json.parse(storage?.getItem(key) ?: "[]")
            if (saved is List<*>) steps = saved.filterIsInstance<String>().takeLast(max)
        } catch (_: Exception) {
            // A broken or missing save starts a fresh trail.
        }
    }

    private fun save() {
        try {
            storage?.setItem(key, Json.stringify(steps))
        } catch (_: Exception) {
            // Storage full or blocked: the trail lives on in memory.
        }
        for (l in listeners.toList()) l()
    }

    /** One step; the same step twice in a row counts once. */
    public fun record(id: String?) {
        if (id.isNullOrEmpty()) return
        load()
        if (steps.lastOrNull() == id) return
        steps = (steps + id).takeLast(max)
        save()
    }

    public fun get(): List<String> {
        load()
        return steps.toList()
    }

    public fun clear() {
        loaded = true
        steps = emptyList()
        save()
    }

    /** Called after every change; returns an unsubscribe function. */
    public fun subscribe(listener: () -> Unit): () -> Unit {
        listeners.add(listener)
        return { listeners.remove(listener) }
    }
}

@JvmOverloads
public fun createTrail(max: Int = 24, storage: TrailStorage? = null, key: String = "pubba-trail"): Trail = Trail(max, storage, key)

/** A trail step for opening a section, which lights every entity of its type a little. */
public fun sectionStep(section: String): String = "section:$section"
