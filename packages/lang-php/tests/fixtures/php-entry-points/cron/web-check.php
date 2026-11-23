<?php
// Compares the SAPI with something other than 'cli': not a CLI check.
if (php_sapi_name() == 'apache2handler') {
    echo "served by Apache\n";
}
