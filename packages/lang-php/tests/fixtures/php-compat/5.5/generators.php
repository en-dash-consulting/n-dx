<?php
function lines($f) {
  while (($l = fgets($f)) !== false) { yield $l; }
}
