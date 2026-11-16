<?php
function make($class, $m)
{
    $class::$m();
    $class::{$m . 'Static'}();
    Factory::create();
}
