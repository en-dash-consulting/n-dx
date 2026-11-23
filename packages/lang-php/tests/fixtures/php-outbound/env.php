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

// getenv returns the request's meta-variables under CGI and Apache, and mod_ssl's SSL_* ones.
$n = getenv('HTTPS');
$o = getenv('REQUEST_URI');
$p = getenv('PATH_INFO');
$q = getenv('HTTP_USER_AGENT');
$r = getenv('SSL_SESSION_ID');
$s = $_SERVER['SSL_SESSION_ID'];
// OpenSSL's own variables are the environment.
$t = getenv('SSL_CERT_FILE');
