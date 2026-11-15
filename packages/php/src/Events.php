<?php

declare(strict_types=1);

namespace Pubba;

use Closure;
use Throwable;

/**
 * Privacy-safe measurement events (SPEC section 8). pubba only emits: no
 * storage, no network, no visitor ids, no timestamps. Event fields hold entity
 * ids, types, kinds and declared goals; never a query.
 */
final class Events
{
    /** How a visitor can be guided somewhere, for `guided-to` events. */
    public const GUIDE_VIAS = ['suggestion', 'chip', 'typed', 'match', 'related'];

    /** @var list<Closure> */
    private array $listeners = [];

    /** @param list<string> $goals */
    public function __construct(public readonly array $goals = ['contact', 'resume'])
    {
    }

    /**
     * Listen to every event (an array with the spec's field names); returns an unsubscribe function.
     * A listener that throws is ignored.
     *
     * @param callable(array<string, mixed>): mixed $listener
     */
    public function on(callable $listener): Closure
    {
        $l = Closure::fromCallable($listener);
        $this->listeners[] = $l;
        return function () use ($l): void {
            $i = array_search($l, $this->listeners, true);
            if ($i !== false) {
                array_splice($this->listeners, $i, 1);
            }
        };
    }

    /** @param array<string, mixed> $event */
    public function emit(array $event): void
    {
        foreach ($this->listeners as $l) {
            try {
                $l($event);
            } catch (Throwable) {
                // Measurement must never break the guide.
            }
        }
    }

    /**
     * Was the guide used, where did it lead, which goals were reached.
     *
     * @param iterable<array<string, mixed>> $events
     */
    public static function summarise(iterable $events): Summary
    {
        $guidedTo = [];
        $types = [];
        $reached = [];
        $used = false;
        $beforeGoal = false;
        foreach ($events as $e) {
            switch ($e['type'] ?? null) {
                case 'guide-opened':
                case 'matched':
                    $used = true;
                    break;
                case 'guided-to':
                    $used = true;
                    $to = $e['to'] ?? null;
                    $t = $e['entityType'] ?? null;
                    if (is_string($to) && !in_array($to, $guidedTo, true)) {
                        $guidedTo[] = $to;
                    }
                    if (is_string($t) && !in_array($t, $types, true)) {
                        $types[] = $t;
                    }
                    break;
                case 'reached':
                    $g = $e['goal'] ?? null;
                    if (is_string($g) && !in_array($g, $reached, true)) {
                        $reached[] = $g;
                    }
                    if ($guidedTo !== []) {
                        $beforeGoal = true;
                    }
                    break;
            }
        }
        return new Summary($used, $guidedTo, $types, $reached, $beforeGoal);
    }
}
