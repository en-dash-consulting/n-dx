/**
 * The config, outbound and legacy frameworks digest each file as it is
 * parsed (`FrameworkPack.digest`), as dynamic code does, so their captures
 * are released file by file instead of held until the frameworks read. The
 * digest changes when facts are computed, never what they are: each
 * framework's facts and notices on its fixtures equal those of the same
 * framework reading undigested captures. Skips when the grammar is not built.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactKind } from "@n-dx/lang-kit";
import { createPackEntry, listFixtureFiles, skipUnlessGrammar, type FrameworkPack } from "@n-dx/lang-runtime";
import { PHP_PACKAGE, PHP_SYMBOL_RULES, phpGrammarPath, phpLegacy, phpOutbound, phpPack } from "../../src/index.js";
import { phpConfigFlags } from "../../src/php-config.js";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");

/** The PHP pack entry with `replace` applied to each framework. */
const entryWith = (replace: (framework: FrameworkPack) => FrameworkPack) =>
  createPackEntry({
    package: PHP_PACKAGE,
    pack: { ...phpPack, frameworks: phpPack.frameworks!.map(replace) },
    symbolRules: PHP_SYMBOL_RULES,
  });

const CASES: ReadonlyArray<{ readonly framework: FrameworkPack; readonly query: string; readonly kinds: readonly FactKind[]; readonly fixtures: readonly string[] }> = [
  { framework: phpConfigFlags, query: "config", kinds: ["configReads", "flagChecks"], fixtures: ["php-config"] },
  { framework: phpOutbound, query: "outbound", kinds: ["outboundCalls"], fixtures: ["php-outbound", "php-outbound-rebuilt"] },
  { framework: phpLegacy, query: "legacy", kinds: ["legacyConstructs"], fixtures: ["php-legacy", "php-legacy-polyfill"] },
];

describe("php framework digests", () => {
  for (const { framework, query, kinds, fixtures } of CASES) {
    describe(framework.id, () => {
      it("reads digests: files reach the framework without its own captures, the language's kept", async (ctx) => {
        skipUnlessGrammar(ctx, phpGrammarPath());
        const dir = join(FIXTURES, fixtures[0]!);
        const files = listFixtureFiles(dir, [...phpPack.config.extensions]);
        const seen: { captures: string[]; digests: string[] }[] = [];
        const spy: FrameworkPack = {
          ...framework,
          read: (parsed, wanted, context, digests) => {
            seen.push({ captures: parsed.flatMap((f) => Object.keys(f.captures)), digests: [...(digests?.keys() ?? [])] });
            return framework.read(parsed, wanted, context, digests);
          },
        };
        await entryWith((f) => (f === framework ? spy : f)).analyzeProject({ projectDir: dir, files, kinds: ["imports", ...kinds] });
        expect(seen).toHaveLength(1);
        expect(seen[0]!.captures).not.toContain(query);
        expect(seen[0]!.captures).toContain("imports");
        expect(seen[0]!.digests.sort()).toEqual([...files].sort());
      });

      for (const fixture of fixtures) {
        it(`gives the same facts and notices on ${fixture} as reading undigested captures`, async (ctx) => {
          skipUnlessGrammar(ctx, phpGrammarPath());
          const dir = join(FIXTURES, fixture);
          const request = { projectDir: dir, files: listFixtureFiles(dir, [...phpPack.config.extensions]), kinds: ["imports", ...kinds] };
          const { digest: _, ...undigested } = framework;
          const digested = await entryWith((f) => f).analyzeProject(request);
          const whole = await entryWith((f) => (f === framework ? undigested : f)).analyzeProject(request);
          const facts = (result: typeof digested) => result.facts.map((f) => [f.path, ...kinds.map((k) => f[k as keyof typeof f])]);
          // php-legacy-polyfill's legacy calls all reach functions the repository declares: none, settled only at read.
          if (fixture === fixtures[0]) expect(facts(digested).some(([, ...found]) => found.some((v) => v !== undefined))).toBe(true);
          expect(facts(digested)).toEqual(facts(whole));
          expect(digested.notices).toEqual(whole.notices);
        });
      }
    });
  }
});
