/**
 * Scanner tests.
 *
 * The scanner is the path the standalone skill takes on a repository that has
 * never been analyzed, so it is the piece most likely to meet strange input.
 * These tests run against real temp directories rather than mocks — the whole
 * job is filesystem shape, and a mocked fs would test nothing.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanProject,
  extractSpecs,
  looksLikeSpec,
  packageName,
  isStdlib,
  zoneKeyFor,
  zoneName,
  inferFileKind,
  buildAliasMap,
  walkSources,
} from "../../../src/export/iso-scan.js";

function makeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "iso-scan-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf-8");
  }
  return root;
}

// ── Specifier handling ──────────────────────────────────────────────────────

describe("extractSpecs", () => {
  it("finds every JavaScript import form", () => {
    const specs = extractSpecs(
      [
        `import a from "./a";`,
        `import "./side-effect";`,
        `export { b } from "./b";`,
        `const c = require("./c");`,
        `const d = await import("./d");`,
      ].join("\n"),
      ".ts",
    );
    expect(specs.sort()).toEqual(["./a", "./b", "./c", "./d", "./side-effect"]);
  });

  it("reads Go imports only from real import statements", () => {
    // The stray quoted string must not become a dependency: an earlier version
    // matched any standalone quoted line and invented a ", " package.
    const go = [
      `package main`,
      `import (`,
      `  "fmt"`,
      `  alias "github.com/example/pkg"`,
      `)`,
      `func f() { strings.Join(x,`,
      `  ", ")`,
      `}`,
    ].join("\n");
    const specs = extractSpecs(go, ".go");
    expect(specs.sort()).toEqual(["fmt", "github.com/example/pkg"]);
    expect(specs).not.toContain(", ");
  });

  it("reads a single-line Go import", () => {
    expect(extractSpecs(`import "os"`, ".go")).toEqual(["os"]);
  });

  it("reads Python imports", () => {
    const specs = extractSpecs(`from a.b import c\nimport os\n`, ".py");
    expect(specs.sort()).toEqual(["a.b", "os"]);
  });
});

describe("looksLikeSpec", () => {
  it("accepts module specifiers and rejects arbitrary text", () => {
    for (const good of ["./a", "../b/c", "@scope/pkg", "lodash", "github.com/x/y", "~/alias"]) {
      expect(looksLikeSpec(good)).toBe(true);
    }
    for (const bad of ["", ", ", "hello world", "a,b", "x".repeat(300)]) {
      expect(looksLikeSpec(bad)).toBe(false);
    }
  });
});

describe("packageName", () => {
  it("keeps the scope for npm packages", () => {
    expect(packageName("@n-dx/rex/dist/x")).toBe("@n-dx/rex");
  });

  it("keeps host/owner/repo for Go module paths", () => {
    // "github.com" alone is a host, not a dependency.
    expect(packageName("github.com/gorilla/mux/v2")).toBe("github.com/gorilla/mux");
  });

  it("takes the first segment for a plain package", () => {
    expect(packageName("lodash/fp")).toBe("lodash");
  });
});

describe("isStdlib", () => {
  it("recognizes builtins across the supported languages", () => {
    for (const spec of ["node:fs", "fs", "path", "encoding/json", "fmt", "os"]) {
      expect(isStdlib(spec)).toBe(true);
    }
    expect(isStdlib("lodash")).toBe(false);
    expect(isStdlib("github.com/x/y")).toBe(false);
  });
});

// ── Zone grouping ───────────────────────────────────────────────────────────

describe("zoneKeyFor", () => {
  it("uses the package directory inside a workspace container", () => {
    expect(zoneKeyFor("packages/web/src/a.ts", 0)).toBe("packages/web");
  });

  it("uses the directory below a source root", () => {
    expect(zoneKeyFor("src/api/a.ts", 0)).toBe("src/api");
  });

  it("uses the top-level directory otherwise", () => {
    expect(zoneKeyFor("scripts/a.ts", 0)).toBe("scripts");
  });

  it("never consumes the filename as a zone segment", () => {
    expect(zoneKeyFor("src/a.ts", 0)).toBe("src");
    expect(zoneKeyFor("a.ts", 0)).toBe("(root)");
  });
});

describe("zoneName", () => {
  it("drops the workspace container and source root", () => {
    expect(zoneName("packages/rex")).toBe("Rex");
    expect(zoneName("packages/web/src")).toBe("Web");
    expect(zoneName("src/api")).toBe("Api");
  });

  it("keeps a single segment even when it is a container word", () => {
    expect(zoneName("packages")).toBe("Packages");
    expect(zoneName("(root)")).toBe("Root");
  });

  it("title-cases dashed and underscored names", () => {
    expect(zoneName("packages/llm-client")).toBe("Llm Client");
  });
});

describe("inferFileKind", () => {
  it("recognizes tests by directory and by filename", () => {
    expect(inferFileKind("tests/unit/a.ts")).toBe("tests");
    expect(inferFileKind("src/a.test.ts")).toBe("tests");
    expect(inferFileKind("internal/handler/user_test.go")).toBe("tests");
  });

  it("maps conventional directories to kinds", () => {
    expect(inferFileKind("src/routes/user.ts")).toBe("entry");
    expect(inferFileKind("src/components/Button.tsx")).toBe("ui");
    expect(inferFileKind("src/models/user.ts")).toBe("data");
    expect(inferFileKind("src/gateways/rex.ts")).toBe("gateway");
    expect(inferFileKind("src/services/bill.ts")).toBe("logic");
    expect(inferFileKind("src/utils/str.ts")).toBe("support");
  });

  it("falls back to support for an unrecognized path", () => {
    expect(inferFileKind("src/whatever/thing.ts")).toBe("support");
  });
});

// ── Alias resolution ────────────────────────────────────────────────────────

describe("buildAliasMap", () => {
  let root: string;
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it("reads tsconfig paths, including JSONC with comments and trailing commas", () => {
    root = makeProject({
      "tsconfig.json": `{
        // a comment
        "compilerOptions": {
          "baseUrl": ".",
          "paths": { "@app/*": ["src/*"], },
        },
      }`,
      "src/a.ts": "",
    });
    const map = buildAliasMap(root, walkSources(root));
    expect(map.prefixes.some((p) => p.from === "@app" && p.to === "src")).toBe(true);
  });

  it("maps workspace package names to their directories", () => {
    const dir = makeProject({
      "packages/rex/package.json": `{"name":"@scope/rex"}`,
      "packages/rex/src/a.ts": "",
    });
    const map = buildAliasMap(dir, walkSources(dir));
    expect(map.prefixes.some((p) => p.from === "@scope/rex" && p.to === "packages/rex")).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});

// ── End-to-end scanning ─────────────────────────────────────────────────────

describe("scanProject", () => {
  it("returns nothing for a directory with no source", () => {
    const dir = makeProject({ "README.md": "# hi" });
    const scan = scanProject(dir);
    expect(scan.zones).toEqual([]);
    expect(scan.totalFiles).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("skips build output and node_modules", () => {
    const dir = makeProject({
      "src/a.ts": "export const a = 1;",
      "src/b.ts": "export const b = 1;",
      "src/c.ts": "export const c = 1;",
      "node_modules/dep/index.js": "module.exports = {};",
      "dist/a.js": "export const a = 1;",
    });
    const scan = scanProject(dir);
    const paths = [...scan.fileMeta.keys()];
    expect(paths.every((p) => !p.includes("node_modules") && !p.startsWith("dist/"))).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it("honours plain directory names in .gitignore", () => {
    const dir = makeProject({
      ".gitignore": "generated\n",
      "src/a.ts": "export const a = 1;",
      "src/b.ts": "export const b = 1;",
      "src/c.ts": "export const c = 1;",
      "generated/x.ts": "export const x = 1;",
    });
    const scan = scanProject(dir);
    expect([...scan.fileMeta.keys()].some((p) => p.startsWith("generated/"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves relative imports into cross-zone edges", () => {
    const dir = makeProject({
      "src/api/a.ts": `import { c } from "../core/c";`,
      "src/api/b.ts": "export const b = 1;",
      "src/api/d.ts": "export const d = 1;",
      "src/core/c.ts": "export const c = 1;",
      "src/core/e.ts": "export const e = 1;",
      "src/core/f.ts": "export const f = 1;",
    });
    const scan = scanProject(dir);
    expect(scan.crossings).toContainEqual({ fromZone: "src/api", toZone: "src/core" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a .js specifier to its TypeScript source", () => {
    const dir = makeProject({
      "src/api/a.ts": `import { c } from "../core/c.js";`,
      "src/api/b.ts": "", "src/api/d.ts": "",
      "src/core/c.ts": "export const c = 1;",
      "src/core/e.ts": "", "src/core/f.ts": "",
    });
    const scan = scanProject(dir);
    expect(scan.crossings).toContainEqual({ fromZone: "src/api", toZone: "src/core" });
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a tsconfig path alias rather than calling it third-party", () => {
    const dir = makeProject({
      "tsconfig.json": `{"compilerOptions":{"baseUrl":".","paths":{"@app/*":["src/*"]}}}`,
      "src/api/a.ts": `import { c } from "@app/core/c";`,
      "src/api/b.ts": "", "src/api/d.ts": "",
      "src/core/c.ts": "export const c = 1;",
      "src/core/e.ts": "", "src/core/f.ts": "",
    });
    const scan = scanProject(dir);
    expect(scan.aliasCount).toBeGreaterThan(0);
    expect(scan.crossings).toContainEqual({ fromZone: "src/api", toZone: "src/core" });
    expect(scan.external.some((e) => e.package.startsWith("@app"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves a workspace package import to the sibling package", () => {
    const dir = makeProject({
      "packages/web/package.json": `{"name":"@scope/web"}`,
      "packages/web/src/a.ts": `import { r } from "@scope/rex";`,
      "packages/web/src/b.ts": "", "packages/web/src/c.ts": "",
      "packages/rex/package.json": `{"name":"@scope/rex"}`,
      "packages/rex/src/index.ts": "export const r = 1;",
      "packages/rex/src/d.ts": "", "packages/rex/src/e.ts": "",
    });
    const scan = scanProject(dir);
    expect(scan.crossings.some((c) => c.toZone.startsWith("packages/rex"))).toBe(true);
    expect(scan.external.some((e) => e.package === "@scope/rex")).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves Go intra-module imports through go.mod", () => {
    const dir = makeProject({
      "go.mod": "module github.com/example/app\n\ngo 1.21\n",
      "cmd/api/main.go": `package main\nimport "github.com/example/app/internal/svc"\n`,
      "cmd/api/a.go": "package main\n",
      "cmd/api/b.go": "package main\n",
      "internal/svc/svc.go": "package svc\n",
      "internal/svc/a.go": "package svc\n",
      "internal/svc/b.go": "package svc\n",
    });
    const scan = scanProject(dir);
    expect(scan.crossings.length).toBeGreaterThan(0);
    // The module's own path must not show up as a third-party dependency.
    expect(scan.external.some((e) => e.package.includes("example/app"))).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("keeps the standard library out of the dependency list", () => {
    const dir = makeProject({
      "src/a.ts": `import { readFileSync } from "node:fs";\nimport lodash from "lodash";`,
      "src/b.ts": "", "src/c.ts": "",
    });
    const scan = scanProject(dir);
    expect(scan.external.map((e) => e.package)).toEqual(["lodash"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("computes cohesion from internal versus outgoing edges", () => {
    const dir = makeProject({
      "src/core/a.ts": `import { b } from "./b";`,
      "src/core/b.ts": "export const b = 1;",
      "src/core/c.ts": "export const c = 1;",
    });
    const scan = scanProject(dir);
    const core = scan.zones.find((z) => z.id === "src/core")!;
    expect(core.cohesion).toBe(1);
    expect(core.coupling).toBe(0);
    rmSync(dir, { recursive: true, force: true });
  });

  it("never produces two zones with the same display name", () => {
    const dir = makeProject({
      "packages/web/vite.config.ts": "export default {};",
      "packages/web/src/a.ts": "", "packages/web/src/b.ts": "",
      "packages/web/src/c.ts": "", "packages/web/src/d.ts": "",
    });
    const scan = scanProject(dir);
    const names = scan.zones.map((z) => z.name);
    expect(new Set(names).size).toBe(names.length);
    rmSync(dir, { recursive: true, force: true });
  });

  it("is reproducible across repeated scans", () => {
    const dir = makeProject({
      "src/api/a.ts": `import { c } from "../core/c";`,
      "src/api/b.ts": "", "src/api/d.ts": "",
      "src/core/c.ts": "export const c = 1;",
      "src/core/e.ts": "", "src/core/f.ts": "",
    });
    const first = scanProject(dir);
    const second = scanProject(dir);
    expect(JSON.stringify(first.zones)).toBe(JSON.stringify(second.zones));
    expect(JSON.stringify(first.crossings)).toBe(JSON.stringify(second.crossings));
    rmSync(dir, { recursive: true, force: true });
  });
});
