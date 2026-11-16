<?php
// Sites no database result reaches, or none the forward pass can decide.
function run_snippet($code) {
    eval($code);
}

function run_trimmed() {
    $row = mysql_fetch_assoc(mysql_query('SELECT body FROM blocks'));
    eval(trim($row['body']));
}

function overwritten() {
    $row = mysql_fetch_assoc(mysql_query('SELECT handler FROM pages'));
    $handler = $row['handler'];
    $handler = 'default_handler';
    call_user_func($handler);
}

function from_parameter($rows) {
    foreach ($rows as $row) {
        call_user_func($row['handler']);
    }
}
