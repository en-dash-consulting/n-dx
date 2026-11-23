<?php
// A plugin with its own manifest inside the root project runs in the root's loader.
namespace P;

new \Root\Kernel();
new \Legacy();
