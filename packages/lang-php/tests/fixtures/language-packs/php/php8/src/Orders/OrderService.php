<?php

declare(strict_types=1);

namespace App\Orders;

use App\Billing\Invoice;
use App\Orders\Events\{OrderPaid, OrderShipped};
use Attribute;

use function App\Support\money;

#[Attribute(Attribute::TARGET_CLASS)]
final class Audited
{
    public function __construct(public readonly string $channel = 'orders') {}
}

enum Status: string
{
    case Open = 'open';
    case Paid = 'paid';

    const DEFAULT = self::Open;

    public function label(): string
    {
        return match ($this) {
            Status::Open => 'Open',
            Status::Paid => ucfirst($this->value),
        };
    }
}

#[Audited(channel: 'billing')]
final class OrderService
{
    public const int MAX_LINES = 100;

    public function __construct(
        private readonly Repository $orders,
        private ?Notifier $notifier = null,
    ) {}

    public function label(?Invoice $invoice): string
    {
        $status = $invoice?->status() ?? Status::Open;
        return match ($status) {
            Status::Paid => money(amount: $invoice->total()),
            default => 'pending',
        };
    }

    public function events(): array
    {
        $make = fn (string $id) => new OrderPaid($id);
        $handler = new class($this->orders) {
            public function __construct(private Repository $orders) {}

            public function handle(string $id): void
            {
                $this->orders->find($id)?->ship();
            }
        };
        $plugin = match (PHP_OS_FAMILY) {
            'Windows' => require __DIR__ . '/plugins/windows.php',
            default => require __DIR__ . '/plugins/posix.php',
        };
        return [$make('a'), new OrderShipped(...['b']), $handler, $plugin, (new Repository)->all()];
    }
}
