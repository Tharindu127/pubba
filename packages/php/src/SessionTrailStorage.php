<?php

declare(strict_types=1);

namespace Pubba;

/** Keeps the trail in the PHP session ($_SESSION), so it lasts the visit and stays on the server. */
final class SessionTrailStorage implements TrailStorage
{
    public function getItem(string $key): ?string
    {
        $v = $_SESSION[$key] ?? null;
        return is_string($v) ? $v : null;
    }

    public function setItem(string $key, string $value): void
    {
        $_SESSION[$key] = $value;
    }
}
