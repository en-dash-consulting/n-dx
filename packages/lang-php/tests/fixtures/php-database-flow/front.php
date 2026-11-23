<?php
require __DIR__ . '/lib/routes.php';

$route = get_route($_SERVER['REQUEST_URI']);
$controller = new $route['controller']();
$controller->{$route['action']}();
