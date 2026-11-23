<?php

function php_check($code) {
  if ($code === '') {
    throw new PhpEvalException('empty');
  }
}
