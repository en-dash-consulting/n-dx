<?php
require 'includes/configure.php';

if (FEATURE_NEW_CHECKOUT) {
    render_new_checkout();
} elseif (!LEGACY_REPORTS) {
    render_old_checkout();
} else {
    render_nothing();
}

$link = mysql_connect(DB_SERVER, 'shop');
$banner = defined('FF_HOLIDAY_BANNER') ? 'holiday' : 'plain';
if (getenv('FEATURE_DARK_MODE')) {
    $theme = 'dark';
}
if ($_ENV['ENABLE_AUDIT']) audit();
// Not flags: an include guard and a constant passed to a call.
if (!defined('IN_SHOP')) exit;
if (in_array(FEATURE_NEW_CHECKOUT, $list)) noop();
