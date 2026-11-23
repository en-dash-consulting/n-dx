<?php
function dispatch($handlers, $key)
{
    $f = $handlers[$key];
    $f();
    $handlers[$key]('x');
    'strlen'('x');
}
