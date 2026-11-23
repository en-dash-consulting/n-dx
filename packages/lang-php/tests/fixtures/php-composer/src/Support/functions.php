<?php

namespace Acme\Shop\Support;

const CURRENCY = 'EUR';

function format_money(int $cents, string $currency): string
{
    return sprintf('%d %s', $cents, $currency);
}
