<?php
// The shape of Drupal 7's modules/php/php.module: eval of a parameter.
function php_eval($code) {
  ob_start();
  print eval('?>' . $code);
  return ob_get_clean();
}
