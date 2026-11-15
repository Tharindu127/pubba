<?php

declare(strict_types=1);

namespace Pubba;

/** A place to go, with why. */
final class EntityChip implements GuideChip
{
    public function __construct(
        public readonly string $id,
        public readonly string $label,
        public readonly Reason $reason,
        public readonly string $text,
        public readonly ?string $url = null,
    ) {
    }

    public function label(): string
    {
        return $this->label;
    }
}
