/**
 * The Go pack and sourcevision's regex import parser agree on a single-module
 * project. Where they deliberately differ is pinned in `@n-dx/lang-go`'s
 * resolver tests and listed in its `src/go-resolver.ts`.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { extractGoImports } from "../../src/analyzers/go-imports.js";
import { skipUnlessPackRuns, workspacePack } from "../helpers/workspace-pack.js";

const GO_PROJECT = join(import.meta.dirname, "../fixtures/go-project");

/** The project's .go files, project-relative, vendor/ skipped as the inventory does. */
function goFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".go"))
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.split("/").includes("vendor"))
    .sort();
}

describe("go pack — parity with the regex parser", () => {
  it("produces the regex parser's edges and external packages for a single-module project", async (ctx) => {
    await skipUnlessPackRuns(ctx, "go");
    const pack = await workspacePack("go");
    const paths = goFiles(GO_PROJECT);
    const result = await pack.analyzeProject({ projectDir: GO_PROJECT, files: paths, kinds: ["imports"] });
    expect(result.degraded).toBeUndefined();
    const modulePath = "github.com/example/go-project";

    const regexEdges: string[] = [];
    const regexExternal: string[] = [];
    for (const path of paths) {
      const regex = extractGoImports(readFileSync(join(GO_PROJECT, path), "utf8"), path, modulePath);
      regexEdges.push(...regex.edges.map((e) => `${e.from} -> ${e.to} [${e.symbols.join(",")}]`));
      regexExternal.push(...regex.external.map((e) => `${path} -> ${e.package} [${e.symbols.join(",")}]`));
    }
    const packEdges = result.facts.flatMap((f) => (f.imports?.files ?? []).map((r) => `${f.path} -> ${r.to} [${r.symbols.join(",")}]`));
    const packExternal = result.facts.flatMap((f) =>
      (f.imports?.external ?? []).map((e) => `${f.path} -> ${e.package} [${e.symbols.join(",")}]`),
    );
    expect(packEdges.sort()).toEqual(regexEdges.sort());
    expect(packExternal.sort()).toEqual(regexExternal.sort());
    expect(packEdges.length).toBeGreaterThan(0);
  });
});
