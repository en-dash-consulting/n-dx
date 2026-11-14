/**
 * Un-namespaced classes in a PHP 5 site without Composer
 * (`tests/fixtures/php-legacy-autoload`): a PEAR-style library under `lib/`
 * on the include path, `__autoload` with a `.class.php` suffix, an
 * `spl_autoload_register` closure, an instance-method autoloader, autoloaders
 * that cannot be followed, copies of every loaded class in `old/`, a class
 * declared twice with no pattern to pick one, and one declared once. Runs the
 * pack; skips when the grammar is not built.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTreeSitterRunner, listFixtureFiles, skipUnlessGrammar, type PackSourceFile } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack, preparePhpImports, readPhpProjectFacts, type PreparedPhpResolver } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-legacy-autoload");
const files = (): string[] => listFixtureFiles(dir, [...phpPack.config.extensions]);

async function prepare(unparsedPaths: readonly string[] = []): Promise<PreparedPhpResolver> {
  const paths = files();
  const runner = createTreeSitterRunner();
  const parsed: PackSourceFile[] = [];
  try {
    for (const path of paths) {
      if (unparsedPaths.includes(path)) continue;
      const result = await runner.parseFile({ pack: phpPack, grammarPath: phpGrammarPath() }, join(dir, path));
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
    }
  } finally {
    runner.dispose();
  }
  const facts = await readPhpProjectFacts(dir, paths);
  return preparePhpImports(facts.projects, parsed, unparsedPaths, facts);
}

/** `form qualified outcome` for each class reference of `path`. */
const outcomes = (prepared: PreparedPhpResolver, path: string): string[] =>
  prepared.outcomes(path).map(({ reference, outcome }) => {
    const detail = outcome.kind === "internal" ? `${outcome.target} (${outcome.via})` : outcome.kind === "unresolved" ? outcome.reason : outcome.kind;
    return `${reference.form} ${reference.qualified} ${detail}`;
  });

describe("php legacy class resolution", () => {
  it("applies autoloader patterns and the PSR-0 path, and leaves an unpicked duplicate unresolved", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const prepared = await prepare();
    expect(outcomes(prepared, "htdocs/index.php")).toEqual([
      // Declared in lib/ and old/: lib/ is on the include path set in this file.
      "new Pear_Mail_Mime lib/Pear/Mail/Mime.php (psr-0-path)",
      // Declared in classes/ and old/: __autoload's '.class.php' pattern picks one.
      "new User classes/User.class.php (autoloader)",
      // The closure: 'app/' . str_replace('_', DIRECTORY_SEPARATOR, $name), then .= '.php'.
      "static Shop_Order app/Shop/Order.php (autoloader)",
      // array($this, 'autoload'): ltrim() and strtolower() of the class name.
      "new Widget plugins/widget.php (autoloader)",
      // Two declarations and no pattern: never guessed.
      "new Report ambiguous",
      "new Unique misc/Unique.php (declared)",
    ]);
    // The PEAR library refers to its own classes by the same convention.
    expect(outcomes(prepared, "lib/Pear/Mail/Mime.php")).toEqual(["extends Pear_Mail lib/Pear/Mail.php (psr-0-path)"]);
  });

  it("makes each resolved class an edge and reports the autoloaders it cannot follow", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const result = await pack.analyzeProject({ projectDir: dir, files: files(), kinds: ["imports"] });
    const index = result.facts.find((f) => f.path === "htdocs/index.php");
    expect((index?.imports?.files ?? []).map((r) => `${r.to} ${r.symbols.join(",")}`)).toEqual([
      "app/Shop/Order.php Shop_Order",
      "bootstrap.php *",
      "classes/User.class.php User",
      "lib/Pear/Mail/Mime.php Pear_Mail_Mime",
      "misc/Unique.php Unique",
      "plugins/widget.php Widget",
    ]);
    expect(result.notices).toEqual([
      "PHP: bootstrap.php:15: autoloader array('Loader', 'load') does not build its path from literals and the class name; not followed.",
      "PHP: bootstrap.php:16: spl_autoload_register($loader) is not a closure or a function or method named in the repository; not followed.",
      "PHP: bootstrap.php:17: spl_autoload_register('missing_loader') names nothing the repository declares; not followed.",
      "PHP: bootstrap.php:18: spl_autoload_register() registers PHP's default spl_autoload; not followed.",
    ]);
  });

  it("follows a path variable reassigned from itself many times in linear time", { timeout: 10_000 }, async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const root = await mkdtemp(join(tmpdir(), "php-autoload-chain-"));
    try {
      // 40 reassignments: evaluating each from scratch is 2^40 steps.
      const chain = Array.from({ length: 40 }, () => "    $path = $path . '';").join("\n");
      await mkdir(join(root, "lib"));
      await writeFile(
        join(root, "boot.php"),
        `<?php\nspl_autoload_register(function ($class) {\n    $path = __DIR__ . '/lib/';\n${chain}\n    require $path . $class . '.php';\n});\nnew Chained();\n`,
      );
      await writeFile(join(root, "lib", "Chained.php"), "<?php\nclass Chained {}\n");
      const result = await pack.analyzeProject({ projectDir: root, files: ["boot.php", "lib/Chained.php"], kinds: ["imports"] });
      const boot = result.facts.find((f) => f.path === "boot.php");
      expect(boot?.imports?.files).toEqual([{ to: "lib/Chained.php", symbols: ["Chained"] }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("takes a pattern's file that failed to parse only when no file declares the class", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const prepared = await prepare(["lib/Pear/Mail.php", "plugins/widget.php"]);
    // No parsed file declares Pear_Mail: its PSR-0 path is taken.
    expect(outcomes(prepared, "lib/Pear/Mail/Mime.php")).toEqual(["extends Pear_Mail lib/Pear/Mail.php (psr-0-path)"]);
    // Widget is still declared in old/copies.php, so the unparsed plugins/widget.php is not.
    expect(outcomes(prepared, "htdocs/index.php")).toContain("new Widget old/copies.php (declared)");
  });
});
