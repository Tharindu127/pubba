<?php

declare(strict_types=1);

namespace Pubba;

/** An entity a query could mean (`match` is a reserved word in PHP, hence the name). */
final class EntityMatch
{
    public function __construct(
        public readonly Entity $entity,
        public readonly float $score,
        public readonly int $tier,
        public readonly Reason $reason,
        public readonly string $text,
    ) {
    }
}
