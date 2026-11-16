<?php
require_once 'config.php';

$ch = curl_init('https://legacy.example.com/orders');
curl_close($ch);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $config['api_url']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);

$ch = curl_init();
curl_setopt_array($ch, array(
    CURLOPT_URL => PAYMENTS_URL . '/charges',
    CURLOPT_POST => true,
));

$base = 'https://reports.example.com';
$ch = CURL_INIT($base . '/daily?id=' . $id);

function fetch($url)
{
    $ch = curl_init($url);
    return curl_exec($ch);
}
