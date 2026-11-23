<?php
define('DB_SERVER', 'db.internal');
define('USE_PCONNECT', 'false');

function tep_db_connect($server = DB_SERVER, $username = 'u', $password = 'p', $database = 'shop', $link = 'db_link') {
  global $$link;
  if (USE_PCONNECT == 'true') {
    $server = 'p:' . $server;
  }
  $$link = mysqli_connect($server, $username, $password, $database);
  return $$link;
}

$persistent = mysqli_connect('p:db.internal');
$ported = mysqli_connect('p:db.internal', 'u', 'p', 'shop', 3307);
$oo = new mysqli('p:db.internal');
$fromEnv = mysqli_connect('p:' . getenv('DB_HOST'));
