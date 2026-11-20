<?php
// Shared hooks: handlers and snippets are kept in the database.
function hb_run_hooks($event) {
    $result = mysql_query("SELECT handler FROM hb_hooks WHERE event = '" . mysql_real_escape_string($event) . "'");
    while ($hook = mysql_fetch_assoc($result)) {
        call_user_func($hook['handler'], $event);
    }
}

function hb_run_snippet($name) {
    $snippet = mysql_fetch_assoc(mysql_query("SELECT body FROM hb_snippets WHERE name = '" . mysql_real_escape_string($name) . "'"));
    eval($snippet['body']);
}
