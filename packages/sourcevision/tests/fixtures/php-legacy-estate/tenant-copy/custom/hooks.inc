<?php
// Tenant override: the shared hooks, plus one rule the tenant keeps in its own table.
require_once(dirname(__FILE__) . '/../lib/hooks.inc');

function hb_tenant_rule($name) {
    $rule = mysql_fetch_assoc(mysql_query("SELECT expr FROM hb_rules WHERE name = '" . mysql_real_escape_string($name) . "'"));
    $check = create_function('$amount', $rule['expr']);
    return $check;
}
