<?php

declare(strict_types=1);

namespace Pubba;

/** A trail step that pointed to an intent; $via is the neighbour it pointed through, when that counted more. */
final class IntentEvidence
{
    public function __construct(public readonly string $step, public readonly ?string $via, public readonly float $weight)
    {
    }
}
