<?php
class Checks
{
    public function run($rule)
    {
        assert("$rule > 0");
        assert($rule > 0);
    }
}
