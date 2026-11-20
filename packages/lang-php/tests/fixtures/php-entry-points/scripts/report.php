<?php
// Reads its command-line arguments: a CLI entry point under scripts/.
$mode = isset($argv[1]) ? $argv[1] : '--weekly';
echo "report $mode\n";
