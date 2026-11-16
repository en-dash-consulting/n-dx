<?php
declare(strict_types=1);

namespace Acme;

final class Kernel
{
    public function handle(string $uri): void
    {
        echo $uri;
    }
}
