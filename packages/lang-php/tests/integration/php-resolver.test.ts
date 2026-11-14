/**
 * The namespace resolver over a Composer fixture (`tests/fixtures/php-composer`):
 * PSR-4 with two paths and an autoload-dev prefix, PSR-0 with an
 * underscore-era prefix, a classmap with an excluded directory, a lock file
 * naming the package behind an external, and a file with two braced
 * namespaces; and `tests/fixtures/php-shared-root`, a project that shares its
 * root namespace with a library. Runs the pack entry; skips when the grammar
 * is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FileFacts } from "@n-dx/lang-kit";
import { createTreeSitterRunner, listFixtureFiles, skipUnlessGrammar, type PackSourceFile } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack, preparePhpImports, readPhpResolveProjects } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-composer");
const sharedRoot = join(import.meta.dirname, "..", "fixtures", "php-shared-root");
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
});
