<?php

declare(strict_types=1);

namespace Pubba;

/** What a query means: $intent is "entity", "similar" or "none". */
final class MatchResult
{
    /** @param list<Related> $similar */
    public function __construct(
        public readonly string $query,
        public readonly string $intent,
        public readonly ?Entity $entity = null,
        public readonly ?EntityMatch $match = null,
        public readonly array $similar = [],
        public readonly ?string $notHere = null,
    ) {
    }
}
