/**
 * Pack selection and the degrade paths of the pack import graph. The
 * parse-and-resolve path is covered by tests/integration/java-zones.test.ts
 * and tests/integration/imports-go-incremental.test.ts.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildPackImportGraph, isPackFile, packsFor } from "../../../src/analyzers/pack-imports.js";
import { goPack } from "../../../src/language/go-pack.js";
import { goResolver } from "../../../src/language/go-resolver.js";
import { javaPack } from "../../../src/language/java-pack.js";
import { grammarBuildDir } from "../../../src/language/package-paths.js";
import { DEFAULT_MAX_FILE_BYTES } from "../../../src/language/runner.js";
import type { Inventory } from "../../../src/schema/v1.js";
import { skipUnlessGrammar } from "../../helpers/grammar.js";

const file = (path: string): Inventory["files"][number] =>
  ({ path, size: 1, language: "Java", lineCount: 1, hash: "x", role: "source", category: "code" }) as Inventory["files"][number];

const GO_WASM = join(grammarBuildDir(), `${goPack.grammar.name}.wasm`);
const GO_FALLBACK = new Map([[goPack.id, "the regex import parser"]]);

describe("packsFor", () => {
  it("selects a pack only when the imports phase parses its extension", () => {
    expect(packsFor(new Set([".ts", ".java"]))).toEqual([javaPack]);
    expect(packsFor(new Set([".ts", ".go"]))).toEqual([goPack]);
    expect(packsFor(new Set([".ts"]))).toEqual([]);
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
    expect(graph).toEqual({ edges: [], external: [], degraded: [] });
    expect(messages).toEqual([]);
  });

  it("reports a missing grammar once, however many files, and produces no edges", async () => {
    const messages: string[] = [];
    const graph = await buildPackImportGraph([file("src/A.java"), file("src/B.java")], emptyGrammarDir, {
      grammarDir: emptyGrammarDir,
      warn: (m) => messages.push(m),
    });
    expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Java files get inventory only");
  });

  it("names the caller's fallback parser, not inventory-only, for a pack that has one", async () => {
    const messages: string[] = [];
    const graph = await buildPackImportGraph([file("a.go")], emptyGrammarDir, {
      grammarDir: emptyGrammarDir,
      warn: (m) => messages.push(m),
      fallbacks: GO_FALLBACK,
    });
    expect(graph.degraded).toEqual(["go"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Go imports come from the regex import parser");
    expect(messages[0]).not.toContain("inventory only");
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
      expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain(grammarPath);
      expect(messages[0]).toContain("could not be loaded");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it(
    "degrades a pack whose query the loaded grammar rejects, with one notice naming the pack and the error",
    async (ctx) => {
      skipUnlessGrammar(ctx, join(grammarBuildDir(), `${javaPack.grammar.name}.wasm`));
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
        expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
        expect(messages).toHaveLength(1);
        expect(messages[0]).toContain("Java");
        expect(messages[0]).toContain("no_such_node_type");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it("degrades, rather than failing, a pack whose resolver cannot read the project's build files", async (ctx) => {
    skipUnlessGrammar(ctx, GO_WASM);
    const dir = mkdtempSync(join(tmpdir(), "sv-pack-imports-project-"));
    try {
      writeFileSync(join(dir, "a.go"), "package a\n");
      const pack = { ...goPack, resolver: { ...goResolver, forProject: () => Promise.reject(new Error("go.mod unreadable")) } };
      const messages: string[] = [];
      const graph = await buildPackImportGraph([file("a.go")], dir, { packs: [pack], warn: (m) => messages.push(m), fallbacks: GO_FALLBACK });
      expect(graph).toEqual({ edges: [], external: [], degraded: ["go"] });
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("go.mod unreadable");
      expect(messages[0]).toContain("Go imports come from the regex import parser");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the edge to a Go package whose only file is over the runner's size limit", async (ctx) => {
    skipUnlessGrammar(ctx, GO_WASM);
    const dir = mkdtempSync(join(tmpdir(), "sv-pack-imports-oversized-"));
    try {
      mkdirSync(join(dir, "pb"));
      mkdirSync(join(dir, "cmd"));
      writeFileSync(join(dir, "go.mod"), "module example.com/root\n");
      writeFileSync(join(dir, "pb", "api.pb.go"), `package pb\n\n// ${"x".repeat(DEFAULT_MAX_FILE_BYTES)}\n`);
      writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport "example.com/root/pb"\n');
      const graph = await buildPackImportGraph([file("cmd/main.go"), file("pb/api.pb.go")], dir, { packs: [goPack] });
      expect(graph).toEqual({
        edges: [{ from: "cmd/main.go", to: "pb", type: "static", symbols: ["*"] }],
        external: [],
        degraded: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
