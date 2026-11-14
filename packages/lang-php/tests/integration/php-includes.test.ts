/**
 * Include resolution over a PHP 5.2-style site (`tests/fixtures/php-legacy-includes`):
 * `config.php` defines `ROOT`, `LIB` and `APP` and sets the include path
 * (`set_include_path` with a PEAR-style `lib/`, `ini_set`), `htdocs/.htaccess`
 * adds a relative root, `php.ini` only a root outside the repository, a
 * constant is defined twice with different values and a class constant
 * shares a global constant's name. Runs the pack entry; skips when the
 * grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileFacts } from "@n-dx/lang-kit";
import { createTreeSitterRunner, listFixtureFiles, skipUnlessGrammar, type PackSourceFile } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack, preparePhpImports, readPhpProjectFacts } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-legacy-includes");
const files = (): string[] => listFixtureFiles(dir, [...phpPack.config.extensions]);

async function analyze(): Promise<{ facts: Map<string, FileFacts>; notices: readonly string[] | undefined }> {
  const result = await pack.analyzeProject({ projectDir: dir, files: files(), kinds: ["imports"] });
  expect(result.degraded).toBeUndefined();
  return { facts: new Map(result.facts.map((f) => [f.path, f])), notices: result.notices };
}

const edges = (f: FileFacts | undefined): string[] => (f?.imports?.files ?? []).map((r) => `${r.to} ${r.symbols.join(",")}`);

/** `specifier outcome` for each include of `path`. */
async function includeOutcomes(path: string): Promise<string[]> {
  const paths = files();
  const runner = createTreeSitterRunner();
  const parsed: PackSourceFile[] = [];
  try {
    for (const p of paths) {
      const result = await runner.parseFile({ pack: phpPack, grammarPath: phpGrammarPath() }, join(dir, p));
      if (result.status === "parsed") parsed.push({ path: p, captures: result.captures });
    }
  } finally {
    runner.dispose();
  }
  const facts = await readPhpProjectFacts(dir, paths);
  return preparePhpImports(facts.projects, parsed, [], facts)
    .includes(path)
    .map(({ include, outcome }) =>
      `${include.specifier} ${outcome.kind === "internal" ? `${outcome.target} (${outcome.via})` : outcome.reason}`,
    );
}

describe("php include resolver", () => {
  it("resolves literal, __DIR__, dirname(__FILE__) and constant paths through PHP's search order", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(await includeOutcomes("htdocs/index.php")).toEqual([
      "dirname(__FILE__) . '/../config.php' config.php (anchored)",
      "dirname(__DIR__) . '/inc/functions.php' inc/functions.php (anchored)",
      "ROOT . '/inc/db.php' inc/db.php (anchored)",
      "'Shop/Cart.php' lib/Shop/Cart.php (include-path)",
      "'Mail.php' pear/Mail.php (include-path)",
      "'Smarty.php' app/vendor/Smarty.php (include-path)",
      "'./partials/header.php' htdocs/partials/header.php (relative)",
      "LIB . '/admin.php' lib/admin.php (anchored)",
      "THEME . '/layout.php' dynamic",
      "'/usr/share/php/PEAR.php' outside",
      "'missing.php' not-found",
      "$page dynamic",
      // ROOT is the repository root: a trailing slash does not keep dirname() inside it.
      "dirname(ROOT . '/') . '/header.php' outside",
      // dirname() with levels 0 is an error in PHP.
      "dirname(__FILE__, 0) . '/partials/header.php' dynamic",
      "\"partials/footer.php\" htdocs/partials/footer.php (include-path)",
    ]);
    expect(await includeOutcomes("inc/db.php")).toEqual([
      "APP . '/inc/functions.php' inc/functions.php (anchored)",
      "'helpers.php' inc/helpers.php (including-directory)",
    ]);
    expect(await includeOutcomes("lib/Shop/Cart.php")).toEqual([
      "dirname(__FILE__, 2) . '/Shop.php' lib/Shop.php (anchored)",
      "dirname(__DIR__, 2) . '/inc/db.php' inc/db.php (anchored)",
    ]);
  });

  it("adds include edges beside class edges, keeps the conditional guard and reports roots outside the repository", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const { facts, notices } = await analyze();
    const index = facts.get("htdocs/index.php");
    expect(edges(index)).toEqual([
      "app/vendor/Smarty.php *",
      "config.php *",
      "htdocs/partials/footer.php *",
      "htdocs/partials/header.php *",
      "inc/db.php *",
      "inc/functions.php *",
      "lib/Shop/Cart.php *",
      "lib/admin.php *",
      "pear/Mail.php *",
    ]);
    const admin = index?.imports?.written?.find((w) => w.specifier === "LIB . '/admin.php'");
    expect(admin?.guard).toBe("conditional");
    expect(edges(facts.get("lib/Shop/Cart.php"))).toEqual(["inc/db.php *", "lib/Shop.php *,Shop"]);
    expect(notices).toEqual([
      'PHP: include path root "/usr/share/pear" (php.ini) is outside the repository; ignored.',
      'PHP: include path root "/usr/share/php" (htdocs/.htaccess) is outside the repository; ignored.',
      // THEME (defined twice), $page and dirname(__FILE__, 0); the last's suffix matches htdocs/partials/header.php.
      "PHP: [php-dynamic-include] 3 includes build their path at run time and give no edge: htdocs/index.php:12, htdocs/index.php:15, htdocs/index.php:17; 1 with candidate files, never edges.",
    ]);
    expect(index?.imports?.written?.find((w) => w.specifier === "dirname(__FILE__, 0) . '/partials/header.php'")?.candidates).toEqual([
      "htdocs/partials/header.php",
    ]);
  });
});
