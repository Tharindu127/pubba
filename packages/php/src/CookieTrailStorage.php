<?php

declare(strict_types=1);

namespace Pubba;

/**
 * Keeps the trail in a first-party cookie, so it stays on the visitor's device
 * and needs no session. Record steps before any output (in WordPress, on
 * `template_redirect`), since a cookie travels in the response headers.
 */
final class CookieTrailStorage implements TrailStorage
{
    public function __construct(
        private readonly int $days = 30,
        private readonly string $path = '/',
        private readonly bool $secure = true,
    ) {
    }

    public function getItem(string $key): ?string
    {
        $v = $_COOKIE[self::name($key)] ?? null;
        return is_string($v) ? $v : null;
    }

    public function setItem(string $key, string $value): void
    {
        $name = self::name($key);
        $_COOKIE[$name] = $value;
        if (!headers_sent()) {
            setcookie($name, $value, [
                'expires' => time() + $this->days * 86400,
                'path' => $this->path,
                'secure' => $this->secure,
                'httponly' => true,
                'samesite' => 'Lax',
            ]);
        }
    }

    private static function name(string $key): string
    {
        return str_replace(['-', '.', ' '], '_', $key);
    }
}
