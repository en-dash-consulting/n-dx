/**
 * Dynamic code (`src/php-dynamic-code.ts`) through the pack entry, over
 * `php-dynamic-code`: one file per kind of site under `exec/`, `dispatch/`
 * and `include/`, each beside the near misses that are no site, and under
 * `lib/` files with none (a polyfill among them); and over
 * `php-function-shadowing`, namespaced helpers and a global polyfill named as
 * built-ins. Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import type { DynamicCodeFact, FactKind } from "@n-dx/lang-kit";
import { PHP_DYNAMIC_DISPATCH, PHP_DYNAMIC_EXEC, pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-dynamic-code");
/** Namespaced helpers and a global polyfill named as built-ins. */
const shadowing = join(import.meta.dirname, "..", "fixtures", "php-function-shadowing");

async function analyze(kinds: readonly FactKind[] = ["dynamicCode"], projectDir = dir) {
  const result = await pack.analyzeProject({ projectDir, files: listFixtureFiles(projectDir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  expect(result.unparsed).toEqual([]);
  return result;
}

/** Each file's sites as `kind construct line scope [literal]`. */
async function sites(projectDir = dir): Promise<Map<string, string[]>> {
  const brief = (f: DynamicCodeFact) => [f.kind, f.construct, f.position.line, f.scope ?? "-", ...(f.literal ? ["literal"] : [])].join(" ");
  return new Map((await analyze(["dynamicCode"], projectDir)).facts.map((f) => [f.path, (f.dynamicCode ?? []).map(brief)]));
}

describe("php dynamic code", () => {
  it("reports eval, string assert, /e preg_replace and create_function as exec sites, literal code marked", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const by = await sites();
    expect(by.get("exec/eval.php")).toEqual(["exec eval 4 render_block", "exec eval 7 - literal"]);
    // `assert($rule > 0)` asserts an expression, not a string.
    expect(by.get("exec/assert.php")).toEqual(["exec assert 6 Checks::run"]);
    // `'/\s+/'` has no `e`; `{x}ie` is bracket-delimited.
    expect(by.get("exec/preg-replace-e.php")).toEqual(["exec preg_replace 2 - literal", "exec preg_replace 4 -"]);
    expect(by.get("exec/create-function.php")).toEqual(["exec create_function 2 - literal", "exec create_function 4 {closure}"]);
  });

  it("reports calls whose callable is chosen by a value as dispatch sites, never a static callable", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const by = await sites();
    expect(by.get("dispatch/call-user-func.php")).toEqual([
      "dispatch call_user_func 6 Router::handle",
      "dispatch call_user_func_array 7 Router::handle",
      "dispatch forward_static_call_array 11 Router::handle",
    ]);
    expect(by.get("dispatch/variable-function.php")).toEqual(["dispatch variable-function 5 dispatch", "dispatch variable-function 6 dispatch"]);
    expect(by.get("dispatch/variable-new.php")).toEqual(["dispatch variable-new 3 -"]);
    expect(by.get("dispatch/variable-method.php")).toEqual(["dispatch variable-method 6 Front::run", "dispatch variable-method 7 Front::run"]);
    // A class chosen by a value is a site with a literal method too; `self`, `static`, `parent`, `$this` and names are not.
    expect(by.get("dispatch/variable-static-method.php")).toEqual([
      "dispatch variable-static-method 4 make",
      "dispatch variable-static-method 5 make",
      "dispatch variable-static-class 7 make",
    ]);
    expect(by.get("dispatch/callbacks.php")).toEqual(["dispatch array_map 2 -", "dispatch array_filter 3 -", "dispatch usort 4 -"]);
  });

  it("keeps the expression as written and its position", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = (await analyze()).facts.find((f) => f.path === "dispatch/call-user-func.php")!.dynamicCode!;
    expect(facts[0]).toEqual({
      kind: "dispatch",
      construct: "call_user_func",
      expression: "call_user_func([$this, $name])",
      scope: "Router::handle",
      position: { line: 6, column: 8 },
    });
  });

  it("counts includes whose path is not computable, host-based apart", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const facts = (await analyze()).facts.find((f) => f.path === "include/dynamic-include.php")!.dynamicCode!;
    expect(facts.map((f) => [f.kind, f.construct, f.expression, f.position.line])).toEqual([
      ["include", "dynamic-include", "$module . '.php'", 3],
      ["include", "host-include", "'config/' . $_SERVER['HTTP_HOST'] . '.php'", 4],
    ]);
  });

  it("finds nothing in files without a site, nor in a call of a function the repository declares", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const by = await sites();
    expect(by.get("lib/static.php")).toEqual([]);
    expect(by.get("lib/helpers.php")).toEqual([]);
  });

  it("suppresses only calls that resolve to a repository function, namespace by namespace", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const found = await sites(shadowing);
    const by = { get: (path: string) => found.get(path) ?? [] };
    // `namespace Helpers; function call_user_func()` never hides PHP's: not explicitly global, nor from another namespace.
    expect(by.get("explicit.php")).toEqual(["dispatch call_user_func 3 -"]);
    expect(by.get("other-namespace.php")).toEqual(["dispatch call_user_func 5 -"]);
    // Inside Helpers, or imported with `use function`, the call is the helper.
    expect(by.get("own-namespace.php")).toEqual([]);
    // Jobs imports PHP's own under another name, and App's import does not reach it.
    expect(by.get("aliased.php")).toEqual(["dispatch call_user_func 15 -"]);
    // A global polyfill takes unqualified calls in any namespace and explicit global ones.
    expect(by.get("polyfill.php")).toEqual([]);
    expect(by.get("polyfill-caller.php")).toEqual([]);
  });

  it("notices exec and dispatch sites with their locations, never includes again", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const notices = (await analyze()).notices ?? [];
    expect(notices.filter((n) => n.includes(`[${PHP_DYNAMIC_EXEC}]`))).toEqual([
      `PHP: [${PHP_DYNAMIC_EXEC}] 7 sites run a string as code: exec/assert.php:6, exec/create-function.php:2, exec/create-function.php:4, exec/eval.php:4, exec/eval.php:7, and 2 more; 3 with literal code.`,
    ]);
    expect(notices.filter((n) => n.includes(`[${PHP_DYNAMIC_DISPATCH}]`))).toHaveLength(1);
    expect(notices.some((n) => n.includes("[php-dynamic-include]") || n.includes("[php-host-include]"))).toBe(false);
  });

  it("reads nothing when dynamic code is not wanted", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await analyze(["imports"]);
    expect(result.facts.every((f) => f.dynamicCode === undefined)).toBe(true);
    expect((result.notices ?? []).some((n) => n.includes(PHP_DYNAMIC_EXEC) || n.includes(PHP_DYNAMIC_DISPATCH))).toBe(false);
  });
});
