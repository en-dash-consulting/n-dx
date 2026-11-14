<?php

namespace Acme\Shop\One {
    use Acme\Shop\Money as Cash;

    class A extends Cash
    {
    }
}

namespace Acme\Shop\Two {
    // `Cash` was imported in the namespace above only: here it is Acme\Shop\Two\Cash.
    class B extends Cash
    {
    }
}
