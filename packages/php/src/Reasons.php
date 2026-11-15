<?php

declare(strict_types=1);

namespace Pubba;

use Closure;

/**
 * Sentences (SPEC section 6). A template is a string, a JSON-shaped array
 * (cases, out, in, default) or a Closure(Reason, Entity $item, ?Entity $other): string.
 */
final class Reasons
{
    public const DEFAULT_TEMPLATES = [
        'section' => '{item} is worth a look.',
        'typed' => '{item} matches what you typed.',
        'match' => '{item} matches “{name}”.',
    ];

    private const TOKEN = '/\{(\w+)\}/';
    private const OPTIONAL = '/\[([^\]]*)\]/';

    /** The reason a link gives for the entity at one of its ends. */
    public static function fromLink(Link $link, string $itemId, ?string $seed = null): Reason
    {
        $to = $link->otherEnd($itemId);
        return new Reason(
            $link->kind,
            to: $to,
            direction: $link->from === $itemId ? 'out' : 'in',
            via: $link->via === null || $link->via === [] ? null : $link->via,
            seed: $seed === null || $seed === '' || $seed === $to ? null : $seed,
        );
    }

    /** @param array<string, string> $values */
    private static function fill(string $text, array $values): string
    {
        $kept = preg_replace_callback(self::OPTIONAL, static function (array $m) use ($values): string {
            preg_match_all(self::TOKEN, $m[1], $tokens);
            foreach ($tokens[1] as $t) {
                if (($values[$t] ?? '') === '') {
                    return '';
                }
            }
            return $m[1];
        }, $text) ?? $text;
        return preg_replace_callback(self::TOKEN, static fn (array $m): string => $values[$m[1]] ?? '', $kept) ?? $kept;
    }

    private static function pick(mixed $t, Reason $reason, Entity $item, ?Entity $other): ?string
    {
        if (is_string($t)) {
            return $t;
        }
        if ($t instanceof Closure) {
            return $t($reason, $item, $other);
        }
        if (!is_array($t)) {
            return null;
        }
        foreach (is_array($t['cases'] ?? null) ? $t['cases'] : [] as $c) {
            if (!is_array($c)) {
                continue;
            }
            $ci = Text::str($c['item'] ?? null) ?? '';
            $co = Text::str($c['other'] ?? null) ?? '';
            $cd = Text::str($c['direction'] ?? null) ?? '';
            if (($ci === '' || $ci === $item->type) && ($co === '' || ($other !== null && $co === $other->type)) && ($cd === '' || $cd === $reason->direction)) {
                return Text::str($c['text'] ?? null);
            }
        }
        if ($reason->direction === 'out' && (Text::str($t['out'] ?? null) ?? '') !== '') {
            return $t['out'];
        }
        if ($reason->direction === 'in' && (Text::str($t['in'] ?? null) ?? '') !== '') {
            return $t['in'];
        }
        foreach (['default', 'out', 'in'] as $k) {
            $s = Text::str($t[$k] ?? null);
            if ($s !== null) {
                return $s;
            }
        }
        return null;
    }

    /**
     * A reason as one sentence.
     *
     * @param array<string, mixed>|null $templates
     */
    public static function render(Graph $g, Reason $reason, Entity $item, ?array $templates = null): string
    {
        $every = array_replace(self::DEFAULT_TEMPLATES, Text::obj($g->config['templates'] ?? null), $templates ?? []);
        $other = $reason->to === null || $reason->to === '' ? null : ($g->entities[$reason->to] ?? null);
        $t = $every[$reason->kind . '.' . $item->type] ?? $every[$reason->kind] ?? null;
        $text = $t !== null && Text::truthy($t) ? self::pick($t, $reason, $item, $other) : null;
        $text ??= $other !== null
            ? ($reason->direction === 'in' ? '{other}: {kind} {item}[ ({via})].' : '{item}: {kind} {other}[ ({via})].')
            : '{item} is worth a look.';
        if ($t instanceof Closure) {
            return $text;
        }
        $otherLabel = $other?->shortLabel() ?? '';
        return self::fill($text, [
            'item' => $item->shortLabel(),
            'other' => $otherLabel,
            'otherLower' => mb_strtolower($otherLabel, 'UTF-8'),
            'via' => implode(', ', array_slice($reason->via ?? [], 0, 3)),
            'kind' => $g->kindLabel($reason->kind),
            'name' => $reason->name ?? '',
        ]);
    }
}
