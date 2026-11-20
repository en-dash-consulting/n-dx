<?php
// A global polyfill of a removed built-in: every call that reaches it is the repository's.
function create_function($args, $code) {}

create_function('$a', 'return $a;');
