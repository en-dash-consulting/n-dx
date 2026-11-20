<?php
function make($class, $m)
{
    $class::$m();
    $class::{$m . 'Static'}();
    Factory::create();
    $class::run();
    \App\Factory::create();
}

class Factory
{
    public function build()
    {
        self::create();
        static::create();
        parent::create();
        $this::create();
    }
}
