<?php

namespace Acme\Shop\Tests;

use Acme\Shop\Order;

class OrderTest extends \PHPUnit\Framework\TestCase
{
    public function testAdd(): void
    {
        new Order();
        new Fixtures\Thing();
    }
}
