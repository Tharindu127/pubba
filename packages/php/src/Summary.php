<?php

declare(strict_types=1);

namespace Pubba;

/** One visit's funnel. */
final class Summary
{
    /**
     * @param list<string> $guidedTo
     * @param list<string> $guidedToTypes
     * @param list<string> $reached
     */
    public function __construct(
        public readonly bool $usedGuide,
        public readonly array $guidedTo,
        public readonly array $guidedToTypes,
        public readonly array $reached,
        public readonly bool $guidedBeforeGoal,
    ) {
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'usedGuide' => $this->usedGuide,
            'guidedTo' => $this->guidedTo,
            'guidedToTypes' => $this->guidedToTypes,
            'reached' => $this->reached,
            'guidedBeforeGoal' => $this->guidedBeforeGoal,
        ];
    }
}
