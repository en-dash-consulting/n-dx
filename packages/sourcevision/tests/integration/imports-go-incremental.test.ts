/**
 * The Go pack is structure-only, so it must stay out of the imports phase:
 * Go import edges still come from the regex parser, and an incremental run
 * re-parses only the Go files that changed. Were the pack counted as an
 * import pack, `analyzeImports` would add every .go file to the changed set.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { packsFor } from "../../src/analyzers/pack-imports.js";
import { goConfig } from "../../src/language/go.js";
import { goPack } from "../../src/language/go-pack.js";
import { BUILTIN_PACKS } from "../../src/language/pack.js";

describe("Go pack and the imports phase", () => {
  it("is registered, yet not an import pack", () => {
    expect(BUILTIN_PACKS).toContain(goPack);
    expect(packsFor(new Set([".go"]))).toEqual([]);
    expect(packsFor(new Set([".go"]), [goPack])).toEqual([]);
  });

  describe("incremental analysis", () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), "sv-go-incremental-"));
      await mkdir(join(dir, "util"));
      await writeFile(join(dir, "go.mod"), "module example.com/app\n\ngo 1.22\n");
      await writeFile(join(dir, "main.go"), 'package main\n\nimport "example.com/app/util"\n\nfunc main() { util.Run() }\n');
      await writeFile(join(dir, "other.go"), 'package main\n\nimport "example.com/app/util"\n\nfunc other() { util.Run() }\n');
      await writeFile(join(dir, "util", "util.go"), "package util\n\nfunc Run() {}\n");
    });
    afterEach(() => rm(dir, { recursive: true, force: true }));

    it("keeps Go import edges from the regex parser and re-parses only changed files", async () => {
      const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
      const full = await analyzeImports(dir, inventory, { language: "go" });
      // Go edges point at the imported package's directory.
      expect(full.edges.filter((e) => e.to === "util").map((e) => e.from).sort()).toEqual([
        "main.go",
        "other.go",
      ]);

      // Mark other.go's edge so a re-parse of that file shows. Only main.go "changed".
      const marked = {
        ...full,
        edges: full.edges.map((e) => (e.from === "other.go" ? { ...e, symbols: ["not-reparsed"] } : e)),
      };
      const incremental = await analyzeImports(dir, inventory, {
        language: "go",
        previousImports: marked,
        changedFiles: new Set(["main.go"]),
        fileSetChanged: false,
      });

      const other = incremental.edges.find((e) => e.from === "other.go" && e.to === "util");
      expect(other?.symbols).toEqual(["not-reparsed"]);
      const main = incremental.edges.find((e) => e.from === "main.go" && e.to === "util");
      expect(main).toEqual(full.edges.find((e) => e.from === "main.go" && e.to === "util"));
    });
  });
});
