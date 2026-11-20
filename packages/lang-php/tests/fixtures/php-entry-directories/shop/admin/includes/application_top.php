<?php
// Paths are relative to the working directory, shop/admin, not this file's.
require('includes/configure.php');
require(DIR_WS_CLASSES . 'logger.php');
// Only the outer entry directory, shop, has these.
require('includes/functions/general.php');
include('./includes/version.php');
require(DIR_WS_CLASSES . $module . '.php');
