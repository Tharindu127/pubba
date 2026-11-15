<?php

declare(strict_types=1);

namespace Pubba;

use Closure;

/** The headless guide (SPEC section 9): a typed question becomes a reply; steps are recorded; nudges come at the right moments. */
final class Guide
{
    public const DEFAULT_TEMPLATES = [
        'open' => "Here's {item}.",
        'similar' => '{reason}',
        'none' => "I couldn't find that here. These might help:",
        'notHere' => "{name} isn't here. These might help:",
        'start' => 'Where would you like to start?',
        'nudge' => '{reason} Want a look?',
    ];

    public readonly Trail $trail;
    public readonly NudgePolicy $nudgePolicy;
    private Closure $route;
    private Closure $prefer;
    private ?Closure $accept;
    private ?Closure $fallback;
    private ?Closure $line;
    private Closure $now;
    /** @var array<string, string> */
    private array $t;
    private float $lastStepAt = -INF;
    private bool $lastStepSelf = false;
    private float $lastNudgeAt = -INF;
    /** @var array<string, true> */
    private array $nudgedFrom = [];

    /**
     * @param (callable(Entity): ?string)|null $route where an entity lives in this site (a route, a url); default its url
     * @param (callable(Entity): bool)|null $prefer which suggestions a nudge prefers (default: those with a route)
     * @param (callable(Entity): bool)|null $accept which entities the guide may offer at all
     * @param (callable(FallbackContext): ?list<GuideChip>)|null $fallback chips when nothing is suggested
     * @param (callable(Entity): ?string)|null $line a short line for the `{line}` token
     * @param array<string, string> $templates words, including `open.<type>` and `nudge.<type>`
     * @param (callable(): float)|null $now the clock in milliseconds
     */
    public function __construct(
        public readonly Pubba $pubba,
        ?Trail $trail = null,
        ?callable $route = null,
        private readonly int $chips = 3,
        ?NudgePolicy $nudge = null,
        ?callable $prefer = null,
        ?callable $accept = null,
        ?callable $fallback = null,
        ?callable $line = null,
        array $templates = [],
        ?callable $now = null,
    ) {
        $this->trail = $trail ?? new Trail();
        $this->nudgePolicy = $nudge ?? new NudgePolicy();
        $this->route = $route !== null ? Closure::fromCallable($route) : static fn (Entity $e): ?string => $e->url;
        $r = $this->route;
        $this->prefer = $prefer !== null ? Closure::fromCallable($prefer) : static fn (Entity $e): bool => $r($e) !== null;
        $this->accept = $accept !== null ? Closure::fromCallable($accept) : null;
        $this->fallback = $fallback !== null ? Closure::fromCallable($fallback) : null;
        $this->line = $line !== null ? Closure::fromCallable($line) : null;
        $this->t = array_replace(self::DEFAULT_TEMPLATES, $templates);
        $this->now = $now !== null ? Closure::fromCallable($now) : static fn (): float => microtime(true) * 1000;
    }

    // --- helpers

    /** @param array<string, string> $values */
    private static function fill(string $text, array $values): string
    {
        return Text::collapse(preg_replace_callback('/\{(\w+)\}/', static fn (array $m): string => $values[$m[1]] ?? '', $text) ?? $text);
    }

    private function tpl(string $key, ?Entity $e = null): string
    {
        return ($e !== null ? ($this->t[$key . '.' . $e->type] ?? null) : null) ?? $this->t[$key];
    }

    /** @return array<string, string> */
    private function vars(Entity $e): array
    {
        return ['item' => $e->shortLabel(), 'label' => $e->label, 'line' => $this->line !== null ? (($this->line)($e) ?? '') : ''];
    }

    private function accepts(Entity $e): bool
    {
        return $this->accept === null || ($this->accept)($e);
    }

    private function chip(Entity $e, Reason $reason, string $text): EntityChip
    {
        return new EntityChip($e->id, $e->shortLabel(), $reason, $text, ($this->route)($e));
    }

    private function open(Entity $e): GuideAction
    {
        return new GuideAction($e->id, ($this->route)($e));
    }

    /** @return list<GuideChip> */
    private function starters(int $n): array
    {
        $g = $this->pubba->graph;
        $reason = new Reason('section');
        $es = array_filter(array_values($g->entities), fn (Entity $e) => $g->isDestination($e) && $this->accepts($e));
        $sorted = Text::stableSorted($es, static fn (Entity $a, Entity $b): int => $g->degree($b->id) - $g->degree($a->id));
        return array_map(fn (Entity $e) => $this->chip($e, $reason, $this->pubba->explain($reason, $e)), array_slice($sorted, 0, max(0, $n)));
    }

    /**
     * @param list<string> $extra
     * @return list<GuideChip>
     */
    private function chipsFor(int $n, array $extra, FallbackContext $context): array
    {
        $out = [];
        foreach ($this->pubba->next([...$this->trail->get(), ...$extra], $n, [], $this->accept) as $s) {
            $out[] = $this->chip($s->entity, $s->reason, $s->text);
        }
        if ($out !== []) {
            return $out;
        }
        $fb = $this->fallback !== null ? ($this->fallback)($context) : null;
        if ($fb !== null) {
            return array_slice(array_values($fb), 0, max(0, $n));
        }
        return $this->starters($n);
    }

    // --- the guide

    /** Answer a typed question. Doesn't move the visitor: perform the action, then call follow(). */
    public function ask(string $question): Reply
    {
        if (Text::jsTrim($question) === '') {
            return new Reply('start', self::fill($this->tpl('start'), []), $this->chipsFor($this->chips, [], new FallbackContext('start')));
        }
        $m = $this->pubba->match($question);
        if ($m->intent === 'none') {
            if ($m->notHere !== null) {
                return new Reply('not-here', self::fill($this->tpl('notHere'), ['name' => $m->notHere]), $this->chipsFor($this->chips, [], new FallbackContext('not-here')));
            }
            return new Reply('none', self::fill($this->tpl('none'), []), $this->chipsFor($this->chips, [], new FallbackContext('none')));
        }
        $entity = $m->entity;
        $similar = array_values(array_filter($m->similar, fn (Related $r) => $this->accepts($r->entity)));
        if ($m->intent === 'similar' && $similar !== []) {
            $first = $similar[0];
            $listed = implode(', ', array_map(
                static fn (Related $r) => $r->entity->label . ($r->reason->via ? ' (' . implode(', ', array_slice($r->reason->via, 0, 2)) . ')' : ''),
                $similar,
            ));
            return new Reply(
                'similar',
                self::fill($this->tpl('similar', $entity), [...$this->vars($first->entity), 'reason' => $first->text, 'of' => $entity->label, 'list' => $listed]),
                array_map(fn (Related $r) => $this->chip($r->entity, $r->reason, $r->text), array_slice($similar, 1, max(0, $this->chips))),
                $this->open($first->entity),
                $m->match,
                array_map(fn (Related $r) => $this->chip($r->entity, $r->reason, $r->text), $similar),
            );
        }
        $context = new FallbackContext('open', $entity);
        $chips = isset($this->pubba->graph->entities[$entity->id])
            ? array_values(array_filter($this->chipsFor($this->chips, [$entity->id], $context), static fn (GuideChip $c) => !($c instanceof EntityChip) || $c->id !== $entity->id))
            : $this->chipsFor($this->chips, [], $context);
        return new Reply('open', self::fill($this->tpl('open', $entity), $this->vars($entity)), $chips, $this->open($entity), $m->match);
    }

    /**
     * Follow-ups for where the visitor is now.
     *
     * @return list<GuideChip>
     */
    public function chips(?int $limit = null): array
    {
        return $this->chipsFor($limit ?? $this->chips, [], new FallbackContext('chips'));
    }

    /** The visitor went somewhere on their own. */
    public function visited(string $id): void
    {
        if ($this->pubba->graph->find($id) === null && !str_starts_with($id, 'section:')) {
            return;
        }
        $this->trail->record($id);
        $this->lastStepAt = ($this->now)();
        $this->lastStepSelf = true;
    }

    /** The visitor went somewhere because the guide sent them ($via: one of Events::GUIDE_VIAS). */
    public function follow(string $id, string $via): void
    {
        if ($this->pubba->graph->find($id) === null) {
            return;
        }
        $this->trail->record($id);
        $this->lastStepAt = ($this->now)();
        $this->lastStepSelf = false;
        $this->pubba->track->guidedTo($id, $via);
    }

    /** A suggestion to show unprompted now, or null. Call it NudgePolicy::$delayMs after a step. */
    public function nudge(): ?Reply
    {
        $steps = $this->trail->get();
        $last = $steps === [] ? null : $steps[count($steps) - 1];
        $at = (float) ($this->now)();
        if ($last === null || $last === '' || !$this->lastStepSelf || str_starts_with($last, 'section:') || isset($this->nudgedFrom[$last])) {
            return null;
        }
        if ($at - $this->lastStepAt < $this->nudgePolicy->delayMs || $at - $this->lastNudgeAt < $this->nudgePolicy->gapMs) {
            return null;
        }
        $options = array_values(array_filter(
            $this->pubba->next($steps, 5, [], $this->accept),
            fn (Suggestion $s) => $s->reason->kind !== 'section' && $s->score >= $this->nudgePolicy->minScore,
        ));
        if ($options === []) {
            return null;
        }
        $top = $options[0];
        foreach ($options as $s) {
            if (($this->prefer)($s->entity)) {
                $top = $s;
                break;
            }
        }
        $this->lastNudgeAt = $at;
        $this->nudgedFrom[$last] = true;
        return new Reply(
            'open',
            self::fill($this->tpl('nudge', $top->entity), [...$this->vars($top->entity), 'reason' => $top->text]),
            [$this->chip($top->entity, $top->reason, $top->text)],
            $this->open($top->entity),
        );
    }

    public function opened(): void
    {
        $this->pubba->track->guideOpened();
    }

    public function reached(string $goal): void
    {
        $this->pubba->track->reached($goal);
    }
}
