<?php

declare(strict_types=1);

namespace Pubba;

/** Why a visit is likely happening: $likely is null while browsing, with too few steps, or with no intents. */
final class IntentReading
{
    /**
     * @param array<string, float> $scores each intent's share, then `browsing`'s
     * @param list<IntentEvidence> $evidence the steps behind the top intent
     */
    public function __construct(
        public readonly ?string $likely,
        public readonly float $confidence,
        public readonly array $scores,
        public readonly array $evidence,
    ) {
    }
}
