/**
 * Pack selection, how a pack's imports facts become edges, and every way a
 * pack degrades, over stand-in packs. Real packs through the imports phase
 * are covered by tests/integration/java-zones.test.ts and
 * tests/integration/imports-go-incremental.test.ts; the packs' own failure
 * modes (grammar, queries, build files) by the packs' tests.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { goConfig, javaConfig, type LanguagePackEntry, type PackProjectRequest, type PackProjectResult } from "@n-dx/lang-kit";
import { analyzeImports } from "../../../src/analyzers/imports.js";
import { analyzeInventory } from "../../../src/analyzers/inventory.js";
import { buildPackImportGraph, isPackFile, noticeListedPacks, packsFor, readPackFrameworkFacts } from "../../../src/analyzers/pack-imports.js";
import { KNOWN_PACKS, type InstallablePack, type KnownPack } from "../../../src/language/pack-loader.js";
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
    bundled: KNOWN_PACKS.find((p) => p.id === config.id)?.bundled,
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

  const run = (
    files: string[],
    packs: KnownPack[],
    extra: { fallbacks?: ReadonlyMap<string, string>; listed?: readonly string[] } = {},
  ) => {
    const messages: string[] = [];
    const suggested: string[] = [];
    const graph = buildPackImportGraph(files.map(file), "/project", {
      packs,
      loader: { packDir, version: VERSION },
      warn: (m) => messages.push(m),
      suggest: (id) => suggested.push(id),
      ...extra,
    });
    return graph.then((g) => ({ graph: g, messages, suggested }));
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

  it("with a framework sink, asks the same call for the framework kinds the pack produces and hands over its facts and notices", async () => {
    const requests: PackProjectRequest[] = [];
    const facts = [{ path: "src/A.java", routes: [{ path: "/a", position: { line: 1, column: 0 } }] }];
    const entry = {
      ...stubEntry(javaConfig, { facts, unparsed: [], notices: ["Spring Boot: 1 skipped."] }, requests),
      produces: ["imports", "routes", "outboundCalls"] as const,
    };
    const collected: unknown[] = [];
    const messages: string[] = [];
    await buildPackImportGraph([file("src/A.java")], "/project", {
      packs: [knownPack(javaConfig, { entry: entry as LanguagePackEntry })],
      loader: { packDir, version: VERSION },
      warn: (m) => messages.push(m),
      framework: (f) => collected.push(...f),
    });
    expect(requests.map((r) => r.kinds)).toEqual([["imports", "routes", "outboundCalls"]]);
    expect(collected).toEqual(facts);
    expect(messages).toEqual(["Spring Boot: 1 skipped."]);
  });

  it("with a framework sink, asks a pack producing no framework kinds for imports only and hands over nothing", async () => {
    const requests: PackProjectRequest[] = [];
    const entry = stubEntry(javaConfig, { facts: [], unparsed: [] }, requests);
    const collected: unknown[] = [];
    await buildPackImportGraph([file("src/A.java")], "/project", {
      packs: [knownPack(javaConfig, { entry })],
      loader: { packDir, version: VERSION },
      framework: (f) => collected.push(...f),
    });
    expect(requests.map((r) => r.kinds)).toEqual([["imports"]]);
    expect(collected).toEqual([]);
  });

  it("turns imports facts into edges and merges externals across files", async () => {
    const entry = stubEntry(javaConfig, {
      facts: [
        {
          path: "src/A.java",
          imports: { files: [{ to: "src/B.java", symbols: ["B"] }], external: [{ package: "java:stdlib:java.util", symbols: ["List"] }] },
        },
        { path: "src/B.java", imports: { files: [], external: [{ package: "java:stdlib:java.util", symbols: ["Map"] }] } },
        { path: "src/C.java" },
      ],
      unparsed: [],
    });
    const { graph, messages } = await run(["src/A.java", "src/B.java", "src/C.java"], [knownPack(javaConfig, { entry })]);
    expect(graph).toEqual({
      edges: [{ from: "src/A.java", to: "src/B.java", type: "static", symbols: ["B"] }],
      external: [{ package: "java:stdlib:java.util", importedBy: ["src/A.java", "src/B.java"], symbols: ["List", "Map"] }],
      degraded: [],
    });
    expect(messages).toEqual([]);
  });

  it("only suggests a missing opt-in pack the project does not list: no warning, no edges", async () => {
    const { graph, messages, suggested } = await run(["src/A.java", "src/B.java"], [knownPack(javaConfig, { error: notInstalled("@n-dx/lang-java") })]);
    expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
    expect(messages).toEqual([]);
    expect(suggested).toEqual(["java"]);
  });

  it("warns once, however many files, naming the install command, about a missing pack the project lists", async () => {
    const { graph, messages, suggested } = await run(
      ["src/A.java", "src/B.java"],
      [knownPack(javaConfig, { error: notInstalled("@n-dx/lang-java") })],
      { listed: ["java"] },
    );
    expect(graph).toEqual({ edges: [], external: [], degraded: ["java"] });
    expect(messages).toEqual([
      "Java: pack @n-dx/lang-java is not installed; Java files get inventory only. " +
        "Install it with `ndx sv pack add java`.",
    ]);
    expect(suggested).toEqual([]);
  });

  it("warns about a missing bundled Go pack, naming the caller's fallback parser, and never suggests it", async () => {
    const { graph, messages, suggested } = await run(["a.go"], [knownPack(goConfig, { error: notInstalled("@n-dx/lang-go") })], { fallbacks: GO_FALLBACK });
    expect(graph.degraded).toEqual(["go"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Go imports come from the regex import parser");
    expect(messages[0]).not.toContain("inventory only");
    expect(suggested).toEqual([]);
  });

  it("warns, and does not suggest, an unlisted pack that is installed but exports no pack entry", async () => {
    const { graph, messages, suggested } = await run(["src/A.java"], [knownPack(javaConfig, {})]);
    expect(graph.degraded).toEqual(["java"]);
    expect(messages).toEqual([
      "Java: pack @n-dx/lang-java could not be loaded (it exports no java pack entry); Java files get inventory only. " +
        "Reinstall it with `ndx sv pack add java`.",
    ]);
    expect(suggested).toEqual([]);
  });

  it("refuses a pack of another version with one notice", async () => {
    const entry = { ...stubEntry(javaConfig, { facts: [], unparsed: [] }), version: "1.0.0" };
    const { graph, messages, suggested } = await run(["src/A.java"], [knownPack(javaConfig, { entry })]);
    expect(graph.degraded).toEqual(["java"]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`pack @n-dx/lang-java@1.0.0 does not match @n-dx/sourcevision@${VERSION}`);
    // Refused, not missing: unlisted or not, it is warned about.
    expect(suggested).toEqual([]);
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
        "Reinstall it with `ndx sv pack add java`.",
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

describe("sourcevision.packs", () => {
  let project: string;
  let emptyPackDir: string;
  beforeAll(() => {
    project = mkdtempSync(join(tmpdir(), "sv-pack-list-"));
    emptyPackDir = mkdtempSync(join(tmpdir(), "sv-pack-list-dir-"));
    mkdirSync(join(project, "src"));
    writeFileSync(join(project, "src", "a.ts"), "export const a = 1;\n");
  });
  afterAll(() => {
    rmSync(project, { recursive: true, force: true });
    rmSync(emptyPackDir, { recursive: true, force: true });
  });

  const configure = (packs: unknown): void =>
    writeFileSync(join(project, ".n-dx.json"), JSON.stringify(packs === undefined ? {} : { sourcevision: { packs } }));

  /** `analyzeImports` on a TypeScript-only project; the loader looks for a version no pack has. */
  async function analyze(): Promise<{ messages: string[]; imports: Awaited<ReturnType<typeof analyzeImports>> }> {
    const inventory = await analyzeInventory(project);
    const messages: string[] = [];
    const imports = await analyzeImports(project, inventory, {
      packs: { loader: { packDir: emptyPackDir, version: "9.9.9" }, warn: (m) => messages.push(m) },
    });
    return { messages, imports };
  }

  it("gives one notice naming `ndx sv pack add java` for a listed pack that is refused, with no Java files", async () => {
    configure(["java"]);
    const { messages } = await analyze();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatch(/^sourcevision\.packs lists java: pack @n-dx\/lang-java@.* does not match @n-dx\/sourcevision@9\.9\.9.*`ndx sv pack add java`/);
  });

  it("gives one warning listing the known ids for an unknown id", async () => {
    configure(["cobol", "fortran"]);
    const { messages } = await analyze();
    expect(messages).toEqual(["sourcevision.packs lists unknown packs cobol, fortran; known packs: java, go, terraform, python, sql."]);
  });

  it("says nothing with no list, an empty list or a non-array, and never changes the output", async () => {
    configure(undefined);
    const base = await analyze();
    expect(base.messages).toEqual([]);
    for (const value of [[], "java", { java: true }]) {
      configure(value);
      const { messages, imports } = await analyze();
      expect(messages).toEqual([]);
      expect(imports).toEqual(base.imports);
    }
    configure(["java"]);
    expect((await analyze()).imports).toEqual(base.imports);
  });
});

describe("noticeListedPacks", () => {
  const installable = (id: string): InstallablePack => ({
    id,
    packageName: `@n-dx/lang-${id}`,
    importByResolution: () => Promise.reject(notInstalled(`@n-dx/lang-${id}`)),
  });

  it("names the install command of a missing pack once, skipping packs already reported or not listed", async () => {
    const messages: string[] = [];
    await noticeListedPacks(["java", "java", "go"], new Set(["go"]), {
      installable: [installable("java"), installable("go"), installable("sql")],
      loader: { packDir: "/nonexistent", version: VERSION },
      warn: (m) => messages.push(m),
    });
    expect(messages).toEqual(["sourcevision.packs lists java: pack @n-dx/lang-java is not installed. Install it with `ndx sv pack add java`."]);
  });
});

describe("readPackFrameworkFacts", () => {
  const framework = (result: PackProjectResult | Error, requests: PackProjectRequest[] = []): LanguagePackEntry => ({
    ...stubEntry(javaConfig, { facts: [], unparsed: [] }),
    produces: ["imports", "routes", "outboundCalls"],
    analyzeProject: async (request) => {
      requests.push(request);
      if (result instanceof Error) throw result;
      return result;
    },
  });
  const read = async (packs: KnownPack[]) => {
    const messages: string[] = [];
    const facts = await readPackFrameworkFacts([file("src/A.java"), file("src/a.ts")], "/project", {
      packs,
      loader: { packDir: "/nonexistent", version: VERSION },
      warn: (m) => messages.push(m),
    });
    return { facts, messages };
  };

  it("asks only for the framework kinds, on the pack's files", async () => {
    const requests: PackProjectRequest[] = [];
    const facts = [{ path: "src/A.java", outboundCalls: [] }];
    const result = await read([knownPack(javaConfig, { entry: framework({ facts, unparsed: [] }, requests) })]);
    expect(requests).toEqual([{ projectDir: "/project", files: ["src/A.java"], kinds: ["routes", "outboundCalls"] }]);
    expect(result).toEqual({ facts, messages: [] });
  });

  it("passes over quietly a pack that cannot load or produces no framework kinds", async () => {
    const requests: PackProjectRequest[] = [];
    expect(await read([knownPack(javaConfig, { error: notInstalled("@n-dx/lang-java") })])).toEqual({ facts: [], messages: [] });
    expect(await read([knownPack(javaConfig, { entry: stubEntry(javaConfig, { facts: [], unparsed: [] }, requests) })])).toEqual({ facts: [], messages: [] });
    expect(requests).toEqual([]);
  });

  it("gives one notice when the pack degrades or rejects", async () => {
    const degraded = await read([knownPack(javaConfig, { entry: framework({ facts: [], unparsed: [], degraded: { reason: "grammar not built" } }) })]);
    expect(degraded).toEqual({ facts: [], messages: ["Java: grammar not built; Java routes and outbound calls are not recorded."] });
    const rejected = await read([knownPack(javaConfig, { entry: framework(new Error("boom")) })]);
    expect(rejected.messages).toEqual([
      "Java: the pack failed (boom); Java routes and outbound calls are not recorded. Reinstall it with `ndx sv pack add java`.",
    ]);
  });
});
