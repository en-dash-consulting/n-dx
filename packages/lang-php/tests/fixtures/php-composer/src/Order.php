<?php

namespace Acme\Shop;

use Monolog\Logger;
use Psr\Log\LoggerInterface;
use Acme\Shop\Model\Item as LineItem;
use function Acme\Shop\Support\format_money;
use const Acme\Shop\Support\CURRENCY;

class Order extends Base implements Contracts\Billable
{
    use Concerns\HasTotals;

    private Logger $log;

    public function __construct(?LoggerInterface $logger = null)
    {
    }

    public function add(LineItem $item): ?Receipt
    {
        try {
            $receipt = new Receipt();
            Money::zero();
            format_money(1, CURRENCY);
        } catch (\InvalidArgumentException | PaymentFailed $e) {
            return null;
        }
        if ($item instanceof \Countable) {
            $cart = new \Legacy_Cart_Item();
        }
        \Zend_Db_Table::find(1);
        new \Helper();
        new \Dup();
        new Missing();
        strlen('x');
        \DateTime::createFromFormat('Y', '2026');
        return self::make(static::class);
    }
}
