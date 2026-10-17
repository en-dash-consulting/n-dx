/**
 * Pack selection, how a pack's imports facts become edges, and every way a
 * pack degrades, over stand-in packs. Real packs through the imports phase
 * are covered by tests/integration/java-zones.test.ts and
 * tests/integration/imports-go-incremental.test.ts; the packs' own failure
 * modes (grammar, queries, build files) by the packs' tests.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { goConfig, javaConfig, type LanguagePackEntry, type PackProjectRequest, type PackProjectResult } from "@n-dx/lang-kit";
import { buildPackImportGraph, isPackFile, packsFor } from "../../../src/analyzers/pack-imports.js";
import { KNOWN_PACKS, type KnownPack } from "../../../src/language/pack-loader.js";
import type { Inventory } from "../../../src/schema/v1.js";

const VERSION = "1.2.3";

const file = (path: string): Inventory["files"][number] =>
  ({ path, size: 1, language: "Java", lineCount: 1, hash: "x", role: "source", category: "code" }) as Inventory["files"][number];

const GO_FALLBACK = new Map([["go", "the regex import parser"]]);

/** A known pack whose module exports `entry`, or whose import fails with `error`. */
function knownPack(config: typeof javaConfig, found: { entry?: LanguagePackEntry; error?: Error }): KnownPack {
  return {
    id: config.id,
    packageName: `@n-dx/lang-${config.id}`,
    config,
    importByResolution: () => (found.error ? Promise.reject(found.error) : Promise.resolve({ pack: found.entry })),
  };
}

/** A pack entry answering every call with `result`, recording the requests. */
function stubEntry(config: typeof javaConfig, result: PackProjectResult, requests: PackProjectRequest[] = []): LanguagePackEntry {
  return {
    packageName: `@n-dx/lang-${config.id}`,
    version: VERSION,
    id: config.id,
    config,
    produces: ["imports"],
    analyzeProject: async (request) => (requests.push(request), result),
  };
}

const notInstalled = (name: string): Error =>
  Object.assign(new Error(`Cannot find package '${name}' imported from /x.js`), { code: "ERR_MODULE_NOT_FOUND" });

describe("packsFor", () => {
  it("selects a pack only when the imports phase parses its extension", () => {
    const [java, go] = KNOWN_PACKS;
    expect(packsFor(new Set([".ts", ".java"]))).toEqual([java]);
    expect(packsFor(new Set([".ts", ".go"]))).toEqual([go]);
    expect(packsFor(new Set([".ts"]))).toEqual([]);
  });
});

describe("isPackFile", () => {
  it("matches a pack's extensions case-insensitively", () => {
    const java = [{ config: javaConfig }];
    expect(isPackFile("src/A.java", java)).toBe(true);
    expect(isPackFile("src/A.JAVA", java)).toBe(true);
    expect(isPackFile("src/a.ts", java)).toBe(false);
    expect(isPackFile("src/A.java", [])).toBe(false);
  });
});

describe("buildPackImportGraph", () => {
  let packDir: string;
  beforeAll(() => {
    packDir = mkdtempSync(join(tmpdir(), "sv-pack-imports-"));
  });
  afterAll(() => rmSync(packDir, { recursive: true, force: true }));

  const run = (files: string[], packs: KnownPack[], extra: { fallbacks?: ReadonlyMap<string, string> } = {}) => {
    const messages: string[] = [];
    const graph = buildPackImportGraph(files.map(file), "/project", {
      packs,
      loader: { packDir, version: VERSION },
      warn: (m) => messages.push(m),
      ...extra,
    });
    return graph.then((g) => ({ graph: g, messages }));
  };

  it("loads no pack, and reports nothing, when no file belongs to one", async () => {
    const { graph, messages } = await run(["src/a.ts"], [knownPack(javaConfig, { error: new Error("must not be loaded") })]);
    expect(graph).toEqual({ edges: [], external: [], degraded: [] });
    expect(messages).toEqual([]);
  });

  it("hands the pack its language's files and asks only for imports", async () => {
    const requests: PackProjectRequest[] = [];
    const entry = stubEntry(javaConfig, { facts: [], unparsed: [] }, requests);
    await run(["src/A.java", "src/a.ts", "src/B.java"], [knownPack(javaConfig, { entry })]);
    expect(requests).toEqual([{ projectDir: "/project", files: ["src/A.java", "src/B.java"], kinds: ["imports"] }]);
  });

  it("turns imports facts into edges and merges externals across files", async () => {
    const entry = stubEntry(javaConfig, {
      facts: [
        {
          path: "src/A.java",
          imports: { files: [{ to: "src/B.java", symbols: ["B"] }], external: [{ package: "java.util", symbols: ["List"] }] },
        },
        { path: "src/B.java", imports: { files: [], external: [{ package: "java.util", symbols: ["Map"] }] } },
        { path: "src/C.java" },
      ],
      unparsed: [],
    });
    const { graph, messages } = await run(["src/A.java", "src/B.java", "src/C.java"], [knownPack(javaConfig, { entry })]);
    expect(graph).toEqual({
      edges: [{ from: "src/A.java", to: "src/B.java", type: "static", symbols: ["B"] }],
      external: [{ package: "java.util", importedBy: ["src/A.java", "src/B.java"], symbols: ["List", "Map"] }],
      degraded: [],
    });
    expect(messages).toEqual([]);
  });

  it("reports a missing pack once, however many files, naming the install command, and produces no edges", async () => {
    const { graph, messages } = await run(["src/A.java", "src/B.java"], [knownPack(javaConfig, { error: notInstalled("@n-dx/lang-java") })]);
    expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
    expect(messages).toEqual([
      "Java: pack @n-dx/lang-java is not installed; Java files get inventory only. " +
        `Install it with \`npm install --prefix ${packDir} @n-dx/lang-java@${VERSION}\`.`,
    ]);
  });

  it("names the caller's fallback parser, not inventory-only, for a pack that has one", async () => {
    const { graph, messages } = await run(["a.go"], [knownPack(goConfig, { error: notInstalled("@n-dx/lang-go") })], { fallbacks: GO_FALLBACK });
    expect(graph.degraded).toEqual(["go"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Go imports come from the regex import parser");
    expect(messages[0]).not.toContain("inventory only");
  });

  it("refuses a pack of another version with one notice", async () => {
    const entry = { ...stubEntry(javaConfig, { facts: [], unparsed: [] }), version: "1.0.0" };
    const { graph, messages } = await run(["src/A.java"], [knownPack(javaConfig, { entry })]);
    expect(graph.degraded).toEqual(["java"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`pack @n-dx/lang-java@1.0.0 does not match @n-dx/sourcevision@${VERSION}`);
  });

  it("degrades, with one notice and without running it, a pack whose produces omits imports", async () => {
    const requests: PackProjectRequest[] = [];
    const entry = { ...stubEntry(goConfig, { facts: [], unparsed: [] }, requests), produces: [] };
    const { graph, messages } = await run(["a.go"], [knownPack(goConfig, { entry })], { fallbacks: GO_FALLBACK });
    expect(graph).toEqual({ edges: [], external: [], degraded: ["go"] });
    expect(requests).toEqual([]);
    expect(messages).toEqual(['Go: the pack does not produce "imports"; Go imports come from the regex import parser.']);
  });

  it("words a pack's own degraded result as one notice: what failed, what the language gets, how to fix it", async () => {
    const entry = stubEntry(javaConfig, {
      facts: [],
      unparsed: [],
      degraded: { reason: "grammar tree-sitter-java@0.23.5 is not built (expected /g/tree-sitter-java.wasm)", remedy: "Build it." },
    });
    const { graph, messages } = await run(["src/A.java", "src/B.java"], [knownPack(javaConfig, { entry })]);
    expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
    expect(messages).toEqual([
      "Java: grammar tree-sitter-java@0.23.5 is not built (expected /g/tree-sitter-java.wasm); Java files get inventory only. Build it.",
    ]);
  });

  it("degrades only its own language, with one notice naming the error, when a pack's analyzeProject rejects", async () => {
    const broken: LanguagePackEntry = {
      ...stubEntry(javaConfig, { facts: [], unparsed: [] }),
      analyzeProject: async () => {
        throw new Error("resolver blew up");
      },
    };
    const healthy = stubEntry(goConfig, {
      facts: [{ path: "a.go", imports: { files: [{ to: "b.go", symbols: [] }], external: [] } }],
      unparsed: [],
    });
    const { graph, messages } = await run(
      ["src/A.java", "a.go", "b.go"],
      [knownPack(javaConfig, { entry: broken }), knownPack(goConfig, { entry: healthy })],
    );
    expect(graph.degraded).toEqual(["java"]);
    expect(graph.edges).toEqual([{ from: "a.go", to: "b.go", type: "static", symbols: [] }]);
    expect(messages).toEqual([
      "Java: the pack failed (resolver blew up); Java files get inventory only. " +
        `Reinstall it with \`npm install --prefix ${packDir} @n-dx/lang-java@${VERSION}\`.`,
    ]);
  });

  it("hands Go to the regex parser when its pack's analyzeProject rejects", async () => {
    const entry: LanguagePackEntry = {
      ...stubEntry(goConfig, { facts: [], unparsed: [] }),
      analyzeProject: () => Promise.reject(new Error("bad contract")),
    };
    const { graph, messages } = await run(["a.go"], [knownPack(goConfig, { entry })], { fallbacks: GO_FALLBACK });
    expect(graph.degraded).toEqual(["go"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Go: the pack failed (bad contract); Go imports come from the regex import parser.");
  });

  it("ends the notice after the outcome when the pack names no remedy", async () => {
    const entry = stubEntry(goConfig, { facts: [], unparsed: [], degraded: { reason: "the project's build files could not be read (go.mod unreadable)" } });
    const { messages } = await run(["a.go"], [knownPack(goConfig, { entry })], { fallbacks: GO_FALLBACK });
    expect(messages).toEqual([
      "Go: the project's build files could not be read (go.mod unreadable); Go imports come from the regex import parser.",
    ]);
  });
});
