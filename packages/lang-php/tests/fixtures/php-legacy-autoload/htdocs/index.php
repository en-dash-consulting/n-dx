<?php
set_include_path(dirname(__FILE__) . '/../lib' . PATH_SEPARATOR . get_include_path());
require_once dirname(__FILE__) . '/../bootstrap.php';

$mime = new Pear_Mail_Mime();
$user = new User();
$order = Shop_Order::load(1);
$widget = new Widget();
$report = new Report();
$unique = new Unique();
