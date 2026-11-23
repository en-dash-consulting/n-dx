<?php
define('ROOT', dirname(__DIR__));
include ROOT . '/config/' . $_SERVER['HTTP_HOST'] . '.php';
include "lang/$lang.php";
include ROOT . '/modules/' . $name . '/index.php';
include $page;
include $dir . '/index.php';
include $name . '.php';
include "tenants/{$_SERVER['SERVER_NAME']}/settings.php";
require_once ROOT . '/modules/blog/index.php';
