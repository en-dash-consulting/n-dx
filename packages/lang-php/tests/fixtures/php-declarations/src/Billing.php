<?php
namespace Acme\Billing;

interface Payable
{
    public function total(): int;
}

trait Discounts
{
    public function discount(): int { return 0; }
}

class Invoice implements Payable
{
    use Discounts;

    public function total(): int { return 1; }
}

final class CreditNote extends Invoice
{
}
