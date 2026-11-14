<?php

// Acme\Billing is declared here, and no autoload prefix covers it. acme/shared
// (Acme\Shared) is a Composer package with no lock and no vendor directory.
namespace Acme\Billing;

use Acme\Shared\Money;
use Acme\Tools\Clock;

class Invoice
{
    public function total(): Money
    {
        new Missing();
        new \Acme\Tools\Gone();
        new \Zend_Db();
        new \Zend_Gdata_YouTube();
        return new Money(Clock::now());
    }
}
