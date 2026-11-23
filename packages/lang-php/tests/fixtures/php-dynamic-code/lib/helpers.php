<?php
// A polyfill: a repository function named as a built-in is not PHP's, so
// calling it with a variable callback is no site.
function array_walk_recursive(&$items, $callback)
{
    return true;
}

array_walk_recursive($items, $callback);
