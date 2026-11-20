<?php
$fp = fsockopen('smtp.example.com', 25, $errno, $errstr, 30);
$ssl = fsockopen('ssl://' . $_SERVER['MAIL_HOST'], 465);
