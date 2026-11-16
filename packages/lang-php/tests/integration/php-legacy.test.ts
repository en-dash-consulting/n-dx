/**
 * Removed and deprecated constructs (`src/php-legacy.ts`) through the pack
 * entry, over `php-legacy`: one file per rule (`rules/<rule>.php`), near
 * misses that report nothing (`clean/`), and the
 * shapes a curly-brace offset leaves in the parse plus a PHP 4-era app
 * (`shapes/`), and JavaScript templates in script elements
 * (`shapes/js-templates.php`); and `php-legacy-polyfill`, a project that declares its own
 * `each()`; and `php-function-shadowing`, namespaced helpers and a global
 * polyfill named as built-ins. Skips when the grammar is not built.
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
/** Namespaced helpers and a global polyfill named as built-ins. */
const shadowing = join(import.meta.dirname, "..", "fixtures", "php-function-shadowing");

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

  it("suppresses only calls that resolve to a repository function, namespace by namespace", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await analyze(["legacyConstructs"], shadowing);
    expect(result.degraded).toBeUndefined();
    const facts = new Map(result.facts.map((f) => [f.path, (f.legacyConstructs ?? []).map((c) => `${c.rule}@${c.position.line} ${c.construct}`)]));
    const by = { get: (path: string) => facts.get(path) ?? [] };
    // `namespace Helpers; function mysql_query()` never hides PHP's: not explicitly global, nor from another namespace.
    expect(by.get("explicit.php")).toEqual(["mysql-functions@2 mysql_query()"]);
    expect(by.get("other-namespace.php")).toEqual(["mysql-functions@4 mysql_query()"]);
    // Inside Helpers, or imported with `use function`, the call is the helper.
    expect(by.get("own-namespace.php")).toEqual([]);
    // Jobs imports PHP's own under another name, and App's import does not reach it.
    expect(by.get("aliased.php")).toEqual(["mysql-functions@14 mysql_query()", "mysql-functions@16 mysql_query()"]);
    // A global polyfill takes unqualified calls in any namespace and explicit global ones.
    expect(by.get("polyfill.php")).toEqual([]);
    expect(by.get("polyfill-caller.php")).toEqual([]);
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

  it("skips JavaScript template tags inside script elements, also split by a PHP block, and PHP strings", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = await byPath();
    // Only the `<%=` outside every script element (line 13) is an ASP tag.
    expect(at(facts.get("shapes/js-templates.php"))).toEqual(["asp-tags@13:0"]);
  });

  it("reads nothing when legacy constructs are not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await analyze(["imports"]);
    expect(result.facts.some((f) => f.legacyConstructs !== undefined)).toBe(false);
  });
});
