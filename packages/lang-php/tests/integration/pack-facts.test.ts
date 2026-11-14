/**
 * What the goldens hold, stated as rules: which includes are conditional,
 * that no import becomes an edge, which methods are constructors, and that
 * `new` is a call. Runs the pack entry over the golden fixture; skips when the
 * grammar is not built.
 */

import { describe, expect, it } from "vitest";
import type { FileFacts } from "@n-dx/lang-kit";
import { fixtureDirFor, listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const dir = fixtureDirFor(PACK_FIXTURE_ROOT, phpPack);

async function facts(): Promise<Map<string, FileFacts>> {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]) });
  return new Map(result.facts.map((f) => [f.path, f]));
}

describe("php pack facts", () => {
  it("guards includes in branches, loops, function bodies and short-circuit operands, and no others", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const index = (await facts()).get("php52/index.php")!;
    const includes = index.imports!.written!.map((w) => `${w.guard === "conditional" ? "?" : "!"} ${w.specifier}`);
    expect(includes).toEqual([
      "! dirname(__FILE__) . '/lib/Shop/Cart.php'",
      '! dirname(__FILE__) . "/config.inc.php"',
      "! 'header.php'",
      "! 'optional.php'",
      "? SHOP_ROOT . '/local.php'",
      "? 'fallback.php'",
      "? 'defaults.php'",
      "? 'compat/json.php'",
      "! 'settings.php'",
      // `require 'boot.php' or die(…)` requires the value of `'boot.php' or die(…)`: the include is the whole expression.
      "! 'boot.php' or die('boot failed')",
      "? 'pages/' . $page . '.php'",
      "? $plugin",
      "? 'partials/user.php'",
      "? 'partials/login.php'",
    ]);
  });

  it("produces no import edges", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    for (const file of (await facts()).values()) {
      expect([file.path, file.imports?.files, file.imports?.external]).toEqual([file.path, [], []]);
    }
  });

  it("finds __construct and PHP 4 constructors, but not a same-named method in a namespace or beside __construct", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const all = [...(await facts()).values()];
    const constructors = all.flatMap((f) =>
      (f.symbols ?? []).filter((s) => s.kind === "constructor").map((s) => `${f.path} ${s.container ?? "-"}::${s.name}`),
    );
    expect(constructors).toEqual([
      "php52/lib/Shop/Cart.php Shop_Cart::Shop_Cart",
      "php52/lib/Shop/Cart.php Shop_Order::__construct",
      "php53/src/Shop/Order.php Order::__construct",
      "php53/src/Shop/braced.php GlobalCart::GlobalCart",
      "php8/src/Orders/OrderService.php Audited::__construct",
      "php8/src/Orders/OrderService.php OrderService::__construct",
      "php8/src/Orders/OrderService.php -::__construct",
    ]);
  });

  it("reports `new` as a call, with or without an argument list", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const index = (await facts()).get("php52/index.php")!;
    expect(index.calls).toContainEqual({ callee: "Shop_Cart", construct: true, strings: [] });
  });
});
