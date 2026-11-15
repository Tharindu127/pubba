<?php

declare(strict_types=1);

namespace Pubba;

/** When a nudge may come: after $delayMs on a page, $gapMs apart, for a suggestion scoring $minScore or more. */
final class NudgePolicy
{
    public function __construct(
        public readonly float $delayMs = 9000,
        public readonly float $gapMs = 60000,
        public readonly float $minScore = 0.3,
    ) {
    }
}
