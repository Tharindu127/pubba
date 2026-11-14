package com.tharinduathapaththu.pubba

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/** The Kotlin runtime against the shared conformance suite (../../conformance). */
class ConformanceTest {
    private val root = File(System.getProperty("pubba.conformance") ?: "../../conformance")

    private fun lines(name: String) = File(root, "cases/$name").readLines().filter { it.isNotBlank() }.map { Json.parse(it).asObj()!! }

    @Test
    fun textHelpers() {
        for (c in lines("text.jsonl")) {
            val got: Any = when (c["op"]) {
                "normalize" -> normalize(c.str("input")!!)
                "distance" -> editDistance(c.str("a")!!, c.str("b")!!)
                else -> closeTo(c.str("token"), c.str("word")!!, (c["typoMinLength"] as? Number)?.toDouble() ?: Double.POSITIVE_INFINITY)
            }
            assertEquals(null, Harness.diff(got, c["expect"]), c.toString())
        }
    }

    @Test
    fun bundles() {
        val names = File(root, "bundles").list()!!.filter { it.endsWith(".json") }.map { it.removeSuffix(".json") }.sorted()
        assertTrue(names.isNotEmpty())
        val report = StringBuilder()
        var total = 0
        for (name in names) {
            val pubba = loadBundle(File(root, "bundles/$name.json").readText())
            val failures = ArrayList<String>()
            val cases = lines("$name.jsonl")
            for (c in cases) {
                val case = LinkedHashMap(c)
                val expect = case.remove("expect")
                val d = try {
                    Harness.diff(Harness.run(pubba, case), expect)
                } catch (e: Exception) {
                    "threw $e"
                }
                if (d != null) failures.add(Json.stringify(case).take(140) + "\n    " + d)
            }
            total += cases.size
            if (failures.isNotEmpty()) report.append("$name: ${failures.size} of ${cases.size} cases differ:\n  ").append(failures.take(5).joinToString("\n  ")).append('\n')
        }
        if (report.isNotEmpty()) fail(report.toString())
        println("conformance: $total cases over ${names.size} bundles, all equal")
    }
}
