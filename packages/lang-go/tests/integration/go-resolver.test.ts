/**
 * The Go resolver over real go.mod / go.work projects, parsed with the Go
 * grammar. Deliberate differences from sourcevision's regex parser are listed
 * in the header of src/go-resolver.ts and pinned here; parity with it on a
 * single-module project is tested in sourcevision
 * (tests/integration/go-pack-regex-parity.test.ts).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goGrammarPath, goPack } from "../../src/go-pack.js";
import { goResolver } from "../../src/go-resolver.js";
import {
  createTreeSitterRunner,
  listFixtureFiles,
  skipUnlessGrammar,
  type FileReferences,
  type PackSourceFile,
} from "@n-dx/lang-runtime";

const GO_WASM = goGrammarPath();
const RESOLVER_FIXTURE = join(import.meta.dirname, "../fixtures/go-resolver");

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
      // example.com/ws/api/internal/missing has no files: external, not an edge.
    });
  });

  it("classifies the rest as stdlib or third-party, attributed to module and version", async (ctx) => {
    const { resolve } = await resolveProject(ctx, RESOLVER_FIXTURE);
    expect(resolve("api/cmd/server/main.go").external).toEqual([
      // The replace target leaves the project, so the module stays external.
      { package: "example.com/outside/pkg", symbols: ["*"] },
      // Inside the module, but no .go file there.
      { package: "example.com/ws/api/internal/missing", symbols: ["*"] },
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

  it("records an import of a directory with no .go files as external, since no node exists for an edge", async (ctx) => {
    mkdirSync(join(dir, "api", "docs"), { recursive: true });
    mkdirSync(join(dir, "cmd"));
    writeFileSync(join(dir, "go.mod"), "module example.com/root\n");
    writeFileSync(join(dir, "api", "docs", "README.md"), "docs\n");
    writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport _ "example.com/root/api/docs"\n');
    const { resolve } = await resolveProject(ctx, dir);
    expect(resolve("cmd/main.go")).toEqual({ files: [], external: [{ package: "example.com/root/api/docs", symbols: ["*"] }] });
  });

  it("records a module replaced into a directory the inventory skips as external, attributed to its require", async (ctx) => {
    mkdirSync(join(dir, "cmd"));
    writeFileSync(
      join(dir, "go.mod"),
      "module example.com/root\n\nrequire github.com/foo/bar v1.2.3\n\nreplace github.com/foo/bar => ./third_party/bar\n",
    );
    writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport "github.com/foo/bar/baz"\n');
    // No third_party/bar/baz/*.go is passed to the resolver, as when the inventory skips third_party/.
    const { resolve } = await resolveProject(ctx, dir);
    expect(resolve("cmd/main.go")).toEqual({
      files: [],
      external: [{ package: "github.com/foo/bar/baz", symbols: ["*"], module: { path: "github.com/foo/bar", version: "v1.2.3" } }],
    });
  });

  it("attributes an import to a required module nested under the project's path, as Go's longest prefix does", async (ctx) => {
    mkdirSync(join(dir, "models"));
    writeFileSync(join(dir, "go.mod"), "module example.com/root\n\nrequire example.com/root/lib v1.3.0\n");
    writeFileSync(join(dir, "models", "m.go"), 'package models\n\nimport "example.com/root/lib/runner/v1"\n');
    const { resolve } = await resolveProject(ctx, dir);
    expect(resolve("models/m.go")).toEqual({
      files: [],
      external: [{ package: "example.com/root/lib/runner/v1", symbols: ["*"], module: { path: "example.com/root/lib", version: "v1.3.0" } }],
    });
  });

  it("keeps a nested required module internal when a local replace points it into the project", async (ctx) => {
    mkdirSync(join(dir, "lib", "x"), { recursive: true });
    mkdirSync(join(dir, "cmd"));
    writeFileSync(join(dir, "go.mod"), "module example.com/root\n\nrequire example.com/root/lib v1.3.0\n\nreplace example.com/root/lib => ./lib\n");
    writeFileSync(join(dir, "lib", "x", "x.go"), "package x\n");
    writeFileSync(join(dir, "cmd", "main.go"), 'package main\n\nimport "example.com/root/lib/x"\n');
    const { resolve } = await resolveProject(ctx, dir);
    expect(resolve("cmd/main.go")).toEqual({ files: [{ to: "lib/x", symbols: ["*"] }], external: [] });
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
