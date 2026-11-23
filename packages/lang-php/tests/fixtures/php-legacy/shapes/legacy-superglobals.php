<?php
global $HTTP_GET_VARS, $HTTP_POST_VARS;
foreach ($HTTP_POST_VARS as $k => $v) {}
if ($HTTP_COOKIE_VARS) {}
$srv = !$HTTP_SERVER_VARS ? array() : $HTTP_SERVER_VARS['REQUEST_METHOD'];
$env = &$HTTP_ENV_VARS;
$all = array('session' => $HTTP_SESSION_VARS);
$HTTP_POST_FILES['upload'] = null;
$text = "POST: {$HTTP_POST_VARS['data']} $HTTP_GET_VARS";
$heredoc = <<<EOT
Raw: $HTTP_RAW_POST_DATA
EOT;
echo $HTTP_RAW_POST_DATA;
