<?php
require_once 'config.php';

$rates = file_get_contents('https://rates.example.com/latest.json');
$feed = fopen("http://feeds.example.com/news.xml", 'r');
$lines = file(PAYMENTS_URL . '/status');
$url = 'http://status.example.com/ping';
$headers = get_headers($url);

// Local files are not outbound calls.
$local = file_get_contents(__DIR__ . '/data.json');
$log = fopen('/var/log/app.log', 'a');
$dynamic = file_get_contents($path);

// mail() is not an outbound kind.
mail('ops@example.com', 'Report', $rates);
