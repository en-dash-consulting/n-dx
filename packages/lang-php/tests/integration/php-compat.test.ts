/**
 * The version floor (`src/php-compat.ts`) through the pack entry, over
 * `php-compat`: one file per rule (`<version>/<rule>.php`, that construct
 * alone), a PHP 4/5.2-style file that uses nothing a rule dates, and a file
 * where two rules share the highest version. Skips when the grammar is not
 * built.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import type { FactKind } from "@n-dx/lang-kit";
import { SYNTAX_RULES, pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-compat");

async function analyze(kinds: readonly FactKind[] = ["versionFloor"]) {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  expect(result.unparsed).toEqual([]);
  return result;
}

describe("php version floor", () => {
  it("gives each per-rule fixture that rule's version, construct and php.net page", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const byPath = new Map((await analyze()).facts.map((f) => [f.path, f.versionFloor]));
    for (const [id, rule] of Object.entries(SYNTAX_RULES)) {
      const floor = byPath.get(`${rule.version}/${id}.php`);
      expect(floor, id).toMatchObject({ version: rule.version, rule: id, construct: rule.construct, source: rule.source });
    }
  });

  it("has a fixture for every rule and no fixture without a rule", () => {
    const fixtures = readdirSync(dir)
      .filter((d) => /^\d+\.\d+$/.test(d))
      .flatMap((version) => readdirSync(join(dir, version)).map((file) => `${version}/${file.replace(/\.php$/, "")}`));
    const rules = Object.entries(SYNTAX_RULES).map(([id, r]) => `${r.version}/${id}`);
    expect(fixtures.sort()).toEqual(rules.sort());
  });

  it("gives no floor to a file that uses nothing a rule dates", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const legacy = (await analyze()).facts.find((f) => f.path === "none/legacy.php");
    expect(legacy).toBeDefined();
    expect(legacy!.versionFloor).toBeUndefined();
  });

  it("takes the highest version, and the first use among that version's rules", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const mixed = (await analyze()).facts.find((f) => f.path === "mixed/service.php");
    expect(mixed?.versionFloor).toEqual({
      version: "7.4",
      rule: "arrow-functions",
      construct: "arrow function",
      source: "https://www.php.net/manual/en/migration74.new-features.php",
      position: { line: 6, column: 7 },
    });
  });

  it("reads type keywords in any case, as PHP does, and a class type hint as nothing", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const byPath = new Map((await analyze()).facts.map((f) => [f.path, f.versionFloor]));
    expect(byPath.get("case/upper-scalar.php")).toMatchObject({ version: "7.0", rule: "scalar-type-declarations", position: { line: 2, column: 17 } });
    expect(byPath.get("case/upper-object.php")).toMatchObject({ version: "7.2", rule: "object-type" });
    // A class name dates nothing; the qualified one is a namespace (5.3).
    expect(byPath.get("case/class-hint.php")).toMatchObject({ version: "5.3", rule: "namespaces" });
  });

  it("reads nothing when the version floor is not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await analyze(["imports"]);
    expect(result.facts.some((f) => f.versionFloor !== undefined)).toBe(false);
  });
});
