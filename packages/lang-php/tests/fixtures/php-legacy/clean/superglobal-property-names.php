<?php
// Properties and array keys with superglobal names should not be counted

// Not a use: property with the name
$obj->HTTP_GET_VARS = 'value';
$array['HTTP_POST_VARS'] = 'value';
$array["HTTP_COOKIE_VARS"] = 'value';

// Not a use: array key access with string key
$config['HTTP_SERVER_VARS'] = true;
$data["HTTP_ENV_VARS"] = "setting";

class MyClass {
  public $HTTP_SESSION_VARS;
  public $HTTP_POST_FILES;
}
