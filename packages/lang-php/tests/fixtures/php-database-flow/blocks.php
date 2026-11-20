<?php
// Blocks keep PHP in their body column.
function render_blocks() {
    global $wpdb;
    $blocks = $wpdb->get_results("SELECT b.body, b.title AS heading FROM blocks b WHERE b.region = 'main'");
    foreach ($blocks as $block) {
        eval('?>' . $block->body);
    }
}
