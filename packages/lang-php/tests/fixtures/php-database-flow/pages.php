<?php
// A page's handler is a column of the pages table.
function render_page($slug) {
    $result = mysql_query("SELECT handler FROM pages WHERE slug = '" . mysql_real_escape_string($slug) . "'");
    $row = mysql_fetch_assoc($result);
    call_user_func($row['handler'], $slug);
}
