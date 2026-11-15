<?php

declare(strict_types=1);

namespace Pubba;

/** A typed, weighted link between two entities. */
final class Link
{
    /** @param list<string>|null $via */
    public function __construct(
        public readonly string $from,
        public readonly string $kind,
        public readonly string $to,
        public readonly float $weight,
        public readonly ?array $via = null,
        public readonly ?string $rule = null,
    ) {
    }

    public function otherEnd(string $id): string
    {
        return $this->from === $id ? $this->to : $this->from;
    }
}
