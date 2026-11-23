<?php
// Pushes the day's totals to an invented partner service.
function hb_sync_totals($payload) {
    $ch = curl_init('https://ledgerbot:brk-curl-3307-pass@api.partner.invalid/v1/totals');
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    return curl_exec($ch);
}
