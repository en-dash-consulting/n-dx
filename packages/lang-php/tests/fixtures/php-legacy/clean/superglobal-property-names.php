<?php
// Properties, static properties, parameters and array keys named as the long
// superglobal arrays are not uses of them.
$obj->HTTP_GET_VARS = 'value';
$obj?->HTTP_RAW_POST_DATA;
$array['HTTP_POST_VARS'] = 'value';
$data["HTTP_ENV_VARS"] = "setting";
$x = Settings::$HTTP_COOKIE_VARS;

class MyClass {
  public $HTTP_SESSION_VARS;
  var $HTTP_POST_FILES;
  public static $HTTP_SERVER_VARS = array();

  public function __construct(private array $HTTP_RAW_POST_DATA = []) {}
}

function handle($HTTP_POST_VARS, ...$HTTP_GET_VARS) {}
