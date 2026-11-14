<?php

namespace Acme\Shop;

final class Money
{
    public static function zero(): self
    {
        return new self();
    }
}
