/**
 * The namespace resolver over a Composer fixture (`tests/fixtures/php-composer`):
 * PSR-4 with two paths and an autoload-dev prefix, PSR-0 with an
 * underscore-era prefix, a classmap with an excluded directory, a lock file
 * naming the package behind an external, and a file with two braced
 * namespaces; and `tests/fixtures/php-shared-root`, a project that shares its
 * root namespace with a library; and `tests/fixtures/php-composer-apps`, two
 * Composer apps mapping the same namespace beside a path repository; and
 * `tests/fixtures/php-composer-required`, packages required by name only. Runs the
 * pack entry; skips when the grammar
 * is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileFacts } from "@n-dx/lang-kit";
import { createTreeSitterRunner, listFixtureFiles, skipUnlessGrammar, type PackSourceFile } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack, preparePhpImports, readPhpResolveProjects } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-composer");
const sharedRoot = join(import.meta.dirname, "..", "fixtures", "php-shared-root");
const apps = join(import.meta.dirname, "..", "fixtures", "php-composer-apps");
const monorepo = join(import.meta.dirname, "..", "fixtures", "php-composer-monorepo");
const required = join(import.meta.dirname, "..", "fixtures", "php-composer-required");
const files = (): string[] => listFixtureFiles(dir, [...phpPack.config.extensions]);

async function facts(): Promise<Map<string, FileFacts>> {
  const result = await pack.analyzeProject({ projectDir: dir, files: files(), kinds: ["imports"] });
  expect(result.degraded).toBeUndefined();
  expect(result.notices).toBeUndefined();
  return new Map(result.facts.map((f) => [f.path, f]));
}

const edges = (f: FileFacts | undefined): string[] => (f?.imports?.files ?? []).map((r) => `${r.to} ${r.symbols.join(",")}`);

/** `form qualified outcome` for every reference of a file in the fixture at `root`. */
async function outcomesIn(root: string): Promise<(path: string) => string[]> {
  const paths = listFixtureFiles(root, [...phpPack.config.extensions]);
  const runner = createTreeSitterRunner();
  const parsed: PackSourceFile[] = [];
  try {
    for (const path of paths) {
      const result = await runner.parseFile({ pack: phpPack, grammarPath: phpGrammarPath() }, join(root, path));
      if (result.status === "parsed") parsed.push({ path, captures: result.captures });
    }
  } finally {
    runner.dispose();
  }
  const prepared = preparePhpImports(await readPhpResolveProjects(root, paths), parsed);
  return (path) =>
    prepared.outcomes(path).map(({ reference, outcome }) => {
      const detail = outcome.kind === "internal" ? outcome.via : outcome.kind === "unresolved" ? outcome.reason : outcome.kind;
      return `${reference.form} ${reference.qualified} ${detail}`;
    });
}

describe("php namespace resolver", () => {
  it("resolves use imports and class references through PSR-4, PSR-0, the classmap and declared names", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const order = (await facts()).get("src/Order.php");
    expect(edges(order)).toEqual([
      "classes/Helper.php Helper",
      "legacy/Legacy/Cart/Item.php Legacy_Cart_Item",
      "lib/Concerns/HasTotals.php Acme\\Shop\\Concerns\\HasTotals",
      "src/Base.php Acme\\Shop\\Base",
      "src/Contracts/Billable.php Acme\\Shop\\Contracts\\Billable",
      "src/Model/Item.php Acme\\Shop\\Model\\Item",
      "src/Money.php Acme\\Shop\\Money",
      "src/PaymentFailed.php Acme\\Shop\\PaymentFailed",
      "src/Receipt.php Acme\\Shop\\Receipt",
      "src/Support/functions.php Acme\\Shop\\Support\\CURRENCY,Acme\\Shop\\Support\\format_money",
    ]);
  });

  it("names externals per D5, with the lock package as module, and never PHP's own classes", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const all = await facts();
    expect(all.get("src/Order.php")?.imports?.external).toEqual([
      { package: "php:Monolog", symbols: ["Monolog\\Logger"], module: { path: "monolog/monolog", version: "0.0.0-fixture" } },
      { package: "php:Psr", symbols: ["Psr\\Log\\LoggerInterface"] },
      { package: "php:Zend", symbols: ["Zend_Db_Table"] },
    ]);
    expect(all.get("tests/OrderTest.php")?.imports?.external).toEqual([
      { package: "php:PHPUnit", symbols: ["PHPUnit\\Framework\\TestCase"] },
    ]);
    // \RuntimeException, \InvalidArgumentException, \Countable and \DateTime are PHP's own.
    expect(all.get("src/PaymentFailed.php")?.imports?.external).toEqual([]);
  });

  it("never makes an external of a scalar type in any letter case, self or static, or an extension's class", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const globals = (await facts()).get("globals.php");
    expect(globals?.imports?.external).toEqual([]);
    expect(globals?.imports?.files).toEqual([]);
  });

  it("resolves autoload-dev prefixes and keeps a missing project name internal", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect(edges((await facts()).get("tests/OrderTest.php"))).toEqual(["src/Order.php Acme\\Shop\\Order"]);
  });

  it("scopes use imports to their namespace block", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const regions = (await facts()).get("regions.php");
    expect(edges(regions)).toEqual(["src/Money.php Acme\\Shop\\Money"]);
    expect(regions?.imports?.external).toEqual([]);
  });

  it("says why a reference is not an edge", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const outcomes = await outcomesIn(dir);
    expect(outcomes("src/Order.php")).toEqual(
      expect.arrayContaining([
        "use Monolog\\Logger external",
        "extends Acme\\Shop\\Base psr-4",
        "trait Acme\\Shop\\Concerns\\HasTotals psr-4",
        "type Acme\\Shop\\Model\\Item psr-4",
        "type InvalidArgumentException builtin",
        "instanceof Countable builtin",
        "new Legacy_Cart_Item psr-0",
        "new Helper classmap",
        "new Dup ambiguous",
        "new Acme\\Shop\\Missing internal-not-found",
        "static DateTime builtin",
        "use function Acme\\Shop\\Support\\format_money declared",
        "use const Acme\\Shop\\Support\\CURRENCY declared",
      ]),
    );
    // `self` and `static` are the enclosing class, not references.
    expect(outcomes("src/Order.php").some((o) => / (self|static)$|\\(self|static) /i.test(o))).toBe(false);
    expect(outcomes("tests/OrderTest.php")).toContain("new Acme\\Shop\\Tests\\Fixtures\\Thing internal-not-found");
    expect(outcomes("regions.php")).toEqual(["use Acme\\Shop\\Money psr-4", "extends Acme\\Shop\\Money psr-4", "extends Acme\\Shop\\Two\\Cash internal-not-found"]);
  });

  it("counts a name as the project's only by its whole namespace or an autoload prefix", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    // php-shared-root declares Acme\Billing (no autoload prefix covers it), autoloads Acme\Tools\
    // and Zend_, and uses Acme\Shared from a library under the same root namespace.
    const outcomes = (await outcomesIn(sharedRoot))("src/Billing/Invoice.php");
    expect(outcomes).toEqual([
      "use Acme\\Shared\\Money external",
      "use Acme\\Tools\\Clock psr-4",
      "type Acme\\Shared\\Money external",
      "new Acme\\Billing\\Missing internal-not-found",
      "new Acme\\Tools\\Gone internal-not-found",
      "new Zend_Db psr-0",
      "new Zend_Gdata_YouTube internal-not-found",
      "new Acme\\Shared\\Money external",
      "static Acme\\Tools\\Clock psr-4",
    ]);
    const result = await pack.analyzeProject({
      projectDir: sharedRoot,
      files: listFixtureFiles(sharedRoot, [...phpPack.config.extensions]),
      kinds: ["imports"],
    });
    const invoice = result.facts.find((f) => f.path === "src/Billing/Invoice.php");
    expect(invoice?.imports?.external).toEqual([{ package: "php:Acme", symbols: ["Acme\\Shared\\Money"] }]);
  });

  it("resolves through the mappings of the project that owns the referring file and the path repositories it requires", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    // Apps a and b both map App\ to src/ and classmap classes/; b requires acme/shared from
    // the path repository ../packages/*; only a's lock names vendor/lib.
    const outcomes = await outcomesIn(apps);
    expect(outcomes("a/main.php")).toEqual([
      "new App\\Foo psr-4",
      "new Mapped classmap",
      "new Shared\\Util internal-not-found",
      "new Lib\\Thing external",
    ]);
    expect(outcomes("b/main.php")).toEqual([
      "new App\\Foo psr-4",
      "new App\\OnlyA internal-not-found",
      "new Mapped classmap",
      "new Shared\\Util psr-4",
      "new Lib\\Thing external",
    ]);
    // A file outside every project keeps every project's mappings, longest prefix first.
    expect(outcomes("loose/script.php")).toEqual(["new App\\Foo psr-4", "new Shared\\Util psr-4", "new Lib\\Thing external"]);

    const result = await pack.analyzeProject({ projectDir: apps, files: listFixtureFiles(apps, [...phpPack.config.extensions]), kinds: ["imports"] });
    const byPath = new Map(result.facts.map((f) => [f.path, f]));
    expect(edges(byPath.get("a/main.php"))).toEqual(["a/classes/Mapped.php Mapped", "a/src/Foo.php App\\Foo"]);
    expect(edges(byPath.get("b/main.php"))).toEqual([
      "b/classes/Mapped.php Mapped",
      "b/src/Foo.php App\\Foo",
      "packages/shared/src/Util.php Shared\\Util",
    ]);
    expect(edges(byPath.get("loose/script.php"))).toEqual(["a/src/Foo.php App\\Foo", "packages/shared/src/Util.php Shared\\Util"]);
    const lib = { package: "php:Lib", symbols: ["Lib\\Thing"], module: { path: "vendor/lib", version: "0.0.0-fixture" } };
    expect(byPath.get("a/main.php")?.imports?.external).toEqual([lib]);
    expect(byPath.get("b/main.php")?.imports?.external).toEqual([{ package: "php:Lib", symbols: ["Lib\\Thing"] }]);
    expect(byPath.get("loose/script.php")?.imports?.external).toEqual([lib]);
  });

  it("keeps a path package and a nested plugin in the loader of the project that loads or encloses them", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    // The root requires acme/x from its path repositories packages/*, and acme/x requires acme/y
    // from the same repositories; plugins/p has its own manifest inside the root project.
    const outcomes = await outcomesIn(monorepo);
    expect(outcomes("packages/x/src/A.php")).toEqual(["new Y\\B psr-4", "new Root\\Kernel psr-4", "new Lib\\Thing external"]);
    expect(outcomes("plugins/p/src/Ext.php")).toEqual(["new Root\\Kernel psr-4", "new Legacy declared"]);
    const result = await pack.analyzeProject({ projectDir: monorepo, files: listFixtureFiles(monorepo, [...phpPack.config.extensions]), kinds: ["imports"] });
    const a = result.facts.find((f) => f.path === "packages/x/src/A.php");
    expect(a?.imports?.external).toEqual([{ package: "php:Lib", symbols: ["Lib\\Thing"], module: { path: "vendor/lib", version: "0.0.0-fixture" } }]);
  });

  it("keeps in-repository packages a project requires by name in its scope, transitively", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    // Drupal 7's shape: typo3/phar-stream-wrapper requires brumann/polyfill-unserialize by name
    // (in another letter case) with no repositories entry, and that requires acme/c; other/app
    // maps Brumann\Polyfill\ too but requires nothing.
    const outcomes = await outcomesIn(required);
    expect(outcomes("misc/typo3/phar-stream-wrapper/src/Manifest.php")).toEqual([
      "use Brumann\\Polyfill\\Unserialize psr-4",
      "use Acme\\C\\Thing psr-4",
      "new Acme\\C\\Thing psr-4",
      "static Brumann\\Polyfill\\Unserialize psr-4",
    ]);
    expect(outcomes("other/main.php")).toEqual(["new Brumann\\Polyfill\\Unserialize psr-4", "new Acme\\C\\Thing internal-not-found"]);

    const result = await pack.analyzeProject({ projectDir: required, files: listFixtureFiles(required, [...phpPack.config.extensions]), kinds: ["imports"] });
    const byPath = new Map(result.facts.map((f) => [f.path, f]));
    expect(edges(byPath.get("misc/typo3/phar-stream-wrapper/src/Manifest.php"))).toEqual([
      "misc/acme/c/src/Thing.php Acme\\C\\Thing",
      "misc/brumann/polyfill-unserialize/src/Unserialize.php Brumann\\Polyfill\\Unserialize",
    ]);
    expect(edges(byPath.get("other/main.php"))).toEqual(["other/src/Unserialize.php Brumann\\Polyfill\\Unserialize"]);
  });
});
