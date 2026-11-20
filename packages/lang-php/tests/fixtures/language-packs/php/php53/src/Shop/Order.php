<?php
// PHP 5.3–5.6: unbraced namespace, use imports, closures, traits, ::class.
namespace Acme\Shop;

use Acme\Billing\Invoice;
use Acme\Billing\Gateway as PaymentGateway, Acme\Support\Clock;
use function Acme\Support\money_format;
use const Acme\Support\CURRENCY;
use Acme\Shipping\{Carrier, Parcel as Box, function weigh, const MAX_WEIGHT};
use \Psr\Log\LoggerInterface;

require_once __DIR__ . '/../bootstrap.php';

const STATUS_OPEN = 'open', STATUS_PAID = 'paid';

interface Payable
{
    const CURRENCY = 'EUR';

    public function pay(PaymentGateway $gateway);
}

trait Timestamps
{
    protected $createdAt;

    public function touch()
    {
        $this->createdAt = Clock::now();
    }
}

abstract class Model
{
    abstract public function id();
}

class Order extends Model implements Payable
{
    use Timestamps;

    const TABLE = 'orders';

    private $lines = array();

    public function __construct(LoggerInterface $logger)
    {
        $this->logger = $logger;
        $this->touch();
    }

    public function Order()
    {
        return 'not a constructor: the class is namespaced';
    }

    public function id()
    {
        return static::TABLE . ':' . spl_object_hash($this);
    }

    public function pay(PaymentGateway $gateway)
    {
        $invoice = new Invoice($this, CURRENCY);
        $total = array_reduce($this->lines, function ($sum, $line) use ($invoice) {
            return $sum + $invoice->price($line);
        }, 0);
        $this->logger->info('paid', array('class' => Invoice::class));
        return $gateway->charge(money_format($total), new Box(weigh($this->lines)));
    }

    public static function load($id)
    {
        $loader = function ($file) {
            require $file;
        };
        $loader(__DIR__ . "/orders/{$id}.php");
        return new static();
    }
}

function order_total(Order $order)
{
    return call_user_func(array($order, 'id'));
}
