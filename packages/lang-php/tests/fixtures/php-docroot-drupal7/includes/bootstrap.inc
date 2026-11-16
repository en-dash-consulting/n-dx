<?php

/**
 * Functions that need to be loaded on every Drupal request.
 */

function drupal_bootstrap($phase = NULL) {
  return $phase;
}

function menu_execute_active_handler() {
}

function drupal_cron_run() {
}
