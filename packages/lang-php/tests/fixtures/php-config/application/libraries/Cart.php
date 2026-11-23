<?php
require_once __DIR__ . '/../config/config.php';

if (isset($config['features']['wishlist']) && $config['features']['wishlist']) {
    show_wishlist();
}
$base = $config['base_url'];
$missing = $config['smtp_host'];
