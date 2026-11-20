<?php
declare(strict_types=1);

namespace Hollowbrook\Ledger;

use Fernwick\Tally\Counter;

final class Invoice
{
    public function __construct(
        public readonly string $number,
        public readonly int $cents,
        public readonly InvoiceStatus $status,
    ) {
    }

    public function label(): string
    {
        return (new Counter())->format($this->number, $this->cents);
    }
}
