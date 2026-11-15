<?php

declare(strict_types=1);

namespace Pubba;

/** Where a trail is kept between requests: a session, a cookie, a cache. */
interface TrailStorage
{
    public function getItem(string $key): ?string;

    public function setItem(string $key, string $value): void;
}
