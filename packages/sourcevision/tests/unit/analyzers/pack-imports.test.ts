/**
 * Pack selection and the missing-grammar path of the pack import graph. The
 * parse-and-resolve path needs a built grammar and is covered by
 * tests/integration/java-zones.test.ts.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPackImportGraph, isPackFile, packsFor } from "../../../src/analyzers/pack-imports.js";
import { javaPack } from "../../../src/language/java-pack.js";
import { grammarBuildDir } from "../../../src/language/package-paths.js";
import type { Inventory } from "../../../src/schema/v1.js";

const file = (path: string): Inventory["files"][number] =>
  ({ path, size: 1, language: "Java", lineCount: 1, hash: "x", role: "source", category: "code" }) as Inventory["files"][number];

describe("packsFor", () => {
  it("selects a pack only when the imports phase parses its extension", () => {
    expect(packsFor(new Set([".ts", ".java"]))).toEqual([javaPack]);
    expect(packsFor(new Set([".ts", ".go"]))).toEqual([]);
  });
});

describe("isPackFile", () => {
  it("matches a pack's extensions case-insensitively", () => {
    expect(isPackFile("src/A.java", [javaPack])).toBe(true);
    expect(isPackFile("src/A.JAVA", [javaPack])).toBe(true);
    expect(isPackFile("src/a.ts", [javaPack])).toBe(false);
    expect(isPackFile("src/A.java", [])).toBe(false);
  });
});

describe("buildPackImportGraph", () => {
  let emptyGrammarDir: string;

  beforeAll(() => {
    emptyGrammarDir = mkdtempSync(join(tmpdir(), "sv-pack-imports-"));
  });
  afterAll(() => rmSync(emptyGrammarDir, { recursive: true, force: true }));

  it("loads no pack, and reports nothing, when no file belongs to one", async () => {
    const messages: string[] = [];
    const graph = await buildPackImportGraph([file("src/a.ts")], emptyGrammarDir, {
      grammarDir: emptyGrammarDir,
      warn: (m) => messages.push(m),
    });
    expect(graph).toEqual({ edges: [], external: [] });
    expect(messages).toEqual([]);
  });

  it("reports a missing grammar once, however many files, and produces no edges", async () => {
    const messages: string[] = [];
    const graph = await buildPackImportGraph([file("src/A.java"), file("src/B.java")], emptyGrammarDir, {
      grammarDir: emptyGrammarDir,
      warn: (m) => messages.push(m),
    });
    expect(graph).toEqual({ edges: [], external: [] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Java files get inventory only");
  });

  it("reports an unloadable grammar once, names its path, and produces no edges", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sv-pack-imports-bad-"));
    try {
      const grammarPath = join(dir, `${javaPack.grammar.name}.wasm`);
      writeFileSync(grammarPath, "not a wasm module");
      const messages: string[] = [];
      const graph = await buildPackImportGraph([file("src/A.java"), file("src/B.java")], dir, {
        grammarDir: dir,
        warn: (m) => messages.push(m),
      });
      expect(graph).toEqual({ edges: [], external: [] });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(grammarPath);
      expect(messages[0]).toContain("could not be loaded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!existsSync(join(grammarBuildDir(), `${javaPack.grammar.name}.wasm`)))(
    "degrades a pack whose query the loaded grammar rejects, with one notice naming the pack and the error",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "sv-pack-imports-query-"));
      try {
        const queryPath = join(dir, "bad.scm");
        writeFileSync(queryPath, "(no_such_node_type) @x");
        const pack = { ...javaPack, queries: [{ name: "bad", path: queryPath }] };
        const messages: string[] = [];
        const graph = await buildPackImportGraph([file("src/A.java"), file("src/B.java")], dir, {
          packs: [pack],
          warn: (m) => messages.push(m),
        });
        expect(graph).toEqual({ edges: [], external: [] });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("Java");
        expect(messages[0]).toContain("no_such_node_type");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});
