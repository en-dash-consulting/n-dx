/**
 * The Go resolver over real go.mod / go.work projects, parsed with the Go
 * grammar. Deliberate differences from the regex parser are listed in the
 * header of src/language/go-resolver.ts and pinned here.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { grammarWasmPath } from "../../scripts/build-grammars.mjs";
import { extractGoImports } from "../../src/analyzers/go-imports.js";
import { goPack } from "../../src/language/go-pack.js";
import { goResolver } from "../../src/language/go-resolver.js";
import type { FileReferences, PackSourceFile } from "../../src/language/pack.js";
import { createTreeSitterRunner } from "../../src/language/runner.js";
import { skipUnlessGrammar } from "../helpers/grammar.js";
import { listFixtureFiles } from "../helpers/pack-golden.js";

const GO_WASM = grammarWasmPath("tree-sitter-go");
const FIXTURES = join(import.meta.dirname, "../fixtures");
const RESOLVER_FIXTURE = join(FIXTURES, "go-resolver");
const GO_PROJECT = join(FIXTURES, "go-project");

/** Parse a project's .go files (vendor/ skipped, as the inventory does) and bind the resolver to it. */
async function resolveProject(
  ctx: Parameters<typeof skipUnlessGrammar>[0],
  dir: string,
  maxFileBytes?: number,
): Promise<{ paths: string[]; resolve: (path: string) => FileReferences }> {
  skipUnlessGrammar(ctx, GO_WASM);
  const paths = listFixtureFiles(dir, [".go"]).filter((p) => !p.split("/").includes("vendor"));
  const runner = createTreeSitterRunner({ maxFileBytes });
  try {
    const files: PackSourceFile[] = [];
    const unparsed: string[] = [];
    for (const path of paths) {
      const result = await runner.parseFile({ pack: goPack, grammarPath: GO_WASM }, join(dir, path));
      if (result.status === "parsed") files.push({ path, captures: result.captures });
      else unparsed.push(path);
    }
    const prepared = (await goResolver.forProject!(dir)).prepare(files, unparsed);
    return { paths, resolve: (path) => prepared.resolve(path) };
  } finally {
    runner.dispose();
  }
}

const targets = (refs: FileReferences): Record<string, readonly string[]> =>
  Object.fromEntries(refs.files.map((f) => [f.to, f.symbols]));

describe("go resolver — workspace, replaces and vendor", () => {
  it("resolves module paths, go.work modules and local replaces to package directories", async (ctx) => {
    const { resolve } = await resolveProject(ctx, RESOLVER_FIXTURE);
    expect(targets(resolve("api/cmd/server/main.go"))).toEqual({
      // The file's own module, its root package and an aliased import.
      api: ["*"],
      "api/internal/store": ["store"],
      // A module the go.work uses.
      "lib/greet": ["*"],
      // go.mod `replace github.com/acme/kit => ../kit`.
      "kit/log": ["*"],
      // go.work `replace example.com/shared => ./shared`.
      shared: ["*"],
      // example.com/ws/api/internal/missing has no files: dropped.
    });
  });

  it("classifies the rest as stdlib or third-party, attributed to module and version", async (ctx) => {
    const { resolve } = await resolveProject(ctx, RESOLVER_FIXTURE);
    expect(resolve("api/cmd/server/main.go").external).toEqual([
      // The replace target leaves the project, so the module stays external.
      { package: "example.com/outside/pkg", symbols: ["*"] },
      { package: "github.com/go-chi/chi/v5/middleware", symbols: ["*"], module: { path: "github.com/go-chi/chi/v5", version: "v5.0.10" } },
      { package: "github.com/unknown/dep", symbols: ["*"] },
      // Attributed through vendor/modules.txt.
      { package: "github.com/vendored/thing/sub", symbols: ["*"], module: { path: "github.com/vendored/thing", version: "v0.3.1" } },
      // The versioned replace supplies v0.15.0.
      { package: "golang.org/x/text/language", symbols: ["*"], module: { path: "golang.org/x/text", version: "v0.15.0" } },
      { package: "stdlib:fmt", symbols: ["*"] },
    ]);
  });

  it("scopes a module outside the workspace to its own go.mod", async (ctx) => {
    const { resolve } = await resolveProject(ctx, RESOLVER_FIXTURE);
    expect(resolve("tools/main.go")).toEqual({
      files: [{ to: "tools/internal/x", symbols: ["*"] }],
      external: [{ package: "example.com/ws/lib/greet", symbols: ["*"], module: { path: "example.com/ws/lib", version: "v0.1.0" } }],
    });
  });

  it("matches project modules before the stdlib check, so a dotless module path is internal", async (ctx) => {
    const { resolve } = await resolveProject(ctx, RESOLVER_FIXTURE);
    expect(resolve("plain/main.go")).toEqual({ files: [{ to: "plain/util", symbols: ["*"] }], external: [] });
  });
});

describe("go resolver — root package", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sv-go-resolver-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("targets the root package's non-test files, since a directory edge to the root matches nothing", async (ctx) => {
    mkdirSync(join(dir, "cmd"));
    writeFileSync(join(dir, "go.mod"), "module example.com/root\n");
    writeFileSync(join(dir, "root.go"), "package root\n");
    writeFileSync(join(dir, "root_test.go"), "package root\n");
    writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport "example.com/root"\n');
    const { resolve } = await resolveProject(ctx, dir);
    expect(resolve("cmd/main.go").files).toEqual([{ to: "root.go", symbols: ["*"] }]);
  });

  it("keeps the edge to a package whose only file the runner skipped as oversized", async (ctx) => {
    mkdirSync(join(dir, "api", "pb"), { recursive: true });
    mkdirSync(join(dir, "cmd"));
    writeFileSync(join(dir, "go.mod"), "module example.com/root\n");
    writeFileSync(join(dir, "api", "pb", "api.pb.go"), `package pb\n\n// ${"x".repeat(2000)}\n`);
    writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport "example.com/root/api/pb"\n');
    const { resolve } = await resolveProject(ctx, dir, 1000);
    expect(resolve("cmd/main.go").files).toEqual([{ to: "api/pb", symbols: ["*"] }]);
  });

  it("still drops an import of a directory with no .go files", async (ctx) => {
    mkdirSync(join(dir, "api", "docs"), { recursive: true });
    mkdirSync(join(dir, "cmd"));
    writeFileSync(join(dir, "go.mod"), "module example.com/root\n");
    writeFileSync(join(dir, "api", "docs", "README.md"), "docs\n");
    writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport _ "example.com/root/api/docs"\n');
    const { resolve } = await resolveProject(ctx, dir);
    expect(resolve("cmd/main.go").files).toEqual([]);
  });

  it("knows no module before it is bound to a project", async (ctx) => {
    skipUnlessGrammar(ctx, GO_WASM);
    const runner = createTreeSitterRunner();
    try {
      const result = await runner.parseSource({ pack: goPack, grammarPath: GO_WASM }, "a/a.go", 'package a\n\nimport "example.com/root/b"\n');
      if (result.status !== "parsed") throw new Error("not parsed");
      const refs = goResolver.prepare([{ path: "a/a.go", captures: result.captures }]).resolve("a/a.go");
      expect(refs).toEqual({ files: [], external: [{ package: "example.com/root/b", symbols: ["*"] }] });
    } finally {
      runner.dispose();
    }
  });
});

describe("go resolver — parity with the regex parser", () => {
  it("produces the regex parser's edges and external packages for a single-module project", async (ctx) => {
    const { paths, resolve } = await resolveProject(ctx, GO_PROJECT);
    const modulePath = "github.com/example/go-project";

    const regexEdges: string[] = [];
    const regexExternal: string[] = [];
    const packEdges: string[] = [];
    const packExternal: string[] = [];
    for (const path of paths) {
      const regex = extractGoImports(readFileSync(join(GO_PROJECT, path), "utf8"), path, modulePath);
      regexEdges.push(...regex.edges.map((e) => `${e.from} -> ${e.to} [${e.symbols.join(",")}]`));
      regexExternal.push(...regex.external.map((e) => `${path} -> ${e.package} [${e.symbols.join(",")}]`));
      const refs = resolve(path);
      packEdges.push(...refs.files.map((f) => `${path} -> ${f.to} [${f.symbols.join(",")}]`));
      packExternal.push(...refs.external.map((e) => `${path} -> ${e.package} [${e.symbols.join(",")}]`));
    }
    expect(packEdges.sort()).toEqual(regexEdges.sort());
    expect(packExternal.sort()).toEqual(regexExternal.sort());
    expect(packEdges.length).toBeGreaterThan(0);
  });
});
