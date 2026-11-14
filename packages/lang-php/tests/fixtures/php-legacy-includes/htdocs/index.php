<?php
require_once(dirname(__FILE__) . '/../config.php');
require_once dirname(__DIR__) . '/inc/functions.php';
require_once ROOT . '/inc/db.php';
require_once 'Shop/Cart.php';
include 'Mail.php';
include 'Smarty.php';
include './partials/header.php';
if (isset($_GET['admin'])) {
    include LIB . '/admin.php';
}
include THEME . '/layout.php';
include '/usr/share/php/PEAR.php';
include 'missing.php';
include $page;
?>
<p>Welcome</p>
<?php include "partials/footer.php"; ?>
