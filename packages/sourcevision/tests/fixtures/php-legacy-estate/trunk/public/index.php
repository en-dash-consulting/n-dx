<?php
declare(strict_types=1);

require __DIR__ . '/../vendor/autoload.php';

use Hollowbrook\Ledger\Invoice;
use Hollowbrook\Ledger\InvoiceStatus;

$invoice = new Invoice('INV-1', 1250, InvoiceStatus::Open);
echo $invoice->label();
