<?php
$host = strtolower($_SERVER['HTTP_HOST']);
include 'config/' . $host . '.php';
$dsn = $conf['dsn'];
