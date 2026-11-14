package com.tharinduathapaththu.pubba

/**
 * A small JSON reader and writer, so the runtime has no dependencies. Numbers
 * read as Double, objects as insertion-ordered maps, like JavaScript.
 */
public object Json {
    public fun parse(text: String): Any? {
        val p = Parser(text)
        p.space()
        val value = p.value()
        p.space()
        if (p.at < text.length) p.fail("unexpected text")
        return value
    }

    public fun stringify(value: Any?): String = StringBuilder().also { write(it, value) }.toString()

    private fun write(out: StringBuilder, v: Any?) {
        when (v) {
            null -> out.append("null")
            is Boolean -> out.append(v)
            is Number -> {
                val d = v.toDouble()
                if (d.isNaN() || d.isInfinite()) out.append("null")
                else if (d == Math.rint(d) && Math.abs(d) < 1e15) out.append(d.toLong()) else out.append(d)
            }
            is CharSequence -> quote(out, v.toString())
            is Map<*, *> -> {
                out.append('{')
                var first = true
                for ((k, x) in v) {
                    if (!first) out.append(',')
                    first = false
                    quote(out, k.toString()); out.append(':'); write(out, x)
                }
                out.append('}')
            }
            is Iterable<*> -> {
                out.append('[')
                var first = true
                for (x in v) {
                    if (!first) out.append(',')
                    first = false
                    write(out, x)
                }
                out.append(']')
            }
            is Array<*> -> write(out, v.asList())
            else -> quote(out, v.toString())
        }
    }

    private fun quote(out: StringBuilder, s: String) {
        out.append('"')
        for (c in s) {
            when (c) {
                '"' -> out.append("\\\"")
                '\\' -> out.append("\\\\")
                '\n' -> out.append("\\n")
                '\r' -> out.append("\\r")
                '\t' -> out.append("\\t")
                '\b' -> out.append("\\b")
                '\u000C' -> out.append("\\f")
                else -> if (c < ' ') out.append(String.format("\\u%04x", c.code)) else out.append(c)
            }
        }
        out.append('"')
    }

    private class Parser(val s: String) {
        var at = 0

        fun fail(msg: String): Nothing = throw IllegalArgumentException("pubba: bad JSON at $at: $msg")

        fun space() {
            while (at < s.length && (s[at] == ' ' || s[at] == '\n' || s[at] == '\r' || s[at] == '\t')) at++
        }

        fun value(): Any? {
            if (at >= s.length) fail("unexpected end")
            return when (val c = s[at]) {
                '{' -> obj()
                '[' -> arr()
                '"' -> str()
                't' -> word("true", true)
                'f' -> word("false", false)
                'n' -> word("null", null)
                else -> if (c == '-' || c in '0'..'9') num() else fail("unexpected '$c'")
            }
        }

        fun word(w: String, v: Any?): Any? {
            if (!s.startsWith(w, at)) fail("expected $w")
            at += w.length
            return v
        }

        fun obj(): Map<String, Any?> {
            val out = LinkedHashMap<String, Any?>()
            at++
            space()
            if (at < s.length && s[at] == '}') { at++; return out }
            while (true) {
                space()
                if (at >= s.length || s[at] != '"') fail("expected a key")
                val k = str()
                space()
                if (at >= s.length || s[at] != ':') fail("expected ':'")
                at++
                space()
                out[k] = value()
                space()
                if (at >= s.length) fail("unexpected end")
                when (s[at++]) {
                    ',' -> continue
                    '}' -> return out
                    else -> { at--; fail("expected ',' or '}'") }
                }
            }
        }

        fun arr(): List<Any?> {
            val out = ArrayList<Any?>()
            at++
            space()
            if (at < s.length && s[at] == ']') { at++; return out }
            while (true) {
                space()
                out.add(value())
                space()
                if (at >= s.length) fail("unexpected end")
                when (s[at++]) {
                    ',' -> continue
                    ']' -> return out
                    else -> { at--; fail("expected ',' or ']'") }
                }
            }
        }

        fun str(): String {
            val out = StringBuilder()
            at++
            while (true) {
                if (at >= s.length) fail("unterminated string")
                val c = s[at++]
                when {
                    c == '"' -> return out.toString()
                    c == '\\' -> {
                        if (at >= s.length) fail("unterminated string")
                        when (val e = s[at++]) {
                            '"' -> out.append('"'); '\\' -> out.append('\\'); '/' -> out.append('/')
                            'b' -> out.append('\b'); 'f' -> out.append('\u000C'); 'n' -> out.append('\n')
                            'r' -> out.append('\r'); 't' -> out.append('\t')
                            'u' -> {
                                if (at + 4 > s.length) fail("bad escape")
                                out.append(s.substring(at, at + 4).toIntOrNull(16)?.toChar() ?: fail("bad escape"))
                                at += 4
                            }
                            else -> fail("bad escape \\$e")
                        }
                    }
                    else -> out.append(c)
                }
            }
        }

        fun num(): Double {
            val start = at
            if (s[at] == '-') at++
            while (at < s.length && (s[at].isDigit() || s[at] in ".eE+-")) at++
            return s.substring(start, at).toDoubleOrNull() ?: fail("bad number")
        }
    }
}

@Suppress("UNCHECKED_CAST")
internal fun Any?.asObj(): Map<String, Any?>? = this as? Map<String, Any?>

internal fun Map<String, Any?>?.obj(key: String): Map<String, Any?> = this?.get(key).asObj() ?: emptyMap()

internal fun Map<String, Any?>?.num(key: String, fallback: Double): Double = (this?.get(key) as? Number)?.toDouble() ?: fallback

internal fun Map<String, Any?>?.str(key: String): String? = this?.get(key) as? String

internal fun Map<String, Any?>?.strings(key: String): List<String>? = (this?.get(key) as? List<*>)?.filterIsInstance<String>()

/** Truthy, as JavaScript reads a config value. */
internal fun truthy(v: Any?): Boolean = when (v) {
    null -> false
    is Boolean -> v
    is Number -> v.toDouble() != 0.0 && !v.toDouble().isNaN()
    is String -> v.isNotEmpty()
    else -> true
}
