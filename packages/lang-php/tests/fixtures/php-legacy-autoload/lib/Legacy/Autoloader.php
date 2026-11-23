<?php
class Legacy_Autoloader
{
    public function register()
    {
        spl_autoload_register(array($this, 'autoload'));
    }

    public function autoload($className)
    {
        $className = ltrim($className, '\\');
        $path = dirname(__FILE__) . '/../../plugins/' . strtolower($className) . '.php';
        include_once $path;
    }
}
