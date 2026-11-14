/**
 * The PHP pack, run over its fixture project, must reproduce its committed
 * goldens: the query captures with the resolver's written imports
 * (`golden.json`) and the pack entry's facts (`facts.json`). Update both with
 * `pnpm --filter @n-dx/lang-php test:update-goldens`; a plain test run never
 * writes.
 *
 * The fixture has one directory per era of PHP:
 *
 * - `php52/`: no namespaces, `dirname(__FILE__)` includes with and without
 *   parentheses, `@include_once`, concatenated and variable paths, includes in
 *   `if`/`elseif`/`else`, `switch`, loops, functions, methods, behind
 *   `function_exists`/`defined` and on either side of `or`/`||`, PEAR-style
 *   class names, PHP 4 constructors (and one beside `__construct`),
 *   `define()` with literal and variable names, and `<?php` blocks between
 *   HTML with the alternative `if:`/`endif;` syntax.
 * - `php53/`: unbraced and braced namespaces (and a global one), every form
 *   of `use` (aliases, lists, `use function`, `use const`, group use with mixed
 *   entries, a leading `\`), namespace and class constants, interfaces,
 *   traits, closures, `static`, `::class`, and a same-named method in a
 *   namespaced class, which is not a constructor.
 * - `php8/`: enums with methods and constants, attributes, `match` (with
 *   includes in its arms), promoted constructor properties, nullsafe calls,
 *   named arguments, arrow functions, an anonymous class and spread.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-php
 * build:grammars`); a missing fixture fails.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  listFixtureFiles,
  runPackOverFixture,
  skipUnlessGrammar,
  updateRequested,
} from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const dir = fixtureDirFor(PACK_FIXTURE_ROOT, phpPack);

describe("php pack golden", () => {
  it("has a fixture project", () => {
    expect(existsSync(dir), `missing ${dir}`).toBe(true);
  });

  it("matches its goldens", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const actual = await runPackOverFixture({ pack: phpPack, grammarPath: phpGrammarPath() }, dir);
    expect(actual.files.map((f) => f.path)).toEqual(expect.arrayContaining(["php52/index.php", "php53/src/Shop/Order.php", "php8/src/Orders/OrderService.php"]));
    expect(actual.files.every((f) => f.status === "parsed" && !f.hasErrorNodes && !f.hasMissingNodes)).toBe(true);
    expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);

    const files = listFixtureFiles(dir, [...phpPack.config.extensions]);
    const result = await pack.analyzeProject({ projectDir: dir, files });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual([]);
    const text = `${JSON.stringify(result, null, 2)}\n`;
    const factsPath = join(dir, "facts.json");
    if (updateRequested()) {
      writeFileSync(factsPath, text);
      return;
    }
    expect(existsSync(factsPath), `No golden at ${factsPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The facts differ from ${factsPath}; if intended, review them and run test:update-goldens.`).toBe(
      readFileSync(factsPath, "utf-8"),
    );
  });
});
