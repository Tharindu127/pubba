<?php

declare(strict_types=1);

namespace Pubba;

/** The visitor's likely intent moved this suggestion: which intent, and its boost. */
final class ReasonIntent
{
    public function __construct(public readonly string $id, public readonly float $boost)
    {
    }
}
