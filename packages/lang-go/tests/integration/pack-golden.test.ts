/**
 * The Go pack, run over its fixture project, must reproduce its committed
 * golden. Update with `pnpm --filter @n-dx/lang-go test:update-goldens`; a
 * plain test run never writes.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-go
 * build:grammars`); a missing fixture fails.
 */

import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { checkGolden, fixtureDirFor, goldenPathFor, runPackOverFixture, skipUnlessGrammar, updateRequested } from "@n-dx/lang-runtime";
import { goGrammarPath, goPack } from "../../src/go-pack.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

describe("go pack golden", () => {
  it("has a fixture project", () => {
    const dir = fixtureDirFor(PACK_FIXTURE_ROOT, goPack);
    expect(existsSync(dir), `missing ${dir}`).toBe(true);
  });

  it("matches its golden", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const dir = fixtureDirFor(PACK_FIXTURE_ROOT, goPack);
    const actual = await runPackOverFixture({ pack: goPack, grammarPath: goGrammarPath() }, dir);
    expect(actual.files.length).toBeGreaterThan(0);
    expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);
  });
});
