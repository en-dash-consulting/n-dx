<?php

require __DIR__ . '/../vendor/autoload.php';

(new \Acme\Kernel())->handle($argv[1] ?? '/');
