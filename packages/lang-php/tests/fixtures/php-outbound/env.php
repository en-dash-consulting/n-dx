<?php
$host = getenv('DB_HOST');
$mode = $_ENV['APP_ENV'];
$secret = $_SERVER['APP_SECRET'];
$cache = "{$_SERVER['CACHE_DIR']}/pages";
$name = getenv($variable);

// Request keys are not the environment.
$a = $_SERVER['HTTP_HOST'];
$b = $_SERVER['REQUEST_URI'];
$c = $_SERVER['QUERY_STRING'];
$d = $_SERVER['REMOTE_ADDR'];
$e = $_SERVER['SERVER_NAME'];
$f = $_SERVER['SERVER_PORT'];
$g = $_SERVER['SERVER_ADDR'];
$h = $_SERVER['SCRIPT_FILENAME'];
$i = $_SERVER['PHP_SELF'];
$j = $_SERVER['DOCUMENT_ROOT'];
$k = isset($_SERVER['HTTPS']);
$l = $_SERVER['argv'];
$m = $_SERVER[$key];

// Writes are not reads.
$_ENV['WRITTEN'] = 'x';
$_SERVER['ALSO_WRITTEN'] .= 'y';
unset($_ENV['REMOVED']);
