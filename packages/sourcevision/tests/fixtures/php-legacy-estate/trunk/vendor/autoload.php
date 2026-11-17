<?php
// Invented stand-in for Composer's generated autoloader.
spl_autoload_register(function (string $class): void {
    $prefix = 'Fernwick\\Tally\\';
    if (strncmp($class, $prefix, strlen($prefix)) === 0) {
        require __DIR__ . '/fernwick/tally/src/' . str_replace('\\', '/', substr($class, strlen($prefix))) . '.php';
    }
});
