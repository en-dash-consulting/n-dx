/**
 * CLI and cron entry points (`src/php-entry-points.ts`) through the pack
 * entry, over `php-entry-points`: a shebang script, a `cron/` script with a
 * `PHP_SAPI` check, a `scripts/` script reading `$argv`, a root `crontab`
 * and a system `etc/cron.d/app`. Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-entry-points");

/** `kind file (source) [schedule]` for every entry point, sorted, and the notices. */
async function entryPoints(kinds: Parameters<typeof pack.analyzeProject>[0]["kinds"] = ["entryPoints"]) {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  const lines = result.facts
    .flatMap((f) =>
      (f.entryPoints ?? []).map((e) => `${e.kind} ${f.path} (${e.source} @${e.position.line})${e.schedule === undefined ? "" : ` [${e.schedule}]`}`),
    )
    .sort();
  return { lines, notices: result.notices ?? [] };
}

describe("php entry points", () => {
  it("marks shebang scripts, cli-checking scripts in CLI directories and crontab jobs", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { lines, notices } = await entryPoints();
    expect(lines).toEqual([
      "cli bin/migrate.php (shebang @1)",
      "cli cron/cleanup.php (PHP_SAPI check @3)",
      "cli scripts/report.php ($argv @3)",
      "cron bin/migrate.php (etc/cron.d/app:2 @1) [0 * * * *]",
      "cron cron/cleanup.php (crontab:3 @1) [*/5 * * * *]",
      "cron jobs/nightly.php (crontab:5 @1) [@daily]",
      "cron scripts/report.php (crontab:4 @1) [0 3 * * *]",
    ]);
    // Not marked: cron/web-check.php (compares with 'apache2handler'), tools/args.php ($argv outside a CLI directory), index.php.
    expect(notices).toEqual([
      "PHP: crontab:6 runs /var/www/app/cron/missing.php, which is not a PHP file of the repository; no entry point recorded.",
    ]);
  });

  it("gives no entry points when they are not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { lines, notices } = await entryPoints(["imports", "routes"]);
    expect(lines).toEqual([]);
    expect(notices.filter((n) => n.includes("crontab"))).toEqual([]);
  });
});
