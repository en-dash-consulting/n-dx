<?php
namespace Brumann\Polyfill;

final class Unserialize
{
    public static function unserialize($serialized)
    {
        return unserialize($serialized);
    }
}
