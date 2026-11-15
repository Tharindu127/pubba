<?php

declare(strict_types=1);

namespace Pubba;

use InvalidArgumentException;

/** Answers from one graph: related items, what next, matching, sentences, measurement. */
final class Pubba
{
    public const VERSION = '1.0.0';

    private const DEFAULT_STOP_WORDS = ['the', 'app', 'and', 'for', 'web', 'application', 'mobile', 'portal', 'site', 'website'];
    private const DEFAULT_SIMILAR = '\b(like|similar|alike|same stack|related to|anything else)\b';
    private const STRONG = 50.0;

    public readonly Track $track;
    private string $similarRe;

    public function __construct(public readonly Graph $graph, private readonly ?Events $events = null)
    {
        $this->track = new Track($graph, $events);
        $pattern = Text::str(Text::obj($graph->config['match'] ?? null)['similarPattern'] ?? null) ?? self::DEFAULT_SIMILAR;
        $this->similarRe = '~' . str_replace('~', '\~', $pattern) . '~';
    }

    /**
     * Answers from a compiled bundle (`pubba compile`): JSON text or decoded JSON.
     *
     * @param string|array<string, mixed> $bundle
     */
    public static function load(string|array $bundle, ?Events $events = null): self
    {
        return new self(Graph::fromBundle($bundle), $events);
    }

    public function get(string $id): ?Entity
    {
        return $this->graph->entities[$id] ?? null;
    }

    /** The same graph, reporting to these events. */
    public function withEvents(?Events $events): self
    {
        return new self($this->graph, $events);
    }

    /**
     * @param list<string> $ids
     * @param list<string> $kinds
     */
    private function suggested(string $source, array $ids, array $kinds, ?string $intent): void
    {
        if ($this->events === null || $ids === []) {
            return;
        }
        $event = ['type' => 'suggested', 'source' => $source, 'ids' => $ids, 'reasonKinds' => array_values(array_unique($kinds))];
        if ($intent !== null) {
            $event['intent'] = $intent;
        }
        $this->events->emit($event);
    }

    /** Compares numbers as JavaScript's `a - b` does (so -0 and 0 tie). */
    private static function cmp(float $a, float $b): int
    {
        return $a <=> $b;
    }

    // --- matching

    /** @return list<string> */
    private static function significant(string $name, array $stop): array
    {
        return array_values(array_filter(explode(' ', $name), static fn (string $w) => strlen($w) > 2 && !isset($stop[$w])));
    }

    private static function coverage(string $q, string $name, float $typo): float
    {
        $nameTokens = explode(' ', $name);
        $queryTokens = explode(' ', $q);
        $inQuery = 0;
        foreach ($nameTokens as $w) {
            if (Text::hasPhrase($q, $w, $typo)) {
                $inQuery++;
            }
        }
        $explained = 0;
        foreach ($queryTokens as $t) {
            foreach ($nameTokens as $w) {
                if ($t === $w || Text::hasPhrase($t, $w, $typo)) {
                    $explained++;
                    break;
                }
            }
        }
        return 0.5 * ($inQuery / count($nameTokens)) + 0.4 * ($explained / count($queryTokens));
    }

    /**
     * @param array<string, mixed> $m
     * @param array{stop: array<string, true>, typo: float, partial: bool, precise: bool, distinct: ?array<string, true>} $s
     * @return array{float, string, string}|null score, by, name
     */
    private static function scoreName(string $q, string $name, bool $isAlias, array $m, array $s): ?array
    {
        $len = strlen($name);
        if ($name === '' || $len < Text::num($m['minLength'] ?? null, 0)) {
            return null;
        }
        $has = static fn (string $w): bool => Text::hasPhrase($q, $w, $s['typo']);
        if ((Text::str($m['mode'] ?? null) ?? 'title') === 'phrase') {
            if ($len < 2 || !$has($name)) {
                return null;
            }
            $exact = !$s['precise'] || Text::containsName($q, $name);
            return [($exact ? 100 : 95) + $len, $isAlias ? 'alias' : 'phrase', $name];
        }
        if (Text::containsName($q, $name)) {
            return [100.0 + $len, $isAlias ? 'alias' : 'name', $name];
        }
        if ($s['precise'] && str_contains($name, ' ') && $has($name)) {
            return [95.0 + $len, $isAlias ? 'alias' : 'name', $name];
        }
        $words = self::significant($name, $s['stop']);
        $hits = count(array_filter($words, $has));
        if ($hits > 0 && $hits === count($words) && strlen(implode('', $words)) > Text::num($m['minWordsLength'] ?? null, 0)) {
            return [50 + $hits + ($s['precise'] ? self::coverage($q, $name, $s['typo']) : 0), 'words', $name];
        }
        if ($s['partial'] && count($words) >= 3 && $hits >= 2 && $hits === count($words) - 1) {
            return [40.0 + $hits, 'words', $name];
        }
        if ($s['distinct'] !== null) {
            foreach ($words as $w) {
                if (strlen($w) >= 5 && isset($s['distinct'][$w]) && Text::hasPhrase($q, $w, INF)) {
                    return [25.0, 'distinct-word', $w];
                }
            }
        }
        $first = $words[0] ?? null;
        if (Text::truthy($m['firstWord'] ?? null) && $first !== null && strlen($first) > 3 && $has($first)) {
            return [20.0, 'first-word', $first];
        }
        return null;
    }

    /**
     * Every entity a query could mean, best first.
     *
     * @param list<string>|null $types
     * @param array<string, mixed>|null $templates
     * @return list<EntityMatch>
     */
    public function search(string $query, int $limit = 10, ?array $types = null, ?array $templates = null): array
    {
        $q = Text::normalize($query);
        if ($q === '') {
            return [];
        }
        $mc = Text::obj($this->graph->config['match'] ?? null);
        $s = [
            'stop' => array_fill_keys(Text::strings($mc['stopWords'] ?? null) ?? self::DEFAULT_STOP_WORDS, true),
            'typo' => Text::num($mc['typoMinLength'] ?? null, 4),
            'partial' => Text::truthy($mc['partialWords'] ?? null),
            'precise' => Text::truthy($mc['precise'] ?? null),
            'distinct' => Text::truthy($mc['distinctWords'] ?? null) ? $this->graph->distinctWords : null,
        ];
        $ignore = array_values(array_filter(array_map([Text::class, 'normalize'], Text::strings($mc['ignore'] ?? null) ?? []), static fn ($w) => $w !== ''));
        $out = [];
        foreach ($this->graph->allEntities() as $entity) {
            if ($types !== null && !in_array($entity->type, $types, true)) {
                continue;
            }
            $m = Text::obj($this->graph->typeConfig($entity->type)['match'] ?? null);
            if (Text::truthy($m['skip'] ?? null)) {
                continue;
            }
            $best = null;
            $names = [[$entity->label, false]];
            foreach ($entity->aliases as $a) {
                $names[] = [$a, true];
            }
            foreach ($names as [$raw, $isAlias]) {
                $name = Text::normalize($raw);
                foreach ($ignore as $w) {
                    if (str_contains($name, $w)) {
                        continue 2;
                    }
                }
                $sc = self::scoreName($q, $name, $isAlias, $m, $s);
                if ($sc !== null && ($best === null || $sc[0] > $best[0])) {
                    $best = $sc;
                }
            }
            if ($best === null) {
                continue;
            }
            $reason = new Reason('match', by: $best[1], name: $best[2]);
            $out[] = new EntityMatch($entity, (float) $best[0], (int) Text::num($m['tier'] ?? null, 1), $reason, Reasons::render($this->graph, $reason, $entity, $templates));
        }
        $weak = static fn (EntityMatch $x): int => $s['precise'] && $x->score < self::STRONG ? 1 : 0;
        $sorted = Text::stableSorted($out, static function (EntityMatch $a, EntityMatch $b) use ($weak): int {
            if ($weak($a) !== $weak($b)) {
                return $weak($a) - $weak($b);
            }
            if ($a->tier !== $b->tier) {
                return $a->tier - $b->tier;
            }
            return self::cmp($b->score, $a->score);
        });
        return array_slice($sorted, 0, max(0, $limit));
    }

    /**
     * What a query means: one entity, things like one, or nothing here.
     *
     * @param array<string, mixed>|null $templates
     */
    public function match(string $query, int $similarLimit = 3, ?array $templates = null): MatchResult
    {
        $result = $this->matchQuietly($query, $similarLimit, $templates);
        if ($this->events !== null) {
            $event = ['type' => 'matched', 'intent' => $result->intent];
            if ($result->entity !== null) {
                $event['entityType'] = $result->entity->type;
            }
            $by = $result->match?->reason->by;
            if ($by !== null && $by !== '') {
                $event['by'] = $by;
            }
            $this->events->emit($event);
        }
        return $result;
    }

    /** @param array<string, mixed>|null $templates */
    private function matchQuietly(string $query, int $similarLimit, ?array $templates): MatchResult
    {
        $best = $this->search($query, 1, null, $templates)[0] ?? null;
        $q = Text::normalize($query);
        $mc = Text::obj($this->graph->config['match'] ?? null);
        $typo = Text::num($mc['typoMinLength'] ?? null, 4);
        $missing = null;
        foreach (Text::strings($mc['notHere'] ?? null) ?? [] as $raw) {
            $name = Text::normalize($raw);
            if ($name !== '' && Text::hasPhrase($q, $name, $typo) && ($missing === null || strlen($name) > strlen($missing[1]))) {
                $missing = [$raw, $name];
            }
        }
        if ($missing !== null) {
            $bestName = $best === null ? null : (($best->reason->name ?? '') === '' ? Text::normalize($best->entity->label) : $best->reason->name);
            if ($bestName === null || strlen($missing[1]) > strlen($bestName)) {
                return new MatchResult($query, 'none', notHere: $missing[0]);
            }
        }
        if ($best === null) {
            return new MatchResult($query, 'none');
        }
        $kinds = $this->graph->typeConfig($best->entity->type)['similar'] ?? null;
        if ($kinds !== false && preg_match($this->similarRe, $q)) {
            $similar = [];
            foreach ($this->neighbours($best->entity->id, Text::strings($kinds)) as [$e, $l]) {
                if (count($similar) >= $similarLimit) {
                    break;
                }
                if (!$this->graph->isDestination($e)) {
                    continue;
                }
                $r = Reasons::fromLink($l, $e->id);
                $similar[] = new Related($e, $l->weight, $l, $r, Reasons::render($this->graph, $r, $e, $templates));
            }
            if ($similar !== []) {
                return new MatchResult($query, 'similar', $best->entity, $best, $similar);
            }
        }
        return new MatchResult($query, 'entity', $best->entity, $best);
    }

    // --- related and next

    /**
     * @param list<string>|null $kinds
     * @return list<array{Entity, Link}>
     */
    private function neighbours(string $id, ?array $kinds): array
    {
        $out = [];
        foreach ($this->graph->adjacent[$id] ?? [] as $l) {
            if ($kinds !== null && !in_array($l->kind, $kinds, true)) {
                continue;
            }
            $e = $this->graph->entities[$l->otherEnd($id)] ?? null;
            if ($e !== null) {
                $out[] = [$e, $l];
            }
        }
        return Text::stableSorted($out, static fn (array $a, array $b): int => self::cmp($b[1]->weight, $a[1]->weight));
    }

    /**
     * What is related to one entity, strongest link first, each with why. With a
     * named intent, links rank by weight times its boost; `weight` stays the link's.
     *
     * @param list<string>|null $kinds
     * @param (callable(Entity): bool)|null $accept
     * @param array<string, mixed>|null $templates
     * @return list<Related>
     */
    public function related(string $id, ?array $kinds = null, ?int $limit = null, bool $destinationsOnly = true, ?callable $accept = null, ?array $templates = null, ?string $intent = null): array
    {
        $g = $this->graph;
        $intent = $intent === 'auto' ? null : Intents::resolve($g, [], $intent);
        $pairs = [];
        foreach ($this->neighbours($id, $kinds) as [$e, $l]) {
            if ((!$destinationsOnly || $g->isDestination($e)) && ($accept === null || $accept($e))) {
                $pairs[] = [$e, $l, count($pairs), $intent === null ? 1.0 : Intents::boost($g, $intent, $e, $l)];
            }
        }
        $order = static function (bool $boosted) use ($pairs, $g, $limit): array {
            $sorted = Text::stableSorted($pairs, static function (array $a, array $b) use ($g, $boosted): int {
                $w = $boosted ? self::cmp($b[1]->weight * $b[3], $a[1]->weight * $a[3]) : self::cmp($b[1]->weight, $a[1]->weight);
                return $w !== 0 ? $w : self::cmp($g->pull($b[1]->kind), $g->pull($a[1]->kind));
            });
            return $limit === null ? $sorted : array_slice($sorted, 0, max(0, $limit));
        };
        $plain = array_map(static fn (array $p) => $p[2], $order(false));
        $chosen = $intent === null ? $order(false) : $order(true);
        $out = [];
        foreach ($chosen as $i => [$e, $l, $k, $b]) {
            $r = Reasons::fromLink($l, $e->id);
            if ($intent !== null && $b != 1 && array_search($k, $plain, true) !== $i) {
                $r = $r->withIntent(new ReasonIntent($intent, $b));
            }
            $out[] = new Related($e, $l->weight, $l, $r, Reasons::render($g, $r, $e, $templates));
        }
        $this->suggested('related', array_map(static fn (Related $x) => $x->entity->id, $out), array_map(static fn (Related $x) => $x->reason->kind, $out), $intent);
        return $out;
    }

    /**
     * How brightly each entity lights up for this trail, with the strongest reason for each.
     *
     * @param list<string> $trail
     */
    public function spread(array $trail): Spread
    {
        $g = $this->graph;
        $cfg = Text::obj($g->config['next'] ?? null);
        $recency = Text::num($cfg['recency'] ?? null, 0.6);
        $second = Text::num($cfg['secondStep'] ?? null, 0.4);
        $hub = Text::num($cfg['hubDamping'] ?? null, 3);
        $boost = Text::num($cfg['sectionBoost'] ?? null, 0.08);
        $sections = Text::obj($cfg['sections'] ?? null);
        $score = [];
        $why = [];
        $sectionOnly = [];

        $give = static function (string $id, float $part, Link $link, string $src, string $seed) use (&$score, &$why): void {
            $score[$id] = ($score[$id] ?? 0.0) + $part;
            if ($part > (isset($why[$id]) ? $why[$id]->part : 0.0)) {
                $why[$id] = new Why($link, $src, $seed, $part);
            }
        };

        $seeds = [];
        foreach (array_reverse($trail) as $id) {
            if (!array_key_exists($id, $seeds)) {
                $seeds[$id] = $recency ** count($seeds);
            }
        }
        foreach ($seeds as $seed => $w) {
            $seed = (string) $seed;
            if (str_starts_with($seed, 'section:')) {
                $type = Text::str($sections[substr($seed, 8)] ?? null);
                if ($type === null || $type === '') {
                    continue;
                }
                foreach ($g->entities as $e) {
                    if ($e->type !== $type) {
                        continue;
                    }
                    $score[$e->id] = ($score[$e->id] ?? 0.0) + $w * $boost * min(1, $g->degree($e->id) / 8);
                    $sectionOnly[$e->id] = true;
                }
                continue;
            }
            foreach ($g->adjacent[$seed] ?? [] as $l1) {
                $mid = $l1->otherEnd($seed);
                $a = $w * $l1->weight * $g->pull($l1->kind);
                $give($mid, $a, $l1, $seed, $seed);
                $carry = ($a * $second) / sqrt(1 + $g->degree($mid) / $hub);
                foreach ($g->adjacent[$mid] ?? [] as $l2) {
                    $far = $l2->otherEnd($mid);
                    if ($far === $seed) {
                        continue;
                    }
                    $give($far, $carry * $l2->weight * $g->pull($l2->kind), $l2, $mid, $seed);
                }
            }
        }
        return new Spread($score, $why, $seeds, $sectionOnly);
    }

    /**
     * Why this visit is likely happening, from the trail alone (config `intents`). Never stored or sent.
     *
     * @param list<string> $trail
     */
    public function intent(array $trail): IntentReading
    {
        return Intents::read($this->graph, $trail);
    }

    /**
     * Ranked by score, then mixed: never all of one type when there's a choice, filled up when there isn't.
     *
     * @param list<array{Entity, float, ?Why, float}> $candidates
     * @return list<array{Entity, float, ?Why, float}>
     */
    private static function mix(array $candidates, int $limit): array
    {
        $byScore = Text::stableSorted($candidates, static fn (array $a, array $b): int => self::cmp($b[1], $a[1]));
        $cap = max(1, $limit - 1);
        $taken = [];
        $perType = [];
        foreach ($byScore as $i => [$e]) {
            if (count($taken) === $limit) {
                break;
            }
            if (($perType[$e->type] ?? 0) >= $cap) {
                continue;
            }
            $perType[$e->type] = ($perType[$e->type] ?? 0) + 1;
            $taken[] = $i;
        }
        foreach (array_keys($byScore) as $i) {
            if (count($taken) < $limit && !in_array($i, $taken, true)) {
                $taken[] = $i;
            }
        }
        return Text::stableSorted(array_map(static fn (int $i) => $byScore[$i], $taken), static fn (array $a, array $b): int => self::cmp($b[1], $a[1]));
    }

    /**
     * The next things to suggest after this trail: unseen, worth going to, and mixed.
     * $intent: "auto" (the default) leans towards the visitor's likely intent when
     * intents are configured; an id names one; null turns it off.
     *
     * @param list<string> $trail
     * @param list<string> $exclude
     * @param (callable(Entity): bool)|null $accept
     * @param array<string, mixed>|null $templates
     * @return list<Suggestion>
     */
    public function next(array $trail, int $limit = 3, array $exclude = [], ?callable $accept = null, ?array $templates = null, ?string $intent = 'auto'): array
    {
        $g = $this->graph;
        $sp = $this->spread($trail);
        $skip = $sp->seeds;
        foreach ($exclude as $x) {
            $skip[$x] = true;
        }
        $candidates = [];
        foreach ($sp->score as $id => $s) {
            $id = (string) $id;
            $e = $g->entities[$id] ?? null;
            if ($e === null) {
                continue;
            }
            if (!(isset($sp->why[$id]) || isset($sp->sectionOnly[$id])) || !$g->isDestination($e) || array_key_exists($id, $skip) || ($accept !== null && !$accept($e))) {
                continue;
            }
            $candidates[] = [$e, $s, $sp->why[$id] ?? null, 1.0];
        }
        $intent = Intents::resolve($g, $trail, $intent);
        $plain = self::mix($candidates, $limit);
        $chosen = $plain;
        if ($intent !== null) {
            $boosted = [];
            foreach ($candidates as [$e, $s, $w]) {
                $b = Intents::boost($g, $intent, $e, $w?->link);
                $boosted[] = [$e, $s * $b, $w, $b];
            }
            $chosen = self::mix($boosted, $limit);
        }
        $plainIds = array_map(static fn (array $c) => $c[0]->id, $plain);
        $out = [];
        foreach ($chosen as $i => [$e, $s, $w, $b]) {
            $reason = $w !== null ? Reasons::fromLink($w->link, $e->id, $w->seed) : new Reason('section');
            if ($intent !== null && $b != 1 && array_search($e->id, $plainIds, true) !== $i) {
                $reason = $reason->withIntent(new ReasonIntent($intent, $b));
            }
            $out[] = new Suggestion($e, $s, $reason, Reasons::render($g, $reason, $e, $templates));
        }
        $this->suggested('next', array_map(static fn (Suggestion $x) => $x->entity->id, $out), array_map(static fn (Suggestion $x) => $x->reason->kind, $out), $intent);
        return $out;
    }

    /**
     * Type-ahead: names that start with (or contain) what's typed, nearest the trail first.
     *
     * @param list<string> $trail
     * @param (callable(Entity): bool)|null $accept
     * @param array<string, mixed>|null $templates
     * @return list<Suggestion>
     */
    public function autocomplete(string $typed, array $trail = [], int $limit = 3, ?callable $accept = null, ?array $templates = null): array
    {
        $q = Text::normalize($typed);
        if (strlen($q) < 2) {
            return [];
        }
        $near = $this->spread($trail)->score;
        $hits = [];
        foreach ($this->graph->entities as $e) {
            if (!$this->graph->isDestination($e) || ($accept !== null && !$accept($e))) {
                continue;
            }
            $name = Text::normalize($e->label);
            if (str_starts_with($name, $q)) {
                $kind = 3;
            } elseif (array_filter(explode(' ', $name), static fn (string $w) => str_starts_with($w, $q)) !== []) {
                $kind = 2;
            } elseif (strlen($q) >= 3 && str_contains($name, $q)) {
                $kind = 1;
            } else {
                continue;
            }
            $by = $kind === 3 ? 'prefix' : ($kind === 2 ? 'word-prefix' : 'contains');
            $hits[] = [$e, $by, $kind * 10 + ($near[$e->id] ?? 0) * 5 + min($this->graph->degree($e->id), 20) / 20];
        }
        $sorted = Text::stableSorted($hits, static fn (array $a, array $b): int => self::cmp((float) $b[2], (float) $a[2]));
        $out = [];
        foreach (array_slice($sorted, 0, max(0, $limit)) as [$e, $by, $score]) {
            $reason = new Reason('typed', by: $by);
            $out[] = new Suggestion($e, (float) $score, $reason, Reasons::render($this->graph, $reason, $e, $templates));
        }
        return $out;
    }

    /**
     * A reason as a sentence, for an Entity or an entity id.
     *
     * @param array<string, mixed>|null $templates
     */
    public function explain(Reason $reason, Entity|string $item, ?array $templates = null): string
    {
        $e = $item instanceof Entity ? $item : ($this->graph->entities[$item] ?? null);
        if ($e === null) {
            throw new InvalidArgumentException("pubba: no entity $item");
        }
        return Reasons::render($this->graph, $reason, $e, $templates);
    }
}
