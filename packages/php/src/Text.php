<?php

declare(strict_types=1);

namespace Pubba;

/**
 * Text helpers behind matching (SPEC section 3). Lengths and edit distances are
 * in UTF-16 code units, as in the JavaScript reference.
 */
final class Text
{
    /** JavaScript's \s: Unicode white space plus the byte order mark. */
    private const SPACE = '\x{0009}-\x{000D}\x{0020}\x{00A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}';

    /** @var array<int, string>|null */
    private static ?array $fold = null;

    /** @var array<string, string> */
    private static array $normalized = [];

    /** Trim like JavaScript's String.prototype.trim. */
    public static function jsTrim(string $s): string
    {
        return preg_replace('/^[' . self::SPACE . ']+|[' . self::SPACE . ']+\z/u', '', $s) ?? trim($s);
    }

    /** Runs of white space become one space, then trimmed. */
    public static function collapse(string $s): string
    {
        return self::jsTrim(preg_replace('/[' . self::SPACE . ']+/u', ' ', $s) ?? $s);
    }

    /** Lowercase, accents off, punctuation to spaces (keeping + # . for C#, C++, Next.js). */
    public static function normalize(string $s): string
    {
        if (isset(self::$normalized[$s])) {
            return self::$normalized[$s];
        }
        self::$fold ??= require __DIR__ . '/FoldTable.php';
        $out = '';
        $n = strlen($s);
        for ($i = 0; $i < $n;) {
            $b = ord($s[$i]);
            if ($b < 0x80) {
                if ($b >= 0x41 && $b <= 0x5A) {
                    $out .= chr($b + 32);
                } elseif (($b >= 0x61 && $b <= 0x7A) || ($b >= 0x30 && $b <= 0x39) || $b === 0x2B || $b === 0x23 || $b === 0x2E) {
                    $out .= $s[$i];
                } else {
                    $out .= ' ';
                }
                $i++;
                continue;
            }
            $len = $b >= 0xF0 ? 4 : ($b >= 0xE0 ? 3 : ($b >= 0xC0 ? 2 : 1));
            $cp = mb_ord(substr($s, $i, $len), 'UTF-8');
            $out .= $cp === false ? ' ' : (self::$fold[$cp] ?? ' ');
            $i += $len;
        }
        $result = trim(preg_replace('/ +/', ' ', $out) ?? $out, ' ');
        if (count(self::$normalized) > 10000) {
            self::$normalized = [];
        }
        return self::$normalized[$s] = $result;
    }

    /**
     * A string as UTF-16 code units.
     *
     * @return list<int>
     */
    public static function units(string $s): array
    {
        if (!preg_match('/[\x80-\xFF]/', $s)) {
            return $s === '' ? [] : array_values(unpack('C*', $s));
        }
        $u = mb_convert_encoding($s, 'UTF-16BE', 'UTF-8');
        return $u === '' ? [] : array_values(unpack('n*', $u));
    }

    /** Length in UTF-16 code units, as JavaScript counts it. */
    public static function length(string $s): int
    {
        return preg_match('/[\x80-\xFF]/', $s) ? intdiv(strlen(mb_convert_encoding($s, 'UTF-16BE', 'UTF-8')), 2) : strlen($s);
    }

    /**
     * @param list<int> $a
     * @param list<int> $b
     */
    private static function distanceOf(array $a, array $b): int
    {
        $n = count($a);
        $m = count($b);
        $d = [];
        for ($i = 0; $i <= $n; $i++) {
            $d[$i] = array_fill(0, $m + 1, 0);
            $d[$i][0] = $i;
        }
        for ($j = 0; $j <= $m; $j++) {
            $d[0][$j] = $j;
        }
        for ($i = 1; $i <= $n; $i++) {
            for ($j = 1; $j <= $m; $j++) {
                $cost = $a[$i - 1] === $b[$j - 1] ? 0 : 1;
                $v = min($d[$i - 1][$j] + 1, $d[$i][$j - 1] + 1, $d[$i - 1][$j - 1] + $cost);
                if ($i > 1 && $j > 1 && $a[$i - 1] === $b[$j - 2] && $a[$i - 2] === $b[$j - 1]) {
                    $v = min($v, $d[$i - 2][$j - 2] + 1);
                }
                $d[$i][$j] = $v;
            }
        }
        return $d[$n][$m];
    }

    /** Optimal string alignment: a swap of two neighbouring characters counts once. */
    public static function editDistance(string $a, string $b): int
    {
        return self::distanceOf(self::units($a), self::units($b));
    }

    /** Does a typed word mean this word? Exact, plural, prefix, or a near miss. */
    public static function closeTo(?string $token, string $word, float $typoMinLength = 4): bool
    {
        if ($token === null || $token === '') {
            return false;
        }
        if ($token === $word || $token === $word . 's') {
            return true;
        }
        // Short words and names with symbols (go, js, c#, next.js) must match exactly.
        $wordLength = self::length($word);
        if ($wordLength < 4 || preg_match('/[^a-z]/', $word)) {
            return false;
        }
        if (str_starts_with($token, $word)) {
            return true;
        }
        $t = self::units($token);
        if (count($t) < 3 || $wordLength < $typoMinLength) {
            return false;
        }
        $w = self::units($word);
        $most = $wordLength >= 7 ? 2 : 1;
        return self::distanceOf($t, $w) <= $most
            || (count($t) > $wordLength && self::distanceOf(array_slice($t, 0, $wordLength), $w) <= $most);
    }

    /** Does a normalised query contain this phrase, word by word, typos allowed? */
    public static function hasPhrase(string $query, string $phrase, float $typoMinLength = 4): bool
    {
        $tokens = explode(' ', $query);
        $words = explode(' ', $phrase);
        for ($i = 0; $i <= count($tokens) - count($words); $i++) {
            $all = true;
            foreach ($words as $j => $w) {
                if (!self::closeTo($tokens[$i + $j], $w, $typoMinLength)) {
                    $all = false;
                    break;
                }
            }
            if ($all) {
                return true;
            }
        }
        return false;
    }

    /** Does a normalised query contain this normalised name as whole words? */
    public static function containsName(string $query, string $name): bool
    {
        return str_contains(" $query ", " $name ");
    }

    /**
     * A stable sort: equal elements keep their order, as in JavaScript (PHP 8's usort is stable).
     *
     * @template T
     * @param iterable<T> $items
     * @param callable(T, T): int $compare
     * @return list<T>
     */
    public static function stableSorted(iterable $items, callable $compare): array
    {
        $list = [];
        foreach ($items as $item) {
            $list[] = $item;
        }
        usort($list, $compare);
        return $list;
    }

    // JSON-shaped config, read the way JavaScript reads it.

    /** @return array<array-key, mixed> */
    public static function obj(mixed $v): array
    {
        return is_array($v) ? $v : [];
    }

    public static function num(mixed $v, float $fallback): float
    {
        return is_int($v) || is_float($v) ? (float) $v : $fallback;
    }

    public static function str(mixed $v): ?string
    {
        return is_string($v) ? $v : null;
    }

    /** @return list<string>|null */
    public static function strings(mixed $v): ?array
    {
        return is_array($v) && array_is_list($v) ? array_values(array_filter($v, 'is_string')) : null;
    }

    public static function truthy(mixed $v): bool
    {
        if ($v === null || $v === false) {
            return false;
        }
        if (is_int($v) || is_float($v)) {
            return $v != 0 && !is_nan((float) $v);
        }
        if (is_string($v)) {
            return $v !== '';
        }
        return true;
    }
}
