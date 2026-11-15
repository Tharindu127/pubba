<?php

declare(strict_types=1);

namespace Pubba;

/** Why an entity lights up for a trail: the strongest single contribution. */
final class Why
{
    public function __construct(
        public readonly Link $link,
        public readonly string $from,
        public readonly string $seed,
        public readonly float $part,
    ) {
    }
}
