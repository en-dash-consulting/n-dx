<?php
// The shape of Drupal 7's includes/menu.inc: the router row is cached in a
// static array and returned, then dispatched by the active handler.
function menu_get_item($path = NULL, $router_item = NULL) {
  $router_items = &drupal_static(__FUNCTION__);
  if (isset($router_item)) {
    $router_items[$path] = $router_item;
  }
  if (!isset($router_items[$path])) {
    $ancestors = menu_get_ancestors($path);
    $router_item = db_query_range('SELECT * FROM {menu_router} WHERE path IN (:ancestors) ORDER BY fit DESC', 0, 1, array(':ancestors' => $ancestors))->fetchAssoc();
    if ($router_item) {
      $router_items[$path] = $router_item;
    }
    else {
      $router_items[$path] = FALSE;
    }
  }
  return $router_items[$path];
}

function menu_execute_active_handler($path = NULL, $deliver = TRUE) {
  $page_callback_result = MENU_NOT_FOUND;
  if ($router_item = menu_get_item($path)) {
    if ($router_item['access']) {
      $page_callback_result = call_user_func_array($router_item['page_callback'], $router_item['page_arguments']);
    }
  }
  return $page_callback_result;
}
