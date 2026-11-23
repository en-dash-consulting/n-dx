<?php
// Provenance per property and element: a database-fed one never marks its siblings.
function sibling_property() {
    $row = mysql_fetch_assoc(mysql_query('SELECT body FROM blocks'));
    $x = new stdClass();
    $x->body = $row['body'];
    $x->handler = 'trim';
    call_user_func($x->handler);
    eval($x->body);
}

function overwritten_property() {
    $row = mysql_fetch_assoc(mysql_query('SELECT handler FROM pages'));
    $x = new stdClass();
    $x->handler = $row['handler'];
    $x->handler = 'trim';
    call_user_func($x->handler);
}

function sibling_element() {
    $row = mysql_fetch_assoc(mysql_query('SELECT handler FROM pages'));
    $a = array();
    $a['db'] = $row['handler'];
    $a["k"] = 'trim';
    call_user_func($a['k']);
    call_user_func($a["db"]);
}

function whole_row() {
    $row = mysql_fetch_assoc(mysql_query('SELECT handler FROM pages'));
    $obj = $row;
    call_user_func($obj['handler']);
}

function copied_object() {
    $row = mysql_fetch_assoc(mysql_query('SELECT handler FROM pages'));
    $x = new stdClass();
    $x->handler = $row['handler'];
    $y = $x;
    call_user_func($y->handler);
}

function collected_rows() {
    $rows = array();
    $rows[] = mysql_fetch_assoc(mysql_query('SELECT handler FROM pages'));
    foreach ($rows as $r) {
        call_user_func($r['handler']);
    }
}

function copied_sibling() {
    $row = mysql_fetch_assoc(mysql_query('SELECT body FROM blocks'));
    $x = new stdClass();
    $x->body = $row['body'];
    $x->handler = 'trim';
    $y = $x;
    call_user_func($y->handler);
}
