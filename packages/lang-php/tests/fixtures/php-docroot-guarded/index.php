<?php
define('BASEPATH', __DIR__ . '/system/');
require_once BASEPATH . 'Model.php';
echo (new Model())->greeting();
