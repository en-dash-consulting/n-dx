/**
 * The Java pack, run over its fixture project, must reproduce its committed
 * golden. Update with `pnpm --filter @n-dx/lang-java test:update-goldens`; a
 * plain test run never writes.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-java
 * build:grammars`); a missing fixture fails.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig } from "@n-dx/lang-kit";
import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  runPackOverFixture,
  skipUnlessGrammar,
  updateRequested,
  type RunnablePack,
} from "@n-dx/lang-runtime";
import { javaGrammarPath, javaPack } from "../../src/java-pack.js";
import { PACK_FIXTURE_ROOT } from "../helpers/pack-fixtures.js";

const JAVA_WASM = javaGrammarPath();

describe("harness over a stand-in pack", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pack-fixture-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips: update writes, check matches, a source edit fails", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "A.java"), "class A { void run() {} }\n");
    writeFileSync(join(dir, "methods.scm"), "(method_declaration name: (identifier) @method.name)");
    const target: RunnablePack = {
      grammarPath: JAVA_WASM,
      pack: {
        id: "java-stand-in",
        config: { ...goConfig, extensions: new Set([".java"]) },
        grammar: { name: "tree-sitter-java", version: "0.23.5" },
        queries: [{ name: "methods", path: join(dir, "methods.scm") }],
        produces: [],
        provenance: {},
      },
    };
    const goldenPath = goldenPathFor(dir);

    const first = await runPackOverFixture(target, dir);
    expect(first.files.map((f) => f.path)).toEqual(["src/A.java"]);
    expect(checkGolden(first, goldenPath, true)).toBe("updated");
    expect(checkGolden(await runPackOverFixture(target, dir), goldenPath, false)).toBe("matched");

    writeFileSync(join(dir, "src", "A.java"), "class A { void walk() {} }\n");
    const edited = await runPackOverFixture(target, dir);
    expect(() => checkGolden(edited, goldenPath, false)).toThrow(/differs/);
  });
});

describe("java pack golden", () => {
  it("has a fixture project", () => {
    const dir = fixtureDirFor(PACK_FIXTURE_ROOT, javaPack);
    expect(existsSync(dir), `missing ${dir}`).toBe(true);
  });

  it("matches its golden", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const dir = fixtureDirFor(PACK_FIXTURE_ROOT, javaPack);
    const actual = await runPackOverFixture({ pack: javaPack, grammarPath: JAVA_WASM }, dir);
    expect(actual.files.length).toBeGreaterThan(0);
    expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);
  });
});
