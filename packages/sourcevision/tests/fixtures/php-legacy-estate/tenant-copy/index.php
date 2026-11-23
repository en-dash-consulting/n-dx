<?php
// Hollowbrook ledger, tenant copy. Entry script.
require_once(dirname(__FILE__) . '/config.php');
require_once(dirname(__FILE__) . '/lib/bootstrap.inc');

$entries = hb_ledger_entries($HTTP_POST_VARS['account']);
hb_render_ledger($entries);
