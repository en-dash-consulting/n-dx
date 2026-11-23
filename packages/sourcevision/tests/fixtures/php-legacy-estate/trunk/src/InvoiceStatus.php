<?php
declare(strict_types=1);

namespace Hollowbrook\Ledger;

enum InvoiceStatus: string
{
    case Open = 'open';
    case Paid = 'paid';
}
