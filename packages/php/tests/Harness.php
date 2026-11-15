<?php

declare(strict_types=1);

// The conformance harness for PHP: runs a case and returns its answer as JSON data (see conformance/README.md).

namespace Pubba\Tests;

use InvalidArgumentException;
use Pubba\EntityChip;
use Pubba\Entity;
use Pubba\Events;
use Pubba\FallbackContext;
use Pubba\Guide;
use Pubba\GuideChip;
use Pubba\Pubba;
use Pubba\QuestionChip;
use Pubba\Reason;
use Pubba\Related;
use Pubba\Reply;
use Pubba\Suggestion;

final class Harness
{
    /** @return array<string, mixed> */
    private static function chip(GuideChip $c): array
    {
        if ($c instanceof QuestionChip) {
            return ['label' => $c->label, 'question' => $c->question];
        }
        assert($c instanceof EntityChip);
        $out = ['id' => $c->id, 'label' => $c->label];
        if ($c->url !== null) {
            $out['url'] = $c->url;
        }
        return $out + ['reason' => $c->reason->toArray(), 'text' => $c->text];
    }

    /** @return array<string, mixed>|null */
    private static function reply(?Reply $r): ?array
    {
        if ($r === null) {
            return null;
        }
        $out = ['kind' => $r->kind, 'text' => $r->text];
        if ($r->action !== null) {
            $out['action'] = ['type' => $r->action->type, 'id' => $r->action->id];
            if ($r->action->url !== null) {
                $out['action']['url'] = $r->action->url;
            }
        }
        $out['chips'] = array_map([self::class, 'chip'], $r->chips);
        if ($r->match !== null) {
            $out['match'] = ['id' => $r->match->entity->id, 'score' => $r->match->score, 'tier' => $r->match->tier, 'by' => $r->match->reason->by, 'name' => $r->match->reason->name];
        }
        if ($r->similar !== null) {
            $out['similar'] = array_map([self::class, 'chip'], $r->similar);
        }
        return $out;
    }

    /** @return array<string, mixed> */
    private static function weighted(Related $x): array
    {
        return ['id' => $x->entity->id, 'weight' => $x->weight, 'reason' => $x->reason->toArray(), 'text' => $x->text];
    }

    /** @return array<string, mixed> */
    private static function scored(Suggestion $x): array
    {
        return ['id' => $x->entity->id, 'score' => $x->score, 'reason' => $x->reason->toArray(), 'text' => $x->text];
    }

    /** @return list<string> */
    private static function strs(mixed $v): array
    {
        return is_array($v) ? array_map('strval', $v) : [];
    }

    /**
     * @param list<array<string, mixed>> $steps
     * @param array<string, mixed>|null $o
     * @return array<string, mixed>
     */
    private static function runGuide(Pubba $base, array $steps, ?array $o): array
    {
        $clock = 0.0;
        $events = new Events(['contact']);
        $emitted = [];
        $events->on(static function (array $e) use (&$emitted): void {
            $emitted[] = $e;
        });
        $accept = null;
        $hide = $o['hide'] ?? null;
        if (is_array($hide)) {
            $accept = static function (Entity $e) use ($hide): bool {
                $label = mb_strtolower($e->label, 'UTF-8');
                foreach ($hide as $r) {
                    $types = self::strs($r['types'] ?? null);
                    $ids = self::strs($r['ids'] ?? null);
                    $inc = self::strs($r['labelIncludes'] ?? null);
                    $ends = self::strs($r['labelEndsWith'] ?? null);
                    if (($types === [] || in_array($e->type, $types, true))
                        && ($ids === [] || in_array($e->id, $ids, true))
                        && ($inc === [] || array_filter($inc, static fn ($s) => str_contains($label, $s)) !== [])
                        && ($ends === [] || array_filter($ends, static fn ($s) => str_ends_with($label, $s)) !== [])) {
                        return false;
                    }
                }
                return true;
            };
        }
        $fallback = null;
        $fb = $o['fallback'] ?? null;
        if (is_array($fb)) {
            $fallback = static function (FallbackContext $ctx) use ($fb): ?array {
                $v = $ctx->kind === 'open' && $ctx->entity !== null ? ($fb['open.' . $ctx->entity->type] ?? $fb['open'] ?? null) : ($fb[$ctx->kind] ?? null);
                return is_array($v) ? array_map(static fn ($s) => new QuestionChip($s), $v) : null;
            };
        }
        $lines = $o['lines'] ?? null;
        $avoid = isset($o['nudgeAvoids']) ? self::strs($o['nudgeAvoids']) : null;
        $guide = new Guide(
            $base->withEvents($events),
            chips: is_int($o['chips'] ?? null) ? $o['chips'] : 3,
            accept: $accept,
            fallback: $fallback,
            line: is_array($lines) ? static fn (Entity $e) => $lines[$e->id] ?? null : null,
            templates: is_array($o['templates'] ?? null) ? $o['templates'] : [],
            prefer: $avoid === null ? null : static fn (Entity $e) => !in_array($e->type, $avoid, true),
            now: static function () use (&$clock): float {
                return $clock;
            },
        );
        $answers = [];
        foreach ($steps as $s) {
            switch ($s['op']) {
                case 'visited':
                    $guide->visited($s['id']);
                    $answers[] = null;
                    break;
                case 'follow':
                    $guide->follow($s['id'], $s['via']);
                    $answers[] = null;
                    break;
                case 'ask':
                    $answers[] = self::reply($guide->ask($s['question']));
                    break;
                case 'nudge':
                    $answers[] = self::reply($guide->nudge());
                    break;
                case 'chips':
                    $answers[] = array_map([self::class, 'chip'], $guide->chips(is_int($s['limit'] ?? null) ? $s['limit'] : null));
                    break;
                case 'tick':
                    $clock += $s['ms'];
                    $answers[] = null;
                    break;
                case 'opened':
                    $guide->opened();
                    $answers[] = null;
                    break;
                case 'reached':
                    $guide->reached($s['goal']);
                    $answers[] = null;
                    break;
            }
        }
        return ['answers' => $answers, 'trail' => $guide->trail->get(), 'events' => $emitted];
    }

    /** @param array<string, mixed> $c */
    public static function run(Pubba $pubba, array $c): mixed
    {
        switch ($c['op']) {
            case 'match':
                $m = $pubba->match($c['query']);
                $out = ['intent' => $m->intent, 'entity' => $m->entity?->id];
                if ($m->match !== null) {
                    $out += ['score' => $m->match->score, 'tier' => $m->match->tier, 'by' => $m->match->reason->by, 'name' => $m->match->reason->name, 'text' => $m->match->text];
                }
                $out['similar'] = array_map([self::class, 'weighted'], $m->similar);
                if ($m->notHere !== null) {
                    $out['notHere'] = $m->notHere;
                }
                return $out;
            case 'search':
                return array_map(static fn ($m) => ['id' => $m->entity->id, 'score' => $m->score, 'tier' => $m->tier, 'by' => $m->reason->by, 'name' => $m->reason->name], $pubba->search($c['query'], $c['limit']));
            case 'next':
                return array_map([self::class, 'scored'], $pubba->next(self::strs($c['trail']), $c['limit'], self::strs($c['exclude'] ?? null)));
            case 'related':
                return array_map([self::class, 'weighted'], $pubba->related($c['id'], isset($c['kinds']) ? self::strs($c['kinds']) : null, $c['limit'] ?? null));
            case 'autocomplete':
                return array_map(static fn (Suggestion $s) => ['id' => $s->entity->id, 'score' => $s->score, 'by' => $s->reason->by], $pubba->autocomplete($c['typed'], self::strs($c['trail']), $c['limit']));
            case 'explain':
                return $pubba->explain(Reason::fromArray($c['reason']), $c['item']);
            case 'guide':
                return self::runGuide($pubba, $c['steps'], $c['options'] ?? null);
        }
        throw new InvalidArgumentException('unknown op ' . $c['op']);
    }

    /** Equal as JSON, numbers to 1e-9. The path of the first difference, or null. */
    public static function diff(mixed $a, mixed $b, string $path = '$'): ?string
    {
        if ((is_int($a) || is_float($a)) && (is_int($b) || is_float($b))) {
            return abs($a - $b) <= 1e-9 ? null : "$path: $a != $b";
        }
        if (is_array($a) || is_array($b)) {
            if (!is_array($a) || !is_array($b)) {
                return "$path: array vs not";
            }
            if (array_is_list($a) && array_is_list($b)) {
                if (count($a) !== count($b)) {
                    return "$path: length " . count($a) . ' != ' . count($b);
                }
                foreach ($a as $i => $v) {
                    $d = self::diff($v, $b[$i], "{$path}[$i]");
                    if ($d !== null) {
                        return $d;
                    }
                }
                return null;
            }
            $ka = array_map('strval', array_keys($a));
            $kb = array_map('strval', array_keys($b));
            sort($ka);
            sort($kb);
            if ($ka !== $kb) {
                return "$path: keys " . json_encode($ka) . ' != ' . json_encode($kb);
            }
            foreach ($ka as $k) {
                $d = self::diff($a[$k], $b[$k], "$path.$k");
                if ($d !== null) {
                    return $d;
                }
            }
            return null;
        }
        return $a === $b ? null : "$path: " . json_encode($a) . ' != ' . json_encode($b);
    }
}
