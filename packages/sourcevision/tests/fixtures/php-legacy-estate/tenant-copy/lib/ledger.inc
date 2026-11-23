<?php
// Shared ledger rendering.
function hb_render_ledger($entries) {
    $total = 0;
    foreach ($entries as $entry) {
        $total += $entry['amount'];
    }
    include(dirname(__FILE__) . '/../templates/ledger.phtml');
}
