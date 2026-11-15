<?php

declare(strict_types=1);

namespace Pubba;

/** The moments a site reports to its measurement, checked so no visitor text gets in. */
final class Track
{
    public function __construct(private readonly Graph $graph, private readonly ?Events $events)
    {
    }

    public function guideOpened(): void
    {
        $this->events?->emit(['type' => 'guide-opened']);
    }

    public function guidedTo(string $id, string $via): bool
    {
        $e = $this->graph->find($id);
        if ($this->events === null || $e === null || !in_array($via, Events::GUIDE_VIAS, true)) {
            return false;
        }
        $this->events->emit(['type' => 'guided-to', 'to' => $e->id, 'entityType' => $e->type, 'via' => $via]);
        return true;
    }

    public function reached(string $goal): bool
    {
        if ($this->events === null || !in_array($goal, $this->events->goals, true)) {
            return false;
        }
        $this->events->emit(['type' => 'reached', 'goal' => $goal]);
        return true;
    }
}
