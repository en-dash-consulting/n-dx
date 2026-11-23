<?php
declare(strict_types=1);

namespace Fernwick\Tally;

final class Counter
{
    public function format(string $label, int $cents): string
    {
        return sprintf('%s: %d.%02d', $label, intdiv($cents, 100), $cents % 100);
    }
}
