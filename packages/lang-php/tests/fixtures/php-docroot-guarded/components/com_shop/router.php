<?php
// A function declared before the guard, then only declarations.
function shop_route(array $query): string
{
    return implode('/', $query);
}

defined('_JEXEC') or die;

class ShopRouter {}
