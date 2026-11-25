/**
 * Declarations (`src/php-declarations.ts`) through the pack entry, over
 * `php-declarations`: a namespaced file declaring two classes, an interface
 * and a trait; braced namespaces beside a global block; a class declared in
 * an `if` beside an anonymous class; a file of functions alone. Skips when
 * the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listFixtureFiles, skipUnlessGrammar } from "@n-dx/lang-runtime";
import type { DeclarationsFact, FactKind } from "@n-dx/lang-kit";
import { pack, phpGrammarPath, phpPack } from "../../src/index.js";

const dir = join(import.meta.dirname, "..", "fixtures", "php-declarations");

async function declarations(kinds: readonly FactKind[] = ["declarations"]): Promise<Map<string, DeclarationsFact | undefined>> {
  const result = await pack.analyzeProject({ projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds });
  expect(result.degraded).toBeUndefined();
  expect(result.unparsed).toEqual([]);
  return new Map(result.facts.map((f) => [f.path, f.declarations]));
}

/** `kind qualifiedName line`, the name checked against the qualified one's last segment. */
const brief = (fact: DeclarationsFact | undefined): string[] =>
  (fact?.types ?? []).map((t) => {
    expect(t.qualifiedName.split("\\").at(-1)).toBe(t.name);
    return `${t.kind} ${t.qualifiedName} ${t.position.line}`;
  });

describe("php declarations", () => {
  it("lists a namespaced file's classes, interface and trait, fully qualified, with their lines", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const billing = (await declarations()).get("src/Billing.php");
    expect(billing?.namespaces).toEqual(["Acme\\Billing"]);
    expect(brief(billing)).toEqual([
      "interface Acme\\Billing\\Payable 4",
      "trait Acme\\Billing\\Discounts 9",
      "class Acme\\Billing\\Invoice 14",
      "class Acme\\Billing\\CreditNote 21",
    ]);
  });

  it("qualifies a type by the braced namespace around it, and a global block's types by nothing", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const blocks = (await declarations()).get("src/blocks.php");
    expect(blocks?.namespaces).toEqual(["Acme\\Shop"]);
    expect(brief(blocks)).toEqual(["enum Acme\\Shop\\Status 3", "class GlobalThing 10"]);
  });

  it("lists a class declared in an if block, not an anonymous class, and no namespace", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    const compat = (await declarations()).get("legacy/compat.php");
    expect(compat?.namespaces).toEqual([]);
    expect(brief(compat)).toEqual(["class Json_Encoder 3"]);
  });

  it("gives a file without a namespace or a type no declarations, and none at all unless asked", async (ctx) => {
    skipUnlessGrammar(ctx, phpGrammarPath());
    expect((await declarations()).get("legacy/functions.php")).toBeUndefined();
    expect([...(await declarations(["imports"])).values()].every((d) => d === undefined)).toBe(true);
  });
});
