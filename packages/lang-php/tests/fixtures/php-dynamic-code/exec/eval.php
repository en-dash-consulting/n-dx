<?php
function render_block($body)
{
    return eval($body);
}

eval('return 1;');
