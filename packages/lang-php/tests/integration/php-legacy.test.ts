/**
 * Removed and deprecated constructs (`src/php-legacy.ts`) through the pack
 * entry, over `php-legacy`: one file per rule (`rules/<rule>.php`), near
 * misses that report nothing (`clean/`), and the
 * shapes a curly-brace offset leaves in the parse plus a PHP 4-era app
 * (`shapes/`); and `php-legacy-polyfill`, a project that declares its own
 * `each()`. Skips when the grammar is not built.
 */

import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import type { FactKind, LegacyConstructFact } from "@n-dx/lang-kit";
import { LEGACY_RULES, legacySource, legacyStatus, pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-legacy");
/** A project that declares its own `each()`. */
const polyfill = join(import.meta.dirname, "..", "fixtures", "php-legacy-polyfill");

async function analyze(kinds: readonly FactKind[] = ["legacyConstructs"], projectDir = dir) {
  return pack.analyzeProject({ projectDir, files: listFixtureFiles(projectDir, [...phpPack.config.extensions]), kinds });
}

async function byPath(): Promise<Map<string, readonly LegacyConstructFact[]>> {
  const result = await analyze();
  expect(result.degraded).toBeUndefined();
  return new Map(result.facts.map((f) => [f.path, f.legacyConstructs ?? []]));
}

const at = (facts: readonly LegacyConstructFact[] | undefined) => (facts ?? []).map((f) => `${f.rule}@${f.position.line}:${f.position.column}`);

describe("php legacy constructs", () => {
  it("reports each per-rule fixture's construct once, with its status and php.net pages", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    for (const [id, rule] of Object.entries(LEGACY_RULES)) {
      const found = (facts.get(`rules/${id}.php`) ?? []).filter((f) => f.rule === id);
      expect(found, id).toHaveLength(1);
      expect(found[0], id).toMatchObject({ status: legacyStatus(rule), source: legacySource(rule) });
      for (const boundary of ["deprecated", "removed", "changed"] as const) expect(found[0]![boundary], `${id} ${boundary}`).toEqual((rule as Record<string, unknown>)[boundary]);
    }
  });

  it("has a fixture for every rule and no fixture without a rule", () => {
    const fixtures = readdirSync(join(dir, "rules")).map((f) => f.replace(/\.php$/, ""));
    expect(fixtures.sort()).toEqual(Object.keys(LEGACY_RULES).sort());
  });

  it("reports the short open tag and the string-to-number comparison as notices, never removals", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    expect(facts.get("rules/short-open-tag.php")).toEqual([
      expect.objectContaining({ rule: "short-open-tag", status: "notice", position: { line: 1, column: 0 } }),
    ]);
    // `$status == 0` compares a variable; only the literal 'abc' counts.
    expect(facts.get("rules/string-number-comparison.php")).toEqual([
      expect.objectContaining({ rule: "string-number-comparison", status: "notice", changed: LEGACY_RULES["string-number-comparison"].changed, position: { line: 2, column: 20 } }),
    ]);
    for (const list of facts.values()) for (const f of list) if (f.status === "notice") expect(f.removed).toBeUndefined();
  });

  it("names the use: the function as written, the class and property", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    expect(facts.get("rules/mysql-functions.php")?.[0]?.construct).toBe("mysql_connect()");
    expect(facts.get("rules/php4-constructor.php")).toEqual([expect.objectContaining({ rule: "php4-constructor", construct: "PHP 4 constructor Cart::Cart()" })]);
    expect(facts.get("rules/dynamic-property.php")).toEqual([
      expect.objectContaining({ rule: "dynamic-property", construct: "dynamic property Order::$total", likely: true, position: { line: 4, column: 49 } }),
    ]);
  });

  it("reports nothing for near misses or a namespaced class", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    for (const file of ["clean/near-misses.php", "clean/namespaced.php"]) expect(at(facts.get(file)), file).toEqual([]);
  });

  it("reports no call of a removed function the repository declares itself, in any file", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await analyze(["legacyConstructs"], polyfill);
    expect(result.facts.map((f) => f.path).sort()).toEqual(["polyfill-define.php", "polyfill-use.php"]);
    expect(result.facts.flatMap((f) => f.legacyConstructs ?? [])).toEqual([]);
  });

  it("finds every curly-brace offset, however the parse breaks around it, once each at its brace", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    expect(at(facts.get("shapes/curly-offsets.php"))).toEqual([
      "curly-offset@2:6",
      "curly-offset@3:7",
      "curly-offset@4:14",
      "curly-offset@5:2",
      "curly-offset@6:6",
      "curly-offset@7:16",
      "curly-offset@8:7",
    ]);
  });

  it("counts a PHP 4-era app's uses in document order, ASP tags included", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    expect(at(facts.get("shapes/legacy-app.php"))).toEqual([
      "mysql-functions@2:8",
      "mysql-functions@3:0",
      "mysql-functions@4:5",
      "mysql-functions@5:14",
      "ereg-functions@6:6",
      "ereg-functions@6:31",
      "ereg-functions@7:13",
      "each@9:24",
      "asp-tags@13:0",
      "asp-tags@14:0",
    ]);
    expect(facts.get("shapes/legacy-app.php")?.[0]?.construct).toBe("MySQL_Connect()");
  });

  it("reads nothing when legacy constructs are not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await analyze(["imports"]);
    expect(result.facts.some((f) => f.legacyConstructs !== undefined)).toBe(false);
  });
});
