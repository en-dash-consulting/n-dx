/**
 * Database-driven dynamic code (`src/php-database-flow.ts`) through the pack
 * entry, over `php-database-flow`: a custom app with WordPress-like patterns
 * (a `pages.handler` dispatched with `call_user_func`, a `blocks.body` passed
 * to `eval`, a route row loaded by `lib/routes.php`'s `get_route()` and
 * dispatched by `front.php`, a repository class, a controller class from a
 * routing table called statically in `routes-static.php`, per-property and
 * per-element provenance in `properties.php`), Drupal 7's menu router
 * shape under `drupal/`, and `not-database.php`, whose sites no database
 * result reaches or the forward pass cannot decide. Skips when the grammar
 * is not built.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import type { DynamicCodeFact } from "@n-dx/lang-kit";
import { MAX_EXPRESSION_DEPTH, PHP_DB_DISPATCH, PHP_DB_EXEC, pack, phpGrammarPath, phpPack } from "../../src/index.js";

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

  it("marks a static call whose class, or class and method, come from a routing table", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("routes-static.php")).toEqual([
      "variable-static-class 6 [routes] [routes.controller] [routes-static.php:4]",
      "variable-static-method 13 [routes] [routes.action,routes.controller] [routes-static.php:10]",
    ]);
  });

  it("tracks provenance per property and element, a whole row still reaching its elements", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await sites()).get("properties.php")).toEqual([
      // A literal sibling of a database-fed property, then the fed one.
      "call_user_func 8 -",
      "eval 9 [blocks] [blocks.body] [properties.php:4]",
      // A literal written over a database-fed property clears it.
      "call_user_func 17 -",
      "call_user_func 25 -",
      "call_user_func 26 [pages] [pages.handler] [properties.php:21]",
      "call_user_func 32 [pages] [pages.handler] [properties.php:30]",
      "call_user_func 40 [pages] [pages.handler] [properties.php:36]",
      "call_user_func 47 [pages] [pages.handler] [properties.php:45]",
      // A copy keeps each property's own sources, not the object's as a whole.
      "call_user_func 57 -",
      // Parentheses around the object or a copy's source change neither.
      "call_user_func 66 -",
      "eval 67 [blocks] [blocks.body] [properties.php:62]",
      "call_user_func 76 -",
      "eval 77 [blocks] [blocks.body] [properties.php:71]",
      // Nor around an array base, a written object or a method receiver.
      "call_user_func 86 -",
      "call_user_func 87 -",
      "eval 88 [blocks] [blocks.body] [properties.php:82]",
      "call_user_func 96 -",
      "eval 97 [blocks] [blocks.body] [properties.php:92]",
      "call_user_func 108 [pages] [pages.handler] [properties.php:103]",
    ]);
  });

  it("never marks a parameter-fed site, nor a flow it cannot decide", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    // A variable replaced by a closure or arrow function no longer holds the row.
    expect((await sites()).get("not-database.php")).toEqual([
      "eval 4 -",
      "eval 9 -",
      "call_user_func 16 -",
      "call_user_func 21 -",
      "variable-function 29 -",
      "variable-function 32 -",
    ]);
  });

  it("marks Drupal 7's menu router dispatch, loaded from menu_router into a static cache, and leaves php_eval unmarked", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const by = await sites();
    expect(by.get("drupal/menu.php")).toEqual(["call_user_func_array 26 [menu_router] [] [drupal/menu.php:11]"]);
    expect(by.get("drupal/php.php")).toEqual(["eval 5 -"]);
  });

  it("misses a value read too deep to follow rather than losing every dynamic-code fact", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const deep = mkdtempSync(join(tmpdir(), "php-db-flow-deep-"));
    try {
      const nested = `${"(".repeat(MAX_EXPRESSION_DEPTH * 25)}$row['body']${")".repeat(MAX_EXPRESSION_DEPTH * 25)}`;
      writeFileSync(join(deep, "deep.php"), `<?php\n$row = mysql_fetch_assoc(mysql_query('SELECT body FROM blocks'));\neval(${nested});\neval($row['body']);\n`);
      const result = await pack.analyzeProject({ projectDir: deep, files: ["deep.php"], kinds: ["dynamicCode"] });
      expect((result.notices ?? []).filter((n) => n.includes("failed"))).toEqual([]);
      expect(result.facts[0]!.dynamicCode!.map((f) => [f.position.line, f.database?.tables ?? null])).toEqual([
        [3, null],
        [4, ["blocks"]],
      ]);
    } finally {
      rmSync(deep, { recursive: true, force: true });
    }
  });

  it("notices database-driven sites with their tables", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const notices = (await analyze()).notices ?? [];
    expect(notices.filter((n) => n.includes(`[${PHP_DB_EXEC}]`))).toEqual([
      `PHP: [${PHP_DB_EXEC}] 6 sites run code read from a database: blocks.php:7, properties.php:9, properties.php:67, properties.php:77, properties.php:88, and 1 more; table blocks.`,
    ]);
    expect(notices.filter((n) => n.includes(`[${PHP_DB_DISPATCH}]`))).toEqual([
      `PHP: [${PHP_DB_DISPATCH}] 13 sites choose what to run from database data: drupal/menu.php:26, front.php:5, front.php:6, lib/PageRepository.php:18, lib/PageRepository.php:24, and 8 more; tables menu_router, pages, routes.`,
    ]);
  });
});
