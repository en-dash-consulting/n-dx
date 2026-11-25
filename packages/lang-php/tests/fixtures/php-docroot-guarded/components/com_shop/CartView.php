<?php
// Joomla-shaped: use lines before the guard, then only declarations.
namespace Acme\Shop;

use Acme\Shop\Model\Cart;

defined('_JEXEC') or die;

class CartView
{
    public function render(Cart $cart): string
    {
        return (string) $cart;
    }
}
