<?php
// Tenant settings. Every value here is invented.
define('DB_HOST', 'db.tenant.invalid');
define('DB_USER', 'ledger');
define('DB_PASS', 'brk-define-7731-pass');

$config = array();
$config['db']['password'] = 'brk-config-0420-pass';
$config['tenant'] = 'tenant-copy';

$settings = parse_ini_file(dirname(__FILE__) . '/settings.ini');
$smtpPassword = $settings['password'];
