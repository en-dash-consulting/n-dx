<?php
try {
  run();
} catch (Exception $e) {
  report($e);
} finally {
  cleanup();
}
