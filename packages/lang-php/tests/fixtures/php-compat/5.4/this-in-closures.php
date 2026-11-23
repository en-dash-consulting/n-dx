<?php
class Cart {
  var $items;
  function total() {
    return array_map(function ($i) { return $this->price($i); }, $this->items);
  }
}
