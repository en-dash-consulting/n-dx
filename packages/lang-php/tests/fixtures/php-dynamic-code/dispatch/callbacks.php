<?php
$upper = array_map($cb, $items);
$kept = array_filter($items, $filter);
usort($items, [$this, $compare]);
$fixed = array_map('trim', $items);
$closure = array_filter($items, function ($i) { return $i; });
usort($items, [$this, 'compare']);
$lengths = array_map(strlen(...), $items);
