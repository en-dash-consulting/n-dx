/**
 * The PHP grammar this pack builds (its `build:grammars` script) loads in
 * Node through the runtime and parses PHP: a PHP 5 page with `<?php … ?>`
 * blocks between HTML, and PHP 8 code. The grammar is a local build artifact,
 * so the test skips (with the command to run) when it has not been built,
 * unless SV_REQUIRE_GRAMMARS=1, which CI sets and which makes a missing
 * grammar fail.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { createTreeSitterRunner, skipUnlessGrammar } from "@n-dx/lang-runtime";

import { pack } from "../../src/pack.js";
import { phpGrammarPath, phpPack } from "../../src/php-pack.js";

const PHP_WASM = phpGrammarPath();
const runner = createTreeSitterRunner();
afterAll(() => runner.dispose());

/** PHP 5 style: markup with PHP blocks, short echo tags and the alternative `if:`/`endif;` syntax. */
const PHP5_PAGE = `<html>
<head><title><?php echo $title; ?></title></head>
<body>
<?php
include 'config.inc';
require_once("lib/db.php");

function list_users($db) {
    $result = mysql_query("SELECT name FROM users", $db);
    return $result;
}
?>
<ul>
<?php if ($users): ?>
  <li><?= htmlspecialchars($users[0]) ?></li>
<?php endif; ?>
</ul>
</body>
</html>
`;

/** PHP 8: namespace, use imports, enum, readonly promoted properties, match, nullsafe and named arguments. */
const PHP8_FILE = `<?php

declare(strict_types=1);

namespace App\\Orders;

use App\\Billing\\Invoice;
use function App\\Support\\money;

enum Status: string
{
    case Open = 'open';
    case Paid = 'paid';
}

final class OrderService
{
    public function __construct(private readonly Repository $orders) {}

    public function label(?Invoice $invoice): string
    {
        $status = $invoice?->status() ?? Status::Open;
        return match ($status) {
            Status::Paid => money(amount: $invoice->total()),
            default => 'pending',
        };
    }
}
`;

describe("tree-sitter-php grammar (WASM)", () => {
  for (const [label, path, source] of [
    ["a PHP 5 page with inline HTML", "users.php", PHP5_PAGE],
    ["a PHP 8 file", "OrderService.php", PHP8_FILE],
  ] as const) {
    it(`parses ${label} without ERROR or MISSING nodes`, async (ctx) => {
      skipUnlessGrammar(ctx, PHP_WASM);

      const result = await runner.parseSource({ pack: phpPack, grammarPath: PHP_WASM }, path, source);

      expect(result.status).toBe("parsed");
      if (result.status !== "parsed") return;
      expect(result.hasErrorNodes).toBe(false);
      expect(result.hasMissingNodes).toBe(false);
    });
  }

  it("runs through the pack entry and reports imports as written, with no import edges", async (ctx) => {
    skipUnlessGrammar(ctx, PHP_WASM);
    const projectDir = mkdtempSync(join(tmpdir(), "lang-php-entry-"));
    try {
      writeFileSync(join(projectDir, "users.php"), PHP5_PAGE);
      writeFileSync(join(projectDir, "OrderService.php"), PHP8_FILE);

      const result = await pack.analyzeProject({ projectDir, files: ["users.php", "OrderService.php"] });

      expect(result.degraded).toBeUndefined();
      expect(result.unparsed).toEqual([]);
      expect(result.facts.map((f) => f.path)).toEqual(["users.php", "OrderService.php"]);
      const written = result.facts.map((f) => f.imports?.written?.map((w) => `${w.form} ${w.specifier}`));
      expect(written).toEqual([
        ["include 'config.inc'", 'require_once "lib/db.php"'],
        ["use App\\Billing\\Invoice", "use function App\\Support\\money"],
      ]);
      for (const f of result.facts) expect(f.imports?.files).toEqual([]);
      // No file declares App\Billing or App\Support, only App\Orders: they are a library's.
      expect(result.facts.map((f) => f.imports?.external)).toEqual([
        [],
        [{ package: "php:App", symbols: ["App\\Billing\\Invoice", "App\\Support\\money"] }],
      ]);
      expect(result.facts[0]?.symbols?.map((s) => `${s.kind} ${s.name}`)).toEqual(["function list_users"]);
    } finally {
      rmSync(projectDir, { recursive: true, force: true });
    }
  });
});
