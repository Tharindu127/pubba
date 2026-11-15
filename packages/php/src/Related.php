<?php

declare(strict_types=1);

namespace Pubba;

/** A related entity, through one link, with why. */
final class Related
{
    public function __construct(
        public readonly Entity $entity,
        public readonly float $weight,
        public readonly Link $link,
        public readonly Reason $reason,
        public readonly string $text,
    ) {
    }
}
