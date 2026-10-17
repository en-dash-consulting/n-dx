/**
 * Every built-in language pack, run over its fixture project, must reproduce
 * its committed golden. Update with `pnpm --filter @n-dx/sourcevision
 * test:update-goldens`; a plain test run never writes.
 *
 * A pack whose grammar is not built skips (see tree-sitter-java-grammar.test.ts);
 * a pack with no fixture fails.
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { goConfig } from "../../src/language/go.js";
import { loadLanguagePacks } from "../../src/language/pack.js";
import type { RunnablePack } from "../../src/language/runner.js";
import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  runPackOverFixture,
  updateRequested,
} from "../helpers/pack-golden.js";

const statuses = loadLanguagePacks({ warn: () => undefined });

const JAVA_WASM = grammarWasmPath("tree-sitter-java");

describe("harness over a stand-in pack", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-pack-fixture-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.skipIf(!existsSync(JAVA_WASM))("round-trips: update writes, check matches, a source edit fails", async () => {
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "A.java"), "class A { void run() {} }\n");
    writeFileSync(join(dir, "methods.scm"), "(method_declaration name: (identifier) @method.name)");
    const target: RunnablePack = {
      grammarPath: JAVA_WASM,
      pack: {
        id: "java-stand-in",
        config: { ...goConfig, extensions: [".java"] },
        grammar: { name: "tree-sitter-java", version: "0.23.5" },
        queries: [{ name: "methods", path: join(dir, "methods.scm") }],
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

describe("language pack goldens", () => {
  it.skipIf(statuses.length > 0)("has no built-in packs registered yet", () => {
    expect(statuses).toEqual([]);
  });

  for (const status of statuses) {
    const { pack } = status;
    describe(pack.id, () => {
      it("has a fixture project", () => {
        expect(existsSync(fixtureDirFor(pack)), `missing ${fixtureDirFor(pack)}`).toBe(true);
      });

      it.skipIf(!status.grammarAvailable)("matches its golden", async () => {
        const dir = fixtureDirFor(pack);
        const actual = await runPackOverFixture(status, dir);
        expect(actual.files.length).toBeGreaterThan(0);
        expect(checkGolden(actual, goldenPathFor(dir), updateRequested())).toMatch(/matched|updated/);
      });
    });
  }
});
