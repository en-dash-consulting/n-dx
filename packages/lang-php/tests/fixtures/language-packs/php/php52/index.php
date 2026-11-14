<?php
/* PHP 5.2 style: no namespaces, dirname(__FILE__) includes, PEAR-style names. */
require_once(dirname(__FILE__) . '/lib/Shop/Cart.php');
require_once dirname(__FILE__) . "/config.inc.php";
include 'header.php';
@include_once('optional.php');

define('SHOP_ROOT', dirname(__FILE__));
define("SHOP_VERSION", '1.0');
define($dynamicName, 1);

if (!defined('SHOP_DEBUG')) {
    define('SHOP_DEBUG', false);
}

if (file_exists(SHOP_ROOT . '/local.php')) {
    include SHOP_ROOT . '/local.php';
} elseif ($fallback) {
    include 'fallback.php';
} else {
    require 'defaults.php';
}

function_exists('json_encode') || require_once 'compat/json.php';
$config = require 'settings.php';
require 'boot.php' or die('boot failed');

switch ($page) {
    case 'cart':
        include 'pages/' . $page . '.php';
        break;
}

foreach ($plugins as $plugin) {
    include_once $plugin;
}

$cart = new Shop_Cart;
$cart->addItem('sku-1', 2);
$total = Shop_Cart::format($cart->total());
// A space before the argument list still names the call.
$result = mysql_query ($sql);
$rows = $db->query ($sql);
?>
<html>
<head><title><?php echo htmlspecialchars($title); ?></title></head>
<body>
<?php if ($user): ?>
  <?php include 'partials/user.php'; ?>
  <p>Hello, <?= $user->getName() ?></p>
<?php else: ?>
  <?php include 'partials/login.php'; ?>
<?php endif; ?>
<ul>
<?php foreach ($cart->items() as $item) { ?>
  <li><?php echo format_price($item["price"], "USD"); ?></li>
<?php } ?>
</ul>
</body>
</html>
