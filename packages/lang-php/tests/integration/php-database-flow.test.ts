/**
 * Database-driven dynamic code (`src/php-database-flow.ts`) through the pack
 * entry, over `php-database-flow`: a custom app with WordPress-like patterns
 * (a `pages.handler` dispatched with `call_user_func`, a `blocks.body` passed
 * to `eval`, a route row loaded by `lib/routes.php`'s `get_route()` and
 * dispatched by `front.php`, a repository class), Drupal 7's menu router
 * shape under `drupal/`, and `not-database.php`, whose sites no database
 * result reaches or the forward pass cannot decide. Skips when the grammar
 * is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import type { DynamicCodeFact } from "@n-dx/lang-kit";
import { PHP_DB_DISPATCH, PHP_DB_EXEC, pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-database-flow");

async function analyze() {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds: ["dynamicCode"] });
  expect(result.degraded).toBeUndefined();
  expect(result.unparsed).toEqual([]);
  return result;
}

/** Each file's sites as `construct line [tables] [columns] [source path:line …]`, `-` when not database-driven. */
async function sites(): Promise<Map<string, string[]>> {
  const brief = (f: DynamicCodeFact) =>
    f.database === undefined
      ? `${f.construct} ${f.position.line} -`
      : [
          f.construct,
          f.position.line,
          `[${f.database.tables.join(",")}]`,
          `[${f.database.columns.join(",")}]`,
          `[${f.database.sources.map((s) => `${s.path}:${s.position.line}`).join(",")}]`,
        ].join(" ");
  return new Map((await analyze()).facts.map((f) => [f.path, (f.dynamicCode ?? []).map(brief)]));
}

describe("php database-driven dynamic code", () => {
  it("marks a dispatch on a fetched column, naming its table and column", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("pages.php")).toEqual(["call_user_func 6 [pages] [pages.handler] [pages.php:4]"]);
  });

  it("marks an eval of a column read through $wpdb and foreach, a table alias resolved", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("blocks.php")).toEqual(["eval 7 [blocks] [blocks.body,blocks.title] [blocks.php:5]"]);
  });

  it("follows a row returned by a repository function into another file's dispatch", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("front.php")).toEqual([
      "variable-new 5 [routes] [routes.action,routes.controller] [lib/routes.php:5]",
      "variable-method 6 [routes] [routes.action,routes.controller] [lib/routes.php:5]",
    ]);
  });

  it("follows repository methods through $this and a method name only one class declares", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("lib/PageRepository.php")).toEqual([
      "variable-function 18 [pages] [pages.handler] [lib/PageRepository.php:11]",
      "call_user_func_array 24 [pages] [pages.handler] [lib/PageRepository.php:11]",
    ]);
  });

  it("never marks a parameter-fed site, nor a flow it cannot decide", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("not-database.php")).toEqual(["eval 4 -", "eval 9 -", "call_user_func 16 -", "call_user_func 21 -"]);
  });

  it("marks Drupal 7's menu router dispatch, loaded from menu_router into a static cache, and leaves php_eval unmarked", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const by = await sites();
    expect(by.get("drupal/menu.php")).toEqual(["call_user_func_array 26 [menu_router] [] [drupal/menu.php:11]"]);
    expect(by.get("drupal/php.php")).toEqual(["eval 5 -"]);
  });

  it("notices database-driven sites with their tables", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const notices = (await analyze()).notices ?? [];
    expect(notices.filter((n) => n.includes(`[${PHP_DB_EXEC}]`))).toEqual([
      `PHP: [${PHP_DB_EXEC}] 1 site runs code read from a database: blocks.php:7; table blocks.`,
    ]);
    expect(notices.filter((n) => n.includes(`[${PHP_DB_DISPATCH}]`))).toEqual([
      `PHP: [${PHP_DB_DISPATCH}] 6 sites choose what to run from database data: drupal/menu.php:26, front.php:5, front.php:6, lib/PageRepository.php:18, lib/PageRepository.php:24, and 1 more; tables menu_router, pages, routes.`,
    ]);
  });
});
