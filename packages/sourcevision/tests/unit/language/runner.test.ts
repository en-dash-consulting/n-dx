/**
 * The tree-sitter runner, against the Java grammar built by
 * scripts/build-grammars.mjs. Tests that need the grammar skip (with the
 * command to run) when it has not been built; size limits do not need it.
 */

import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Language, Parser, Query, Tree } from "web-tree-sitter";

import { createTreeSitterRunner, type RunnablePack, type TreeSitterRunner } from "../../../src/language/runner.js";
import type { LanguagePack } from "../../../src/language/pack.js";
import { goConfig } from "../../../src/language/go.js";
import { grammarWasmPath } from "../../../scripts/build-grammars.mjs";

const JAVA_WASM = grammarWasmPath("tree-sitter-java");
const NOT_BUILT =
  "tree-sitter-java.wasm is not built — run `node packages/sourcevision/scripts/build-grammars.mjs`";

// Spied before any runner call so the process-wide counts start at zero.
const initSpy = vi.spyOn(Parser, "init");
const loadSpy = vi.spyOn(Language, "load");

const STRUCTURE_SCM = `
(class_declaration name: (identifier) @class.name) @class
(method_declaration name: (identifier) @method.name)
`;
const IMPORTS_SCM = `(import_declaration (scoped_identifier) @import)`;

const SOURCE = `package com.example;

import java.util.List;

public class OrderService {
  public List<Order> open() {
    return null;
  }
}
`;

let dir: string;
let target: RunnablePack;

function makePack(queries: { name: string; scm: string }[]): LanguagePack {
  return {
    // A stand-in config: the runner reads only the grammar and queries.
    id: "java-test",
    config: goConfig,
    grammar: { name: "tree-sitter-java", version: "0.23.5" },
    queries: queries.map(({ name, scm }) => {
      const path = join(dir, `${name}.scm`);
      writeFileSync(path, scm);
      return { name, path };
    }),
    provenance: {},
  };
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "sv-runner-"));
  target = {
    grammarPath: JAVA_WASM,
    pack: makePack([
      { name: "structure", scm: STRUCTURE_SCM },
      { name: "imports", scm: IMPORTS_SCM },
    ]),
  };
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("tree-sitter runner", () => {
  let runner: TreeSitterRunner;
  beforeEach(() => {
    runner = createTreeSitterRunner();
  });
  afterEach(() => runner.dispose());

  it("returns captures with name, node type, text and positions per query", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const result = await runner.parseSource(target, "OrderService.java", SOURCE);

    expect(result.status).toBe("parsed");
    if (result.status !== "parsed") return;
    expect(result.hasErrorNodes).toBe(false);
    expect(result.hasMissingNodes).toBe(false);
    expect(result.captures.imports).toEqual([
      {
        name: "import",
        nodeType: "scoped_identifier",
        text: "java.util.List",
        start: { line: 3, column: 7 },
        end: { line: 3, column: 21 },
      },
    ]);
    const structure = result.captures.structure.map((c) => [c.name, c.nodeType, c.text.split("\n")[0]]);
    expect(structure).toEqual([
      ["class", "class_declaration", "public class OrderService {"],
      ["class.name", "identifier", "OrderService"],
      ["method.name", "identifier", "open"],
    ]);
    expect(result.captures.structure[0].start).toEqual({ line: 5, column: 0 });
    expect(result.captures.structure[0].end).toEqual({ line: 9, column: 1 });
  });

  it("reports ERROR nodes", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const result = await runner.parseSource(target, "Broken.java", "class A { void f() { @@ ## } }");

    expect(result).toMatchObject({ status: "parsed", hasErrorNodes: true });
  });

  it("reports MISSING nodes", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const result = await runner.parseSource(target, "Missing.java", "class A { void f() { int x = 1 } }");

    expect(result).toMatchObject({ status: "parsed", hasErrorNodes: false, hasMissingNodes: true });
  });

  it("parses files from disk", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const path = join(dir, "OrderService.java");
    writeFileSync(path, SOURCE);
    const result = await runner.parseFile(target, path);

    expect(result).toMatchObject({ status: "parsed", path });
    expect(runner.stats()).toEqual({ parsed: 1, skippedOversized: 0 });
  });

  it("initialises web-tree-sitter once and loads each grammar once per process", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const other = createTreeSitterRunner();
    try {
      await runner.parseSource(target, "a.java", SOURCE);
      await other.parseSource(target, "b.java", SOURCE);
      await runner.parseSource(target, "c.java", SOURCE);
    } finally {
      other.dispose();
    }

    expect(initSpy).toHaveBeenCalledTimes(1);
    expect(loadSpy).toHaveBeenCalledTimes(1);
  });

  it("frees trees: parsing many files does not grow memory without bound", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    // About 15 KB of Java. Left unfreed, 1000 of its trees hold ~700 MB of
    // external memory until web-tree-sitter's GC finalizer happens to run.
    const big = Array.from({ length: 300 }, (_, i) => `class C${i} { int f(int x) { return x + ${i}; } }`).join("\n");
    const parseMany = async (n: number) => {
      for (let i = 0; i < n; i++) await runner.parseSource(target, `F${i}.java`, big);
    };
    const freed = vi.spyOn(Tree.prototype, "delete");

    try {
      await parseMany(100); // Let the WASM heap reach its working size.
      const before = process.memoryUsage().external;
      await parseMany(1000);
      const growth = process.memoryUsage().external - before;

      expect(runner.stats().parsed).toBe(1100);
      // Deterministic: every tree is freed by the runner, not left to GC.
      expect(freed).toHaveBeenCalledTimes(1100);
      expect(growth).toBeLessThan(64 * 1024 * 1024);
    } finally {
      freed.mockRestore();
    }
  });

  it("frees queries on dispose and refuses further use", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const freed = vi.spyOn(Query.prototype, "delete");
    try {
      await runner.parseSource(target, "a.java", SOURCE);
      runner.dispose();
      expect(freed).toHaveBeenCalledTimes(target.pack.queries.length);
    } finally {
      freed.mockRestore();
    }

    await expect(runner.parseSource(target, "b.java", SOURCE)).rejects.toThrow(/after dispose/);
  });

  it("fails loudly on a query that does not compile", async (ctx) => {
    if (!existsSync(JAVA_WASM)) ctx.skip(NOT_BUILT);
    const bad = { grammarPath: JAVA_WASM, pack: makePack([{ name: "bad", scm: "(no_such_node) @x" }]) };

    await expect(runner.parseSource(bad, "a.java", SOURCE)).rejects.toThrow();
  });
});

describe("size limit", () => {
  // The grammar path is never read: oversized files are skipped before parsing.
  const absent: RunnablePack = {
    grammarPath: join(tmpdir(), "no-such-grammar.wasm"),
    pack: {
      id: "java-test",
      config: goConfig,
      grammar: { name: "no-such-grammar", version: "0.0.0" },
      queries: [],
      provenance: {},
    },
  };

  it("skips and counts sources above the limit", async () => {
    const runner = createTreeSitterRunner({ maxFileBytes: 10 });
    const result = await runner.parseSource(absent, "Big.java", "class Big {}");
    runner.dispose();

    expect(result).toEqual({ status: "skipped", path: "Big.java", reason: "oversized", sizeBytes: 12 });
    expect(runner.stats()).toEqual({ parsed: 0, skippedOversized: 1 });
  });

  it("skips files on disk without reading them", async () => {
    const path = join(dir, "Big.java");
    writeFileSync(path, "x".repeat(2048));
    const runner = createTreeSitterRunner({ maxFileBytes: 1024 });
    const result = await runner.parseFile(absent, path);
    runner.dispose();

    expect(result).toMatchObject({ status: "skipped", sizeBytes: 2048 });
    expect(runner.stats().skippedOversized).toBe(1);
  });
});
