/**
 * The Python pack, run over its fixture project, must reproduce its committed
 * goldens: the query captures with the resolver's written imports
 * (`golden.json`) and the pack entry's facts and notices (`facts.json`).
 * Update both with `pnpm --filter @n-dx/lang-python test:update-goldens`; a
 * plain test run never writes.
 *
 * The fixture covers every import form (`import a.b`, `as`, several per
 * statement, `from` with names, aliases, parentheses across lines, relative
 * `.` and `..pkg`, wildcard), `from __future__` (skipped), imports inside
 * functions, methods and conditionals, `TYPE_CHECKING` and
 * `typing.TYPE_CHECKING` blocks, `try` bodies whose handler catches
 * ImportError or ModuleNotFoundError (and one that catches neither),
 * `__all__` as a literal list and tuple and as values that are not literal,
 * decorators on classes, functions and methods, async functions and methods,
 * module-level names, a `.pyi` stub, and both dynamic imports.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-python
 * build:grammars`); a missing fixture fails.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  listFixtureFiles,
  runPackOverFixture,
  skipUnlessGrammar,
  updateRequested,
} from "@n-dx/lang-runtime";
import { pack, pythonGrammarPath, pythonPack } from "../../src/index.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const dir = fixtureDirFor(PACK_FIXTURE_ROOT, pythonPack);

describe("python pack golden", () => {
  it("has a fixture project", () => {
    expect(existsSync(dir), `missing ${dir}`).toBe(true);
  });

  it("matches its goldens", async (ctx) => {
    skipUnlessGrammar(ctx, pythonGrammarPath());
    const actual = await runPackOverFixture({ pack: pythonPack, grammarPath: pythonGrammarPath() }, dir);
    expect(actual.files.length).toBeGreaterThan(0);
    expect(actual.files.every((f) => f.status === "parsed" && !f.hasErrorNodes && !f.hasMissingNodes)).toBe(true);
    expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);

    const files = listFixtureFiles(dir, [...pythonPack.config.extensions]);
    const result = await pack.analyzeProject({ projectDir: dir, files });
    expect(result.degraded).toBeUndefined();
    const text = `${JSON.stringify(result, null, 2)}\n`;
    const factsPath = join(dir, "facts.json");
    if (updateRequested()) {
      writeFileSync(factsPath, text);
      return;
    }
    expect(existsSync(factsPath), `No golden at ${factsPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The facts differ from ${factsPath}; if intended, review them and run test:update-goldens.`).toBe(
      readFileSync(factsPath, "utf-8"),
    );
  });
});
