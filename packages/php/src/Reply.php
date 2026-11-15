<?php

declare(strict_types=1);

namespace Pubba;

/** A reply: $kind is "open", "similar", "none", "not-here" or "start". Show $text and $chips; perform $action. */
final class Reply
{
    /**
     * @param list<GuideChip> $chips
     * @param list<EntityChip>|null $similar
     */
    public function __construct(
        public readonly string $kind,
        public readonly string $text,
        public readonly array $chips = [],
        public readonly ?GuideAction $action = null,
        public readonly ?EntityMatch $match = null,
        public readonly ?array $similar = null,
    ) {
    }
}
