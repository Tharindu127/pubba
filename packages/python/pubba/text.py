"""Text helpers behind matching (SPEC section 3)."""

from __future__ import annotations

import re
import unicodedata

# JavaScript's \s, which the reference uses: Unicode white space plus the byte order mark.
_JS_SPACE = "\t\n\v\f\r                  　﻿"
_SPACE_CLASS = "[" + re.escape(_JS_SPACE) + "]"
_SPACES = re.compile(_SPACE_CLASS + "+")
_OTHER = re.compile("[^a-z0-9+#." + re.escape(_JS_SPACE) + "]")
_MARKS = re.compile("[̀-ͯ]")
_NOT_LETTER = re.compile("[^a-z]")


def js_trim(s: str) -> str:
    """Trim like JavaScript's String.prototype.trim."""
    return s.strip(_JS_SPACE)


def collapse(s: str) -> str:
    """Runs of white space become one space, then trimmed."""
    return js_trim(_SPACES.sub(" ", s))


def normalize(s: str) -> str:
    """Lowercase, accents off, punctuation to spaces (keeping + # . for C#, C++, Next.js)."""
    s = unicodedata.normalize("NFKD", s.lower())
    s = _MARKS.sub("", s)
    s = _OTHER.sub(" ", s)
    return collapse(s)


def edit_distance(a: str, b: str) -> int:
    """Optimal string alignment: a swap of two neighbouring characters counts once."""
    d = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        d[i][0] = i
    for j in range(len(b) + 1):
        d[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            cost = 0 if a[i - 1] == b[j - 1] else 1
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                d[i][j] = min(d[i][j], d[i - 2][j - 2] + 1)
    return d[len(a)][len(b)]


def close_to(token: str | None, word: str, typo_min_length: float = 4) -> bool:
    """Does a typed word mean this word? Exact, plural, prefix, or a near miss."""
    if not token:
        return False
    if token == word or token == word + "s":
        return True
    # Short words and names with symbols (go, js, c#, next.js) must match exactly.
    if len(word) < 4 or _NOT_LETTER.search(word):
        return False
    if token.startswith(word):
        return True
    if len(token) < 3 or len(word) < typo_min_length:
        return False
    most = 2 if len(word) >= 7 else 1
    return edit_distance(token, word) <= most or (len(token) > len(word) and edit_distance(token[: len(word)], word) <= most)


def has_phrase(query: str, phrase: str, typo_min_length: float = 4) -> bool:
    """Does a normalised query contain this phrase, word by word, typos allowed?"""
    tokens = query.split(" ")
    words = phrase.split(" ")
    for i in range(len(tokens) - len(words) + 1):
        if all(close_to(tokens[i + j], w, typo_min_length) for j, w in enumerate(words)):
            return True
    return False


def contains_name(query: str, name: str) -> bool:
    """Does a normalised query contain this normalised name as whole words?"""
    return (" " + name + " ") in (" " + query + " ")
