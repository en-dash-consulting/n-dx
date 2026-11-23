<?php
// No dynamic code: named calls, a literal include path and ordinary methods.
require_once __DIR__ . '/helpers.php';

class Plain
{
    public function run($items)
    {
        $this->save();
        Plain::make();
        return strtolower(implode(',', $items));
    }
}
