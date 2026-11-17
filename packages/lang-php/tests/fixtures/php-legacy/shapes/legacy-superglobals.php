<?php
// Long superglobal arrays
global $HTTP_GET_VARS;
$query = $HTTP_POST_VARS;
if (!empty($HTTP_COOKIE_VARS)) {
  $cookies = $HTTP_COOKIE_VARS;
}
$srv = $HTTP_SERVER_VARS['REQUEST_METHOD'];
define('ENV_VARS', $HTTP_ENV_VARS);
$sess = $HTTP_SESSION_VARS;
$upload = $HTTP_POST_FILES;

// In string interpolation
$text = "POST: {$HTTP_POST_VARS['data']}";
$heredoc = <<<EOT
Server vars: $HTTP_SERVER_VARS
EOT;

// $HTTP_RAW_POST_DATA
$raw = $HTTP_RAW_POST_DATA;
if (isset($HTTP_RAW_POST_DATA)) {
  $body = $HTTP_RAW_POST_DATA;
}
