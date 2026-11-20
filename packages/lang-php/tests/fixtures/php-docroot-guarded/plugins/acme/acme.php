<?php
/**
 * Plugin Name: Acme (WordPress-shaped guard)
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Exit if accessed directly.
}

final class Acme_Plugin {
	public static function boot() {}
}

function acme_init() {
	Acme_Plugin::boot();
}
