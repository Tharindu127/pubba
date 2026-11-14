@file:JvmName("PubbaText")

package com.tharinduathapaththu.pubba

import java.text.Normalizer

/** JavaScript's \s, which the reference uses: Unicode white space plus the byte order mark. */
private const val JS_SPACE = "\t\n\u000B\u000C\r                  　﻿"

private fun isSpace(c: Char) = JS_SPACE.indexOf(c) >= 0

/** Trim like JavaScript's String.prototype.trim. */
internal fun jsTrim(s: String): String = s.trim(::isSpace)

/** Runs of white space become one space, then trimmed. */
internal fun collapse(s: String): String {
    val out = StringBuilder(s.length)
    var inSpace = false
    for (c in s) {
        if (isSpace(c)) {
            if (!inSpace) out.append(' ')
            inSpace = true
        } else {
            out.append(c)
            inSpace = false
        }
    }
    return jsTrim(out.toString())
}

/** Lowercase, accents off, punctuation to spaces (keeping + # . for C#, C++, Next.js). */
public fun normalize(s: String): String {
    val decomposed = Normalizer.normalize(s.lowercase(), Normalizer.Form.NFKD)
    val out = StringBuilder(decomposed.length)
    for (c in decomposed) {
        when {
            c in '̀'..'ͯ' -> {}
            c in 'a'..'z' || c in '0'..'9' || c == '+' || c == '#' || c == '.' || isSpace(c) -> out.append(c)
            else -> out.append(' ')
        }
    }
    return collapse(out.toString())
}

/** Optimal string alignment: a swap of two neighbouring characters counts once. */
public fun editDistance(a: String, b: String): Int {
    val d = Array(a.length + 1) { IntArray(b.length + 1) }
    for (i in 0..a.length) d[i][0] = i
    for (j in 0..b.length) d[0][j] = j
    for (i in 1..a.length) {
        for (j in 1..b.length) {
            val cost = if (a[i - 1] == b[j - 1]) 0 else 1
            d[i][j] = minOf(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) d[i][j] = minOf(d[i][j], d[i - 2][j - 2] + 1)
        }
    }
    return d[a.length][b.length]
}

/** Does a typed word mean this word? Exact, plural, prefix, or a near miss. */
@JvmOverloads
public fun closeTo(token: String?, word: String, typoMinLength: Double = 4.0): Boolean {
    if (token.isNullOrEmpty()) return false
    if (token == word || token == word + "s") return true
    // Short words and names with symbols (go, js, c#, next.js) must match exactly.
    if (word.length < 4 || word.any { it !in 'a'..'z' }) return false
    if (token.startsWith(word)) return true
    if (token.length < 3 || word.length < typoMinLength) return false
    val most = if (word.length >= 7) 2 else 1
    return editDistance(token, word) <= most || (token.length > word.length && editDistance(token.substring(0, word.length), word) <= most)
}

/** Does a normalised query contain this phrase, word by word, typos allowed? */
@JvmOverloads
public fun hasPhrase(query: String, phrase: String, typoMinLength: Double = 4.0): Boolean {
    val tokens = query.split(" ")
    val words = phrase.split(" ")
    for (i in 0..(tokens.size - words.size)) {
        if (words.indices.all { j -> closeTo(tokens[i + j], words[j], typoMinLength) }) return true
    }
    return false
}

/** Does a normalised query contain this normalised name as whole words? */
public fun containsName(query: String, name: String): Boolean = " $query ".contains(" $name ")
