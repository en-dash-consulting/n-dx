<?php

require __DIR__ . '/../vendor/autoload.php';

$app = new \Acme\Kernel();
$app->handle($_SERVER['REQUEST_URI']);
