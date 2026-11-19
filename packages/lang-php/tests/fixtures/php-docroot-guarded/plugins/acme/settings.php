<?php
// Guarded, but a page: it prints when included and also when requested inside the app.
if (!defined('ABSPATH')) {
	echo 'Direct access is not allowed.';
	die();
}

class Acme_Settings {}

echo '<h1>Acme settings</h1>';
