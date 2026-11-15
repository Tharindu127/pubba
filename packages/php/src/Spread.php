<?php

declare(strict_types=1);

namespace Pubba;

/** How brightly each entity lights up for a trail, in the order entities lit up. */
final class Spread
{
    /**
     * @param array<string, float> $score
     * @param array<string, Why> $why
     * @param array<string, float> $seeds
     * @param array<string, true> $sectionOnly
     */
    public function __construct(
        public readonly array $score,
        public readonly array $why,
        public readonly array $seeds,
        public readonly array $sectionOnly,
    ) {
    }
}
