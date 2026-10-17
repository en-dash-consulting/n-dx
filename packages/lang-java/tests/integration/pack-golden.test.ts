/**
 * The Java pack, run over its fixture project, must reproduce its committed
 * golden, and its Spring Boot facts theirs (`tests/fixtures/spring-boot`). Update with `pnpm --filter @n-dx/lang-java test:update-goldens`; a
 * plain test run never writes.
 *
 * Skips when the grammar is not built (`pnpm --filter @n-dx/lang-java
 * build:grammars`); a missing fixture fails.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig } from "@n-dx/lang-kit";
import {
  checkGolden,
  fixtureDirFor,
  goldenPathFor,
  listFixtureFiles,
  runPackOverFixture,
  skipUnlessGrammar,
  updateRequested,
  type RunnablePack,
} from "@n-dx/lang-runtime";
import { javaGrammarPath, javaPack } from "../../src/java-pack.js";
import { pack } from "../../src/pack.js";
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

/**
 * The Spring Boot routes and outbound calls of `tests/fixtures/spring-boot`,
 * through the pack entry, against `facts.json` beside it. The fixture covers
 * every route and outbound rule in `src/spring-boot.ts`.
 */
describe("spring boot facts golden", () => {
  const dir = join(PACK_FIXTURE_ROOT, "..", "spring-boot");
  const goldenPath = join(dir, "facts.json");

  it("matches its golden", async (ctx) => {
    skipUnlessGrammar(ctx, JAVA_WASM);
    const files = listFixtureFiles(dir, [".java"]);
    const result = await pack.analyzeProject({ projectDir: dir, files, kinds: ["routes", "outboundCalls"] });
    expect(result.degraded).toBeUndefined();
    expect(result.unparsed).toEqual([]);
    const text = `${JSON.stringify(
      {
        facts: result.facts.map(({ path, routes, outboundCalls }) => ({ path, routes, outboundCalls })),
        notices: result.notices ?? [],
      },
      null,
      2,
    )}\n`;
    if (updateRequested()) {
      writeFileSync(goldenPath, text);
      return;
    }
    expect(existsSync(goldenPath), `No golden at ${goldenPath}. Create it with the test:update-goldens script.`).toBe(true);
    expect(text, `The Spring facts differ from ${goldenPath}; if intended, review it and run test:update-goldens.`).toBe(
      readFileSync(goldenPath, "utf-8"),
    );
  });
});
