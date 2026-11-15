<?php

declare(strict_types=1);

namespace Pubba;

/** What a fallback is asked for: kind "start", "none", "not-here", "open" (with the entity) or "chips". */
final class FallbackContext
{
    public function __construct(public readonly string $kind, public readonly ?Entity $entity = null)
    {
    }
}
