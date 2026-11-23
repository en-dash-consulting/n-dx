/**
 * Drupal's `.module` and `.install` files are PHP the pack parses
 * (`phpConfig.parseableExtensions`), over `php-drupal-module`: an exception
 * class and two evals in a `.module` file, a function in a `.install` file,
 * and a `.php` file that throws the class. The files are those sourcevision
 * hands the pack: the parseable ones. Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-drupal-module");

async function analyze() {
  const files = listFixtureFiles(dir, [...phpPack.config.parseableExtensions]);
  const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["imports", "symbols", "dynamicCode"] });
  expect(result.degraded).toBeUndefined();
  expect(result.unparsed).toEqual([]);
  return new Map(result.facts.map((f) => [f.path, f]));
}

describe("php pack on Drupal module files", () => {
  it("reports the evals in a .module file as execution sites", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const module = (await analyze()).get("modules/php/php.module");
    expect((module?.dynamicCode ?? []).map((f) => `${f.kind} ${f.construct} ${f.position.line} ${f.scope}`)).toEqual([
      "exec eval 9 php_eval",
      "exec eval 14 php_locale_eval",
    ]);
  });

  it("resolves a class declared in a .module file to that file, not a php: external", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const check = (await analyze()).get("includes/check.php");
    expect(check?.imports?.files.map((r) => `${r.to} ${r.symbols.join(",")}`)).toEqual(["modules/php/php.module PhpEvalException"]);
    expect(check?.imports?.external ?? []).toEqual([]);
  });

  it("reads a .install file's declarations", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const install = (await analyze()).get("modules/php/php.install");
    expect(install?.symbols?.map((s) => `${s.kind} ${s.name}`)).toEqual(["function php_schema"]);
  });
});
