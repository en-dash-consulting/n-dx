<?php
// Refuses to run from the web server: a CLI entry point under cron/.
if (PHP_SAPI !== 'cli') {
    header('HTTP/1.1 403 Forbidden');
    exit(1);
}

foreach (glob('/tmp/app-*') as $file) {
    unlink($file);
}
