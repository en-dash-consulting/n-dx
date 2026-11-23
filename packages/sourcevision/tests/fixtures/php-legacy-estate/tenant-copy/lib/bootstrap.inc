<?php
// Shared bootstrap: the database layer, then the tenant's hooks when it has them.
require_once(dirname(__FILE__) . '/db.inc');
require_once(dirname(__FILE__) . '/legacy.inc');
require_once(dirname(__FILE__) . '/sync.inc');

if (file_exists(dirname(__FILE__) . '/../custom/hooks.inc')) {
    require_once(dirname(__FILE__) . '/../custom/hooks.inc');
} else {
    require_once(dirname(__FILE__) . '/hooks.inc');
}
