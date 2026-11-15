<?php

// For projects without Composer (a WordPress plugin, a plain PHP site): require this file.
spl_autoload_register(static function (string $class): void {
    if (str_starts_with($class, 'Pubba\\')) {
        $file = __DIR__ . '/src/' . str_replace('\\', '/', substr($class, 6)) . '.php';
        if (is_file($file)) {
            require $file;
        }
    }
});
