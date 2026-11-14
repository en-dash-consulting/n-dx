<?php

// Type names are case-insensitive in PHP: `String`, `Array` and `Bool` are scalar types, not classes.
function shout(String $s, Array $list, Bool $loud = false): String
{
    return $s;
}

class Loud
{
    public static function make(): self
    {
        return new self();
    }

    public function again(): static
    {
        return new static();
    }
}

// Classes of extensions installed beside PHP (PECL), not packages.
$memcached = new Memcached();
$redis = new Redis();
$image = new Imagick();
$mongo = new MongoDB\Driver\Manager('mongodb://localhost');
