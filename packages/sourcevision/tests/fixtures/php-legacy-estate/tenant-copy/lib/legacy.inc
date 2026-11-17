<?php
// Old helpers the tenant copy still carries.
class Hb_Money
{
    var $cents;
    var $currency;

    function Hb_Money($cents, $currency)
    {
        $this->cents = $cents;
        $this->currency = $currency;
    }
}

function hb_is_account_id($id) {
    return ereg('^[0-9]+$', $id);
}

function hb_sum_pairs($pairs) {
    $sum = 0;
    reset($pairs);
    while (list($key, $value) = each($pairs)) {
        $sum += $value;
    }
    return $sum;
}

function hb_sorter() {
    return create_function('$a, $b', 'return $a - $b;');
}
