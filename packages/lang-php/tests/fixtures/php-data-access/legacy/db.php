<?php
// A PHP 5 mysql_* application.
define('DB_HOST', 'mysql.internal:3306');
define('TABLE_PREFIX', 'shop_');
$link = mysql_connect(DB_HOST, 'app', 'secret');
mysql_select_db('shop', $link);
$result = mysql_query("SELECT id, name FROM customers WHERE active = 1", $link);
$sql = "SELECT o.id FROM orders o JOIN order_items i ON i.order_id = o.id WHERE o.customer_id = " . (int) $_GET['id'];
$orders = mysql_query($sql);
mysql_query('UPDATE customers SET last_seen = NOW() WHERE id = ' . $id);
mysql_query("SELECT * FROM " . TABLE_PREFIX . "settings");
// The table is not known: no table.
mysql_query("SELECT * FROM {$table} WHERE id = 1");
mysql_query("DELETE FROM archive_$year WHERE id = 1");
$report = "SELECT region";
$report .= " FROM sales_totals";
mysql_query($report);
$p = mysql_pconnect($config['db_host']);
// Drupal 7: braces around a table name are its prefix.
db_query('SELECT nid FROM {node} WHERE type = :type', array(':type' => 'page'));
// Not SQL.
mysql_db_query('shop', 'SHOW TABLES');
