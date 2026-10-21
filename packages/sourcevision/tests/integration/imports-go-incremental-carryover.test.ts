/**
 * Go import edges point at the imported package's directory, not a file. An
 * incremental run re-parses only changed files, so the edges of unchanged Go
 * files must be carried forward even though their target is not an
 * inventoried file path, while an edge to a directory that no longer holds an
 * inventoried file is still dropped (#744).
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { goConfig } from "@n-dx/lang-kit";

describe("analyzeImports incremental carry-over — Go package directories", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "sv-go-carryover-"));
    await mkdir(join(dir, "util"));
    await writeFile(join(dir, "go.mod"), "module example.com/app\n\ngo 1.22\n");
    await writeFile(join(dir, "main.go"), 'package main\n\nimport "example.com/app/util"\n\nfunc main() { util.Run() }\n');
    await writeFile(join(dir, "other.go"), 'package main\n\nimport "example.com/app/util"\n\nfunc other() { util.Run() }\n');
    await writeFile(join(dir, "util", "util.go"), "package util\n\nfunc Run() {}\n");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  const edgePairs = (edges: { from: string; to: string }[]) => edges.map((e) => `${e.from}->${e.to}`).sort();

  it("keeps unchanged files' edges to a package directory that still holds an inventoried file", async () => {
    const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
    const full = await analyzeImports(dir, inventory, { language: "go" });
    expect(edgePairs(full.edges)).toEqual(["main.go->util", "other.go->util"]);

    const incremental = await analyzeImports(dir, inventory, {
      language: "go",
      previousImports: full,
      changedFiles: new Set(["main.go"]),
      fileSetChanged: false,
    });

    expect(incremental.edges).toEqual(full.edges);
  });

  it("keeps an unchanged file's edge to the module root package", async () => {
    await writeFile(join(dir, "util", "root.go"), 'package util\n\nimport "example.com/app"\n\nfunc Root() { app.Name() }\n');
    await writeFile(join(dir, "name.go"), "package main\n\nfunc Name() {}\n");
    const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
    const full = await analyzeImports(dir, inventory, { language: "go" });
    // The regex parser points this edge at "" (the root package); the Go pack
    // resolves it to the files that declare the names used.
    expect(full.edges.some((e) => e.from === "util/root.go")).toBe(true);

    const incremental = await analyzeImports(dir, inventory, {
      language: "go",
      previousImports: full,
      changedFiles: new Set(["main.go"]),
      fileSetChanged: false,
    });

    expect(incremental.edges).toEqual(full.edges);
  });

  it("drops edges to a package directory whose files are no longer inventoried", async () => {
    const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
    const full = await analyzeImports(dir, inventory, { language: "go" });

    // util/ pruned from the inventory (e.g. by .sourcevisionignore) without
    // showing up as deleted, as in #744.
    const pruned = { ...inventory, files: inventory.files.filter((f) => !f.path.startsWith("util/")) };
    const incremental = await analyzeImports(dir, pruned, {
      language: "go",
      previousImports: full,
      changedFiles: new Set(),
      fileSetChanged: false,
    });

    expect(incremental.edges.some((e) => e.to === "util")).toBe(false);
  });

  // The regex parser runs for every Go file when the pack is degraded (its
  // grammar not built, the default for a local checkout), so this suite must
  // hold on that path whether or not the grammar is built here: `packs: []`
  // selects it explicitly.
  it("drops the edge on a full run through the regex parser too, keeping the import as an external", async () => {
    const inventory = await analyzeInventory(dir, { languageConfig: goConfig });
    const pruned = { ...inventory, files: inventory.files.filter((f) => !f.path.startsWith("util/")) };
    const full = await analyzeImports(dir, pruned, { language: "go", packs: { packs: [] } });

    expect(full.edges.some((e) => e.to === "util")).toBe(false);
    expect(full.external.map((e) => e.package)).toContain("example.com/app/util");
  });
});
