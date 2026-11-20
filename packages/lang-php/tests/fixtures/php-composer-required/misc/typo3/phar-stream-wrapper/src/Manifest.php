<?php
namespace TYPO3\PharStreamWrapper;

// brumann/polyfill-unserialize is required by name, with no repositories entry;
// acme/c only through it.
use Brumann\Polyfill\Unserialize;
use Acme\C\Thing;

class Manifest
{
    public function read($data)
    {
        new Thing();
        return Unserialize::unserialize($data);
    }
}
