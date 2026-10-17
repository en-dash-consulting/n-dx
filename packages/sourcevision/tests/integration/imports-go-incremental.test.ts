/**
 * Go in the imports phase: edges come from the Go pack when its grammar is
 * built, and from the regex parser whenever the pack degrades (grammar
 * missing or unloadable, a query rejected, build files unreadable), so a Go
 * repository never drops to inventory-only. As for Java, every .go file is
 * re-parsed on an incremental run, because resolution needs the whole project.
 *
 * The fixture tells the two parsers apart: `docs` holds no .go file, so the
 * pack drops `main.go`'s import of it while the regex parser keeps the edge.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeImports, type ImportsOptions } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packsFor } from "../../src/analyzers/pack-imports.js";
import { goConfig } from "@n-dx/lang-kit";
import { goPack } from "../../src/language/go-pack.js";
import { goResolver } from "../../src/language/go-resolver.js";
import { BUILTIN_PACKS } from "../../src/language/pack.js";
import { grammarBuildDir } from "../../src/language/package-paths.js";
import type { Imports } from "../../src/schema/v1.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";

const GO_WASM = join(grammarBuildDir(), `${goPack.grammar.name}.wasm`);

const MAIN = 'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/util"\n\t_ "example.com/app/docs"\n)\n\nfunc main() { fmt.Println(); util.Run() }\n';
const OTHER = 'package main\n\nimport "example.com/app/util"\n\nfunc other() { util.Run() }\n';

const edgeKeys = (imports: Imports): string[] => imports.edges.map((e) => `${e.from} -> ${e.to} [${e.symbols.join(",")}]`).sort();

const PACK_EDGES = ["main.go -> util [*]", "other.go -> util [*]"];
const REGEX_EDGES = ["main.go -> docs [*]", "main.go -> util [*]", "other.go -> util [*]"];

describe("Go pack in the imports phase", () => {
  it("is registered as an import pack", () => {
    expect(BUILTIN_PACKS).toContain(goPack);
    expect(packsFor(new Set([".go"]))).toEqual([goPack]);
  });

  let dir: string;
  let scratch: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-go-imports-"));
    scratch = await mkdtemp(join(tmpdir(), "sv-go-imports-scratch-"));
    await mkdir(join(dir, "util"));
    await mkdir(join(dir, "docs"));
    await writeFile(join(dir, "go.mod"), "module example.com/app\n\ngo 1.22\n");
    await writeFile(join(dir, "main.go"), MAIN);
    await writeFile(join(dir, "other.go"), OTHER);
    await writeFile(join(dir, "util", "util.go"), "package util\n\nfunc Run() {}\n");
    await writeFile(join(dir, "docs", "README.md"), "docs\n");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(scratch, { recursive: true, force: true });
  });

  async function analyze(options: Omit<ImportsOptions, "language"> = {}): Promise<{ imports: Imports; messages: string[] }> {
    const messages: string[] = [];
    const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
    const imports = await analyzeImports(dir, inventory, {
      ...options,
      language: "go",
      packs: { ...options.packs, warn: (m) => messages.push(m) },
    });
    return { imports, messages };
  }

  it("takes Go edges and externals from the pack when the grammar is built", async (ctx) => {
    skipUnlessGrammar(ctx, GO_WASM);
    const { imports, messages } = await analyze();
    expect(messages).toEqual([]);
    expect(edgeKeys(imports)).toEqual(PACK_EDGES);
    expect(imports.external).toEqual([{ package: "stdlib:fmt", importedBy: ["main.go"], symbols: ["*"] }]);
  });

  describe("falls back to the regex parser when the pack degrades", () => {
    it("because the grammar is not built", async () => {
      const { imports, messages } = await analyze({ packs: { grammarDir: scratch } });
      expect(edgeKeys(imports)).toEqual(REGEX_EDGES);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("Go imports come from the regex import parser");
    });

    it("because the grammar will not load", async () => {
      await writeFile(join(scratch, `${goPack.grammar.name}.wasm`), "not a wasm module");
      const { imports, messages } = await analyze({ packs: { grammarDir: scratch } });
      expect(edgeKeys(imports)).toEqual(REGEX_EDGES);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("could not be loaded");
    });

    it("because a query does not compile against the grammar", async (ctx) => {
      skipUnlessGrammar(ctx, GO_WASM);
      const queryPath = join(scratch, "bad.scm");
      await writeFile(queryPath, "(no_such_node_type) @x");
      const pack = { ...goPack, queries: [{ name: "imports", path: queryPath }] };
      const { imports, messages } = await analyze({ packs: { packs: [pack] } });
      expect(edgeKeys(imports)).toEqual(REGEX_EDGES);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("no_such_node_type");
    });

    it("because the project's build files cannot be read", async (ctx) => {
      skipUnlessGrammar(ctx, GO_WASM);
      const resolver = { ...goResolver, forProject: () => Promise.reject(new Error("go.work unreadable")) };
      const { imports, messages } = await analyze({ packs: { packs: [{ ...goPack, resolver }] } });
      expect(edgeKeys(imports)).toEqual(REGEX_EDGES);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("go.work unreadable");
    });
  });

  describe("incremental analysis keeps no stale edges", () => {
    // Pack: grammar built. Fallback: grammar dir empty, so the regex parser runs.
    const modes = [
      { name: "through the pack", needsGrammar: true, packs: () => ({}) },
      { name: "through the regex fallback", needsGrammar: false, packs: (scratchDir: string) => ({ grammarDir: scratchDir }) },
    ];
    for (const mode of modes) {
      it(mode.name, async (ctx) => {
        if (mode.needsGrammar) skipUnlessGrammar(ctx, GO_WASM);
        const packs = mode.packs(scratch);
        const { imports: full } = await analyze({ packs });

        // main.go drops its util and fmt imports; only main.go is reported changed.
        await writeFile(join(dir, "main.go"), 'package main\n\nimport "os"\n\nfunc main() { os.Exit(0) }\n');
        // Mark other.go's edge: every .go file is re-parsed, so the mark must not survive.
        const marked: Imports = {
          ...full,
          edges: full.edges.map((e) => (e.from === "other.go" ? { ...e, symbols: ["not-reparsed"] } : e)),
        };
        const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
        const incremental = await analyzeImports(dir, inventory, {
          language: "go",
          packs: { ...packs, warn: () => undefined },
          previousImports: marked,
          changedFiles: new Set(["main.go"]),
          fileSetChanged: false,
        });

        expect(edgeKeys(incremental)).toEqual(["other.go -> util [*]"]);
        expect(incremental.external.map((e) => [e.package, e.importedBy])).toEqual([["stdlib:os", ["main.go"]]]);
      });
    }
  });
});
