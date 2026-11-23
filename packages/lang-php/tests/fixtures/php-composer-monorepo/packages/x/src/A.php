<?php
// acme/x runs in the root's loader: the root's path repositories install acme/y, and the root's lock its libraries.
namespace X;

new \Y\B();
new \Root\Kernel();
new \Lib\Thing();
