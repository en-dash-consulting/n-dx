<?php
$link = MySQL_Connect('db', 'u', 'p');
mysql_select_db('shop', $link);
$r = mysql_query('SELECT * FROM t');
while ($row = mysql_fetch_assoc($r)) {
  if (ereg('^x', $row['a']) || eregi('y', $row['b'])) {
    $parts = split(',', $row['c']);
  }
  while (list($k, $v) = each($row)) {}
}
?>
<html><body>
<% echo $title; %>
<%= $footer %>
</body></html>
