<?php
$out = preg_replace('/\{(\w+)\}/e', '$vars["\\1"]', $template);
$safe = preg_replace('/\s+/', ' ', $template);
$braced = preg_replace("{x}ie", $code, $template);
