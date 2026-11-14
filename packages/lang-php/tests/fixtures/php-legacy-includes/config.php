<?php
/* PHP 5.2 style site configuration: constants and the include path. */
define('ROOT', dirname(__FILE__));
define('LIB', ROOT . DIRECTORY_SEPARATOR . 'lib');
const APP = __DIR__;
define('THEME', ROOT . '/themes/a');
set_include_path(ROOT . '/lib' . PATH_SEPARATOR . get_include_path());
ini_set('include_path', get_include_path() . PATH_SEPARATOR . ROOT . '/pear');

class Settings
{
    const ROOT = '/elsewhere';
}
