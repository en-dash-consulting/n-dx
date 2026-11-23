<?php
function __autoload($class)
{
    require_once dirname(__FILE__) . '/classes/' . $class . '.class.php';
}

spl_autoload_register(function ($name) {
    $file = 'app/' . str_replace('_', DIRECTORY_SEPARATOR, $name);
    $file .= '.php';
    if (file_exists(__DIR__ . '/' . $file)) {
        require __DIR__ . '/' . $file;
    }
});

spl_autoload_register(array('Loader', 'load'));
spl_autoload_register($loader);
spl_autoload_register('missing_loader');
spl_autoload_register();

class Loader
{
    private static $dir;

    public static function load($class)
    {
        require self::$dir . $class . '.php';
    }
}

$legacy = new Legacy_Autoloader();
$legacy->register();
