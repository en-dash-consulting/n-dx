<?php
// Joomla-shaped guard: namespace first, then the guard, then use lines.
declare(strict_types=1);

namespace Acme\Shop;

\defined('_JEXEC') or die;

use Acme\Shop\Model\Cart;

class ShopController
{
    public function display(Cart $cart): string
    {
        return (string) $cart;
    }
}
