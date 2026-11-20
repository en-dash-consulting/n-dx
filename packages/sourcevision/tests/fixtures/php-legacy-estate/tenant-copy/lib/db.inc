<?php
// Shared database layer.
require_once(dirname(__FILE__) . '/ledger.inc');

$hb_link = mysql_connect(DB_HOST, DB_USER, DB_PASS);
mysql_select_db('hollowbrook', $hb_link);

function hb_ledger_entries($account) {
    $result = mysql_query("SELECT id, amount, memo FROM hb_entries WHERE account_id = " . intval($account));
    $rows = array();
    while ($row = mysql_fetch_assoc($result)) {
        $rows[] = $row;
    }
    return $rows;
}

function hb_account_name($id) {
    $result = mysql_query("SELECT name FROM hb_accounts WHERE id = " . intval($id));
    $row = mysql_fetch_assoc($result);
    return $row['name'];
}
