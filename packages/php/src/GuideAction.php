<?php

declare(strict_types=1);

namespace Pubba;

/** Navigate to an entity: $url is the route the guide's `route` gave it, if any. */
final class GuideAction
{
    public readonly string $type;

    public function __construct(public readonly string $id, public readonly ?string $url = null)
    {
        $this->type = 'open';
    }
}
