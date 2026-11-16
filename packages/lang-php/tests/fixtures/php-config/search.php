<?php
$cfg = require __DIR__ . '/settings.php';
$name = $cfg['app']['name'];
$search = $cfg['features']['new_search'] ? new_search() : old_search();

$ini = parse_ini_file(__DIR__ . '/conf/app.ini');
$timeout = $ini['timeout'];
$yaml = yaml_parse_file('conf/app.yml');
$xml = simplexml_load_file($xmlPath);
