/**
 * Go in the imports phase: edges come from the Go pack (`@n-dx/lang-go`)
 * when it is installed and can run, and from the regex parser whenever the
 * pack is missing or degrades, so a Go repository never drops to
 * inventory-only. As for Java, every .go file goes to the pack on an
 * incremental run, because resolution needs the whole project.
 *
 * The fixture tells the two parsers apart: `docs` holds no .go file, so the
 * pack drops `main.go`'s import of it while the regex parser keeps the edge.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig, type LanguagePackEntry } from "@n-dx/lang-kit";
import { goGrammarPath } from "@n-dx/lang-go";
import { skipUnlessGrammar } from "@n-dx/lang-runtime";
import { analyzeImports, type ImportsOptions } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packsFor, type PackImportsOptions } from "../../src/analyzers/pack-imports.js";
import { KNOWN_PACKS, type KnownPack } from "../../src/language/pack-loader.js";
import type { Imports } from "../../src/schema/v1.js";

const GO_PACK = KNOWN_PACKS.find((p) => p.id === goConfig.id)!;

const MAIN = 'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/util"\n\t_ "example.com/app/docs"\n)\n\nfunc main() { fmt.Println(); util.Run() }\n';
const OTHER = 'package main\n\nimport "example.com/app/util"\n\nfunc other() { util.Run() }\n';

const edgeKeys = (imports: Imports): string[] => imports.edges.map((e) => `${e.from} -> ${e.to} [${e.symbols.join(",")}]`).sort();

const PACK_EDGES = ["main.go -> util [*]", "other.go -> util [*]"];
const REGEX_EDGES = ["main.go -> docs [*]", "main.go -> util [*]", "other.go -> util [*]"];

/** The Go pack as if it were not installed. */
const MISSING_GO: KnownPack = {
  ...GO_PACK,
  importByResolution: () =>
    Promise.reject(Object.assign(new Error("Cannot find package '@n-dx/lang-go' imported from /x.js"), { code: "ERR_MODULE_NOT_FOUND" })),
};

/** The installed Go pack, with its answer replaced by a degraded one. */
const DEGRADED_GO: KnownPack = {
  ...GO_PACK,
  importByResolution: async () => {
    const { pack } = (await GO_PACK.importByResolution()) as { pack: LanguagePackEntry };
    const degraded: LanguagePackEntry = {
      ...pack,
      analyzeProject: async () => ({ facts: [], unparsed: [], degraded: { reason: "go.work unreadable" } }),
    };
    return { pack: degraded };
  },
};

describe("Go pack in the imports phase", () => {
  it("is registered as an import pack", () => {
    expect(GO_PACK.packageName).toBe("@n-dx/lang-go");
    expect(packsFor(new Set([".go"]))).toEqual([GO_PACK]);
  });

  let dir: string;
  let packDir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-go-imports-"));
    // An empty per-user pack directory, so the workspace pack is found by resolution.
    packDir = await mkdtemp(join(tmpdir(), "sv-go-imports-packs-"));
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
    await rm(packDir, { recursive: true, force: true });
  });

  async function analyze(options: Omit<ImportsOptions, "language"> = {}): Promise<{ imports: Imports; messages: string[] }> {
    const messages: string[] = [];
    const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
    const imports = await analyzeImports(dir, inventory, {
      ...options,
      language: "go",
      packs: { loader: { packDir }, ...options.packs, warn: (m) => messages.push(m) },
    });
    return { imports, messages };
  }

  it("takes Go edges and externals from the pack when it is installed and its grammar is built", async (ctx) => {
    skipUnlessGrammar(ctx, goGrammarPath());
    const { imports, messages } = await analyze();
    expect(messages).toEqual([]);
    expect(edgeKeys(imports)).toEqual(PACK_EDGES);
    expect(imports.external).toEqual([{ package: "stdlib:fmt", importedBy: ["main.go"], symbols: ["*"] }]);
  });

  describe("falls back to the regex parser", () => {
    it("when the pack is not installed, with one notice naming the install command", async () => {
      const { imports, messages } = await analyze({ packs: { packs: [MISSING_GO] } });
      expect(edgeKeys(imports)).toEqual(REGEX_EDGES);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toContain("Go imports come from the regex import parser");
      expect(messages[0]).toContain("npm install --prefix ");
      expect(messages[0]).toContain("@n-dx/lang-go@");
    });

    it("when the pack reports it cannot run", async () => {
      const { imports, messages } = await analyze({ packs: { packs: [DEGRADED_GO] } });
      expect(edgeKeys(imports)).toEqual(REGEX_EDGES);
      expect(messages).toEqual(["Go: go.work unreadable; Go imports come from the regex import parser."]);
    });
  });

  describe("incremental analysis keeps no stale edges", () => {
    const modes: { name: string; needsGrammar: boolean; packs: PackImportsOptions }[] = [
      { name: "through the pack", needsGrammar: true, packs: {} },
      { name: "through the regex fallback", needsGrammar: false, packs: { packs: [MISSING_GO] } },
    ];
    for (const mode of modes) {
      it(mode.name, async (ctx) => {
        if (mode.needsGrammar) skipUnlessGrammar(ctx, goGrammarPath());
        const { imports: full } = await analyze({ packs: mode.packs });

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
          packs: { loader: { packDir }, ...mode.packs, warn: () => undefined },
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
