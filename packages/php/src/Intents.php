<?php

declare(strict_types=1);

namespace Pubba;

/**
 * Intent profiles (SPEC 5.7, 5.8): a guess at why this visit is happening, from
 * the trail alone. Once one intent is likely, it leans suggestions towards what
 * it boosts, within 0.5-2x, so it reorders but never hides. Nothing is stored.
 */
final class Intents
{
    /** @return list<array{string, array<string, mixed>}> The configured intents, in order ("browsing" is reserved). */
    public static function of(Graph $g): array
    {
        $out = [];
        foreach (Text::obj($g->config['intents'] ?? null) as $id => $c) {
            $id = (string) $id;
            if ($id !== 'browsing' && is_array($c)) {
                $out[] = [$id, $c];
            }
        }
        return $out;
    }

    /** @return array<string, mixed>|null */
    private static function find(Graph $g, string $intent): ?array
    {
        foreach (self::of($g) as [$id, $c]) {
            if ($id === $intent) {
                return $c;
            }
        }
        return null;
    }

    /** @param array<array-key, mixed>|null $weights */
    private static function weight(?array $weights, string $key, float $fallback): float
    {
        return Text::num($weights[$key] ?? null, $fallback);
    }

    /** @param list<string> $trail */
    public static function read(Graph $g, array $trail): IntentReading
    {
        $intents = self::of($g);
        $settings = Text::obj($g->config['intent'] ?? null);
        $minConfidence = Text::num($settings['minConfidence'] ?? null, 0.5);
        $minSteps = Text::num($settings['minSteps'] ?? null, 2);
        $share = Text::num($settings['neighbours'] ?? null, 0.5);
        $next = Text::obj($g->config['next'] ?? null);
        $recency = Text::num($next['recency'] ?? null, 0.6);
        $sections = Text::obj($next['sections'] ?? null);

        $seeds = [];
        foreach (array_reverse($trail) as $id) {
            $found = false;
            foreach ($seeds as [$s]) {
                if ($s === $id) {
                    $found = true;
                    break;
                }
            }
            if (!$found) {
                $seeds[] = [$id, $recency ** count($seeds)];
            }
        }
        $steps = 0;
        foreach ($seeds as [$id]) {
            if (!str_starts_with($id, 'section:') && $g->find($id) !== null) {
                $steps++;
            }
        }

        $raw = [];
        $evidence = [];
        foreach ($intents as [, $intent]) {
            $signals = Text::obj($intent['signals'] ?? null);
            $E = Text::obj($signals['entities'] ?? null);
            $T = Text::obj($signals['types'] ?? null);
            $K = Text::obj($signals['kinds'] ?? null);
            $sum = 0.0;
            $ev = [];
            foreach ($seeds as [$step, $w]) {
                $via = null;
                if (str_starts_with($step, 'section:')) {
                    $type = Text::str($sections[substr($step, 8)] ?? null);
                    if ($type === null || $type === '') {
                        continue;
                    }
                    $part = $w * self::weight($T, $type, 0);
                } else {
                    $e = $g->find($step);
                    if ($e === null) {
                        continue;
                    }
                    $self = self::weight($E, $e->id, 0) + self::weight($T, $e->type, 0);
                    $best = 0.0;
                    $bestVia = null;
                    foreach ($g->adjacent[$step] ?? [] as $l) {
                        $n = $l->otherEnd($step);
                        $v = $l->weight * (self::weight($E, $n, 0) + self::weight($K, $l->kind, 0));
                        if ($v > $best) {
                            $best = $v;
                            $bestVia = $n;
                        }
                    }
                    $near = $share * $best;
                    if ($near > $self) {
                        $via = $bestVia;
                    }
                    $part = $w * ($self + $near);
                }
                $sum += $part;
                if ($part > 0) {
                    $ev[] = new IntentEvidence($step, $via, $part);
                }
            }
            $raw[] = max(0.0, $sum);
            $evidence[] = $ev;
        }

        $sumRaw = 0.0;
        foreach ($raw as $r) {
            $sumRaw += $r;
        }
        $total = 1 + $sumRaw;
        $scores = [];
        $top = -1;
        foreach ($intents as $i => [$id]) {
            $scores[$id] = $raw[$i] / $total;
            if ($top < 0 || $raw[$i] > $raw[$top]) {
                $top = $i;
            }
        }
        $scores['browsing'] = 1 / $total;
        $confidence = $top < 0 ? 0.0 : $raw[$top] / $total;
        $likely = $top >= 0 && $raw[$top] > 0 && $confidence >= $minConfidence && $steps >= $minSteps ? $intents[$top][0] : null;
        return new IntentReading($likely, $confidence, $scores, $top < 0 ? [] : $evidence[$top]);
    }

    /**
     * The intent to apply: "auto" works it out from the trail, an id names one, null is none.
     *
     * @param list<string> $trail
     */
    public static function resolve(Graph $g, array $trail, ?string $option): ?string
    {
        if ($option === null || self::of($g) === []) {
            return null;
        }
        if ($option === 'auto') {
            return self::read($g, $trail)->likely;
        }
        return self::find($g, $option) !== null ? $option : null;
    }

    /** How much an intent leans towards an entity reached by a link: clamped to 0.5-2. */
    public static function boost(Graph $g, string $intent, Entity $e, ?Link $link): float
    {
        $b = Text::obj(self::find($g, $intent)['boost'] ?? null);
        $v = self::weight(Text::obj($b['types'] ?? null), $e->type, 1)
            * self::weight(Text::obj($b['entities'] ?? null), $e->id, 1)
            * ($link !== null ? self::weight(Text::obj($b['kinds'] ?? null), $link->kind, 1) : 1);
        return min(2.0, max(0.5, $v));
    }

    /** An intent's label, for the {intent} token. */
    public static function label(Graph $g, string $intent): string
    {
        return Text::str(self::find($g, $intent)['label'] ?? null) ?? $intent;
    }
}
