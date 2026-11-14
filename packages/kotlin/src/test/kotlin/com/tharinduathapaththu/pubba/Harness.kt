package com.tharinduathapaththu.pubba

/** The conformance harness for Kotlin: runs a case and returns its answer as plain JSON-shaped data (see conformance/README.md). */
object Harness {
    private fun chip(c: Chip): Map<String, Any?> = when (c) {
        is QuestionChip -> mapOf("label" to c.label, "question" to c.question)
        is EntityChip -> buildMap {
            put("id", c.id); put("label", c.label)
            c.url?.let { put("url", it) }
            put("reason", c.reason.toMap()); put("text", c.text)
        }
    }

    private fun reply(r: Reply?): Map<String, Any?>? {
        if (r == null) return null
        return buildMap {
            put("kind", r.kind); put("text", r.text)
            r.action?.let { a -> put("action", buildMap { put("type", a.type); put("id", a.id); a.url?.let { put("url", it) } }) }
            put("chips", r.chips.map(::chip))
            r.match?.let { m -> put("match", mapOf("id" to m.entity.id, "score" to m.score, "tier" to m.tier, "by" to m.reason.by, "name" to m.reason.name)) }
            r.similar?.let { s -> put("similar", s.map(::chip)) }
        }
    }

    private fun weighted(x: Related) = mapOf("id" to x.entity.id, "weight" to x.weight, "reason" to x.reason.toMap(), "text" to x.text)
    private fun scored(x: Suggestion) = mapOf("id" to x.entity.id, "score" to x.score, "reason" to x.reason.toMap(), "text" to x.text)

    @Suppress("UNCHECKED_CAST")
    private fun options(o: Map<String, Any?>?, now: () -> Double): GuideOptions = GuideOptions().apply {
        this.now = now
        if (o == null) return@apply
        (o["chips"] as? Number)?.let { chips = it.toInt() }
        (o["hide"] as? List<*>)?.let { rules ->
            accept = { e ->
                val label = e.label.lowercase()
                rules.none { raw ->
                    val r = raw.asObj()!!
                    val types = r.strings("types"); val ids = r.strings("ids")
                    val inc = r.strings("labelIncludes"); val ends = r.strings("labelEndsWith")
                    (types.isNullOrEmpty() || e.type in types) && (ids.isNullOrEmpty() || e.id in ids) &&
                        (inc.isNullOrEmpty() || inc.any { label.contains(it) }) && (ends.isNullOrEmpty() || ends.any { label.endsWith(it) })
                }
            }
        }
        o["fallback"].asObj()?.let { fb ->
            fallback = { ctx ->
                val v = if (ctx.kind == "open" && ctx.entity != null) fb["open." + ctx.entity.type] ?: fb["open"] else fb[ctx.kind]
                (v as? List<*>)?.map { QuestionChip(it as String) }
            }
        }
        o["lines"].asObj()?.let { lines -> line = { e -> lines[e.id] as? String } }
        o["templates"].asObj()?.let { templates = it as Map<String, String> }
        o.strings("nudgeAvoids")?.let { avoid -> prefer = { e -> e.type !in avoid } }
    }

    private fun runGuide(base: Pubba, steps: List<Map<String, Any?>>, opts: Map<String, Any?>?): Map<String, Any?> {
        var clock = 0.0
        val events = createEvents(listOf("contact"))
        val emitted = ArrayList<Map<String, Any?>>()
        events.on { emitted.add(it) }
        val guide = createGuide(base.withEvents(events), options(opts) { clock })
        val answers = ArrayList<Any?>()
        for (s in steps) {
            when (s["op"]) {
                "visited" -> { guide.visited(s.str("id")!!); answers.add(null) }
                "follow" -> { guide.follow(s.str("id")!!, s.str("via")!!); answers.add(null) }
                "ask" -> answers.add(reply(guide.ask(s.str("question")!!)))
                "nudge" -> answers.add(reply(guide.nudge()))
                "chips" -> answers.add(guide.chips((s["limit"] as? Number)?.toInt()).map(::chip))
                "tick" -> { clock += (s["ms"] as Number).toDouble(); answers.add(null) }
                "opened" -> { guide.opened(); answers.add(null) }
                "reached" -> { guide.reached(s.str("goal")!!); answers.add(null) }
            }
        }
        return mapOf("answers" to answers, "trail" to guide.trail.get(), "events" to emitted)
    }

    @Suppress("UNCHECKED_CAST")
    fun run(pubba: Pubba, c: Map<String, Any?>): Any? = when (val op = c["op"]) {
        "match" -> {
            val m = pubba.match(c.str("query")!!)
            buildMap {
                put("intent", m.intent); put("entity", m.entity?.id)
                m.match?.let { x -> put("score", x.score); put("tier", x.tier); put("by", x.reason.by); put("name", x.reason.name); put("text", x.text) }
                put("similar", m.similar.map(::weighted))
                m.notHere?.let { put("notHere", it) }
            }
        }
        "search" -> pubba.search(c.str("query")!!, (c["limit"] as Number).toInt()).map { m ->
            mapOf("id" to m.entity.id, "score" to m.score, "tier" to m.tier, "by" to m.reason.by, "name" to m.reason.name)
        }
        "next" -> pubba.next(c.strings("trail")!!, (c["limit"] as Number).toInt(), c.strings("exclude") ?: emptyList()).map(::scored)
        "related" -> pubba.related(c.str("id")!!, c.strings("kinds"), (c["limit"] as? Number)?.toInt()).map(::weighted)
        "autocomplete" -> pubba.autocomplete(c.str("typed")!!, c.strings("trail")!!, (c["limit"] as Number).toInt()).map { s ->
            mapOf("id" to s.entity.id, "score" to s.score, "by" to s.reason.by)
        }
        "explain" -> pubba.explain(Reason.fromMap(c["reason"].asObj()!!), c.str("item")!!)
        "guide" -> runGuide(pubba, (c["steps"] as List<*>).map { it.asObj()!! }, c["options"].asObj())
        else -> error("unknown op $op")
    }

    /** Equal as JSON, numbers to 1e-9. The path of the first difference, or null. */
    fun diff(a: Any?, b: Any?, path: String = "$"): String? {
        if (a is Number && b is Number) return if (Math.abs(a.toDouble() - b.toDouble()) <= 1e-9) null else "$path: $a != $b"
        if (a is List<*> || b is List<*>) {
            if (a !is List<*> || b !is List<*>) return "$path: list vs not"
            if (a.size != b.size) return "$path: length ${a.size} != ${b.size}"
            for (i in a.indices) diff(a[i], b[i], "$path[$i]")?.let { return it }
            return null
        }
        if (a is Map<*, *> && b is Map<*, *>) {
            val ka = a.keys.map { it.toString() }.sorted()
            val kb = b.keys.map { it.toString() }.sorted()
            if (ka != kb) return "$path: keys $ka != $kb"
            for (k in ka) diff(a[k], b[k], "$path.$k")?.let { return it }
            return null
        }
        return if (a == b) null else "$path: $a != $b"
    }
}
