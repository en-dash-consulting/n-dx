<?php
namespace Acme\Shop\Legacy {
    use Acme\Shop\Order;

    class Cart
    {
        function Cart()
        {
            $this->order = new Order(null);
        }
    }

    function helper()
    {
        return \strlen('x');
    }
}

namespace {
    class GlobalCart
    {
        function GlobalCart()
        {
        }
    }

    define('GLOBAL_CART', true);
}
