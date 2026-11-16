<?php
$host = $_SERVER['HTTP_HOST'];
include "../config/$host.php";
$tenant = strtolower($_SERVER['SERVER_NAME']);
$dir = $tenant;
require __DIR__ . '/../tenants/' . $dir . '/settings.php';
$host = getenv('SITE');
include "../config/{$host}.php";
function shared() {
    include "../config/$host.php";
}
function site() {
    $site = $_SERVER['HTTP_HOST'];
    $site .= '.php';
    include '../config/' . $site;
}
$page = $_GET['page'];
include "pages/$page.php";
