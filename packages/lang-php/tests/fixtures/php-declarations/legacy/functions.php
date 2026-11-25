<?php
function format_price($cents)
{
    return number_format($cents / 100, 2);
}
