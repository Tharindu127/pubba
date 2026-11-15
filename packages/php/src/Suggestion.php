<?php

declare(strict_types=1);

namespace Pubba;

/** Something to suggest next, with why. */
final class Suggestion
{
    public function __construct(
        public readonly Entity $entity,
        public readonly float $score,
        public readonly Reason $reason,
        public readonly string $text,
    ) {
    }
}
