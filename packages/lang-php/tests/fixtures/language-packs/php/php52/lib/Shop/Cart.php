<?php
require_once dirname(__FILE__) . '/../Shop.php';

class Shop_Cart extends Shop_Base
{
    var $items;

    function Shop_Cart()
    {
        parent::Shop_Base();
        $this->items = array();
    }

    function addItem($sku, $quantity)
    {
        $this->items[$sku] = $quantity;
        $this->log("added $sku");
        Shop_Logger::write('cart', $sku);
    }

    function total()
    {
        require_once 'Shop/Pricing.php';
        return Shop_Pricing::sum($this->items);
    }

    function format($amount)
    {
        return sprintf('%.2f', $amount);
    }
}

class Shop_Order
{
    function __construct($cart)
    {
        $this->cart = $cart;
    }

    function Shop_Order()
    {
        $this->__construct(null);
    }
}

function format_price($price, $currency)
{
    if (!function_exists('money_format')) {
        include_once dirname(__FILE__) . '/money.inc';
    }
    return number_format($price, 2) . ' ' . $currency;
}
