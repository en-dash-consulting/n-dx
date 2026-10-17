/**
 * The pack entry's optional readers — project notices, a project facts reader
 * and the symbol rules' `refine` — over the FastAPI fixture: one that throws
 * loses only its own output, as a notice, and never the language's imports.
 */

import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FactKind, FileFacts } from "@n-dx/lang-kit";
import { createPackEntry, listFixtureFiles, skipUnlessGrammar, type TreeSitterEntryOptions } from "@n-dx/lang-runtime";

import { PYTHON_PACKAGE } from "../../src/package-paths.js";
import { pythonProjectNotices } from "../../src/python-notices.js";
import { pythonGrammarPath, pythonPack } from "../../src/python-pack.js";
import { PYTHON_SYMBOL_RULES } from "../../src/python-symbols.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

type Ctx = Parameters<typeof skipUnlessGrammar>[0];

const dir = join(PACK_FIXTURE_ROOT, "..", "fastapi");
const files = listFixtureFiles(dir, [".py"]);
const kinds: readonly FactKind[] = ["imports", "symbols", "routes"];
const base: TreeSitterEntryOptions = {
  package: PYTHON_PACKAGE,
  pack: pythonPack,
  symbolRules: PYTHON_SYMBOL_RULES,
  projectNotices: pythonProjectNotices,
};

async function analyze(ctx: Ctx, options: Partial<TreeSitterEntryOptions> = {}, wanted: readonly FactKind[] = kinds) {
  skipUnlessGrammar(ctx, pythonGrammarPath());
  return createPackEntry({ ...base, ...options }).analyzeProject({ projectDir: dir, files, kinds: wanted });
}

const importCount = (facts: readonly FileFacts[]): number =>
  facts.reduce((n, f) => n + (f.imports?.files.length ?? 0) + (f.imports?.external.length ?? 0), 0);

/** `actual` is `expected` with `failure` added once. */
function expectNoticesBut(actual: readonly string[] | undefined, expected: readonly string[] | undefined, failure: string): void {
  expect(actual).toContain(failure);
  expect(actual?.filter((n) => n !== failure)).toEqual(expected ?? []);
}

const boom = (): never => {
  throw new Error("boom");
};

describe("an optional reader that throws", () => {
  it("project notices: keeps every fact, reports the failure and is not degraded", async (ctx) => {
    const expected = await analyze(ctx, { projectNotices: undefined });
    const result = await analyze(ctx, { projectNotices: boom });
    expect(result.degraded).toBeUndefined();
    expect(importCount(result.facts)).toBeGreaterThan(0);
    expect(result.facts).toEqual(expected.facts);
    expectNoticesBut(result.notices, expected.notices, "the project notices reader failed (boom); what the pack read but skipped is not reported.");
  });

  it("project facts: records none of its kinds, keeps imports and the rest, and is not degraded", async (ctx) => {
    const pack = { ...pythonPack, produces: [...pythonPack.produces, "resources" as const] };
    const expected = await analyze(ctx);
    const result = await analyze(ctx, { pack, projectFacts: boom }, [...kinds, "resources"]);
    expect(result.degraded).toBeUndefined();
    expect(importCount(result.facts)).toBeGreaterThan(0);
    expect(result.facts.every((f) => f.resources === undefined)).toBe(true);
    expect(result.facts).toEqual(expected.facts);
    expectNoticesBut(result.notices, expected.notices, "the project facts reader failed (boom); its resources were not recorded.");
  });

  it("symbol refine on one file: that file keeps its rule-read symbols and imports, others are refined", async (ctx) => {
    const failing = "app/api/routes/items.py";
    const refine = PYTHON_SYMBOL_RULES.refine!;
    const symbolRules = {
      ...PYTHON_SYMBOL_RULES,
      refine: (...args: Parameters<typeof refine>) => (args[1].path === failing ? boom() : refine(...args)),
    };
    const expected = await analyze(ctx);
    const unrefined = await analyze(ctx, { symbolRules: { ...PYTHON_SYMBOL_RULES, refine: undefined } });
    const result = await analyze(ctx, { symbolRules });
    const of = (facts: readonly FileFacts[]) => facts.find((f) => f.path === failing)!;

    expect(result.degraded).toBeUndefined();
    expect(of(expected.facts).symbols).not.toEqual(of(unrefined.facts).symbols);
    expect(of(result.facts)).toEqual({ ...of(expected.facts), symbols: of(unrefined.facts).symbols });
    expect(result.facts.filter((f) => f.path !== failing)).toEqual(expected.facts.filter((f) => f.path !== failing));
    expectNoticesBut(
      result.notices,
      expected.notices,
      `symbol refinement failed on 1 file: ${failing} (boom); their symbols are the rules' reading alone.`,
    );
  });

  it("symbol refine on many files: names the first three and counts the rest", async (ctx) => {
    const result = await analyze(ctx, { symbolRules: { ...PYTHON_SYMBOL_RULES, refine: boom } });
    expect(result.degraded).toBeUndefined();
    expect(importCount(result.facts)).toBeGreaterThan(0);
    const notice = result.notices?.find((n) => n.startsWith("symbol refinement failed"));
    expect(files.length).toBeGreaterThan(3);
    expect(notice).toMatch(new RegExp(`^symbol refinement failed on ${files.length} files: .*\\(boom\\), .*\\(boom\\), .*\\(boom\\) and ${files.length - 3} more;`));
  });
});
