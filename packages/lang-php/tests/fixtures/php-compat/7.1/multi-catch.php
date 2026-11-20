<?php
try {
  run();
} catch (InvalidArgumentException | RuntimeException $e) {
  report($e);
}
