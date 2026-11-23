<?php
// A controller class read from a routing table, called statically.
function route_by_class() {
    $row = mysql_fetch_assoc(mysql_query('SELECT controller FROM routes'));
    $class = $row['controller'];
    $class::run();
}

function route_by_class_and_method() {
    $row = mysql_fetch_assoc(mysql_query('SELECT controller, action FROM routes'));
    $class = $row['controller'];
    $method = $row['action'];
    $class::$method();
}
