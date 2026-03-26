import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { goConfig } from "../../src/language/go.js";
import type { Imports } from "../../src/schema/v1.js";

const GO_FIXTURE = join(import.meta.dirname, "../fixtures/go-project");

describe("analyzeImports — Go fixture project", () => {
  let result: Imports;

  beforeAll(async () => {
    // Pre-resolve language config to avoid auto-detection picking up the
    // monorepo's package.json instead of the fixture's go.mod.
    const inv = await analyzeInventory(GO_FIXTURE, { languageConfig: goConfig });
    result = await analyzeImports(GO_FIXTURE, inv, { language: "go" });
  });

  // ── Internal edges ─────────────────────────────────────────────────────────

  it("produces the four expected internal edges", () => {
    const expected = [
      { from: "cmd/api/main.go", to: "internal/handler" },
      { from: "cmd/api/main.go", to: "internal/config" },
      { from: "internal/handler/user.go", to: "internal/service" },
      { from: "internal/service/user.go", to: "internal/repository" },
    ];

    for (const { from, to } of expected) {
      const edge = result.edges.find((e) => e.from === from && e.to === to);
      expect(edge, `expected edge ${from} → ${to}`).toBeDefined();
      expect(edge!.type).toBe("static");
      expect(edge!.symbols).toEqual(["*"]);
    }
  });

  it("all internal edges have type 'static'", () => {
    for (const edge of result.edges) {
      expect(edge.type).toBe("static");
    }
  });

  it("total internal edge count matches expected", () => {
    // main→handler, main→config, handler→service, service→repository,
    // json_test.go→pkg/response (dot import from external test package)
    expect(result.edges).toHaveLength(5);
  });

  // ── Third-party external packages ──────────────────────────────────────────

  it("includes go-chi/chi/v5 as external third-party package", () => {
    const chi = result.external.find((e) => e.package === "github.com/go-chi/chi/v5");
    expect(chi, "expected chi in external packages").toBeDefined();
    expect(chi!.importedBy).toContain("cmd/api/router.go");
    expect(chi!.symbols).toEqual(["*"]);
  });

  it("includes jmoiron/sqlx as external third-party package", () => {
    const sqlx = result.external.find((e) => e.package === "github.com/jmoiron/sqlx");
    expect(sqlx, "expected sqlx in external packages").toBeDefined();
    expect(sqlx!.importedBy).toContain("internal/repository/db.go");
    expect(sqlx!.symbols).toEqual(["*"]);
  });

  it("includes lib/pq as external third-party package (blank import)", () => {
    const pq = result.external.find((e) => e.package === "github.com/lib/pq");
    expect(pq, "expected lib/pq in external packages").toBeDefined();
    expect(pq!.importedBy).toContain("internal/repository/drivers.go");
    expect(pq!.symbols).toEqual(["*"]);
  });

  it("includes chi/v5/middleware as external (aliased import)", () => {
    const chimw = result.external.find(
      (e) => e.package === "github.com/go-chi/chi/v5/middleware",
    );
    expect(chimw, "expected chi/v5/middleware in external packages").toBeDefined();
    expect(chimw!.importedBy).toContain("cmd/api/setup.go");
    expect(chimw!.symbols).toEqual(["*"]);
  });

  it("third-party entries are not prefixed with 'stdlib:'", () => {
    const thirdParty = result.external.filter(
      (e) => !e.package.startsWith("stdlib:"),
    );
    expect(thirdParty.length).toBeGreaterThanOrEqual(2);
    for (const entry of thirdParty) {
      expect(entry.package).not.toMatch(/^stdlib:/);
    }
  });

  // ── Stdlib external packages ───────────────────────────────────────────────

  it("includes expected stdlib packages with 'stdlib:' prefix", () => {
    const stdlibNames = result.external
      .filter((e) => e.package.startsWith("stdlib:"))
      .map((e) => e.package)
      .sort();

    // Every stdlib package imported by any .go file in the fixture
    const expected = [
      "stdlib:database/sql",
      "stdlib:encoding/json",
      "stdlib:fmt",
      "stdlib:log",
      "stdlib:net/http",
      "stdlib:net/http/httptest",
      "stdlib:os",
      "stdlib:strings",
      "stdlib:testing",
      "stdlib:time",
    ];

    for (const pkg of expected) {
      expect(stdlibNames, `expected ${pkg} in stdlib entries`).toContain(pkg);
    }
  });

  it("stdlib:net/http is imported by multiple source and test files", () => {
    const netHttp = result.external.find((e) => e.package === "stdlib:net/http");
    expect(netHttp).toBeDefined();
    // At minimum: main.go, setup.go, handler/user.go, middleware/auth.go,
    // middleware/logging.go, pkg/response/json.go, handler/user_test.go,
    // pkg/response/json_test.go
    expect(netHttp!.importedBy.length).toBeGreaterThanOrEqual(7);
    expect(netHttp!.importedBy).toContain("cmd/api/main.go");
    expect(netHttp!.importedBy).toContain("internal/handler/user.go");
    expect(netHttp!.importedBy).toContain("internal/middleware/auth.go");
  });

  it("stdlib:fmt is imported only by cmd/api/main.go", () => {
    const fmt = result.external.find((e) => e.package === "stdlib:fmt");
    expect(fmt).toBeDefined();
    expect(fmt!.importedBy).toEqual(["cmd/api/main.go"]);
  });

  it("all external entries have symbols array", () => {
    for (const entry of result.external) {
      expect(entry.symbols).toBeDefined();
      expect(entry.symbols.length).toBeGreaterThan(0);
    }
  });

  // ── _test.go import handling ───────────────────────────────────────────────
  //
  // The import analyzer includes _test.go files in the analysis. Their stdlib
  // imports appear as regular external entries alongside source file imports.
  // This behavior is intentional — it provides a complete dependency surface
  // including the test infrastructure.
  //

  it("captures imports from _test.go files (test imports are included)", () => {
    const testing = result.external.find((e) => e.package === "stdlib:testing");
    expect(testing, "expected stdlib:testing in external packages").toBeDefined();
    // All four test files import "testing"
    expect(testing!.importedBy).toContain("internal/handler/user_test.go");
    expect(testing!.importedBy).toContain("internal/service/user_test.go");
    expect(testing!.importedBy).toContain("internal/repository/user_test.go");
    expect(testing!.importedBy).toContain("pkg/response/json_test.go");
  });

  it("_test.go imports contribute to stdlib entries (net/http/httptest)", () => {
    const httptest = result.external.find(
      (e) => e.package === "stdlib:net/http/httptest",
    );
    expect(httptest).toBeDefined();
    // handler/user_test.go and pkg/response/json_test.go import httptest
    expect(httptest!.importedBy).toContain("internal/handler/user_test.go");
    expect(httptest!.importedBy).toContain("pkg/response/json_test.go");
  });

  it("_test.go files that only import stdlib produce no internal edges", () => {
    // handler/user_test.go, service/user_test.go, repository/user_test.go
    // only import stdlib packages — no internal edges expected from them.
    // pkg/response/json_test.go uses a dot import of the internal response
    // package, so it does produce an internal edge (tested separately).
    const stdlibOnlyTestFiles = [
      "internal/handler/user_test.go",
      "internal/service/user_test.go",
      "internal/repository/user_test.go",
    ];
    for (const file of stdlibOnlyTestFiles) {
      const edges = result.edges.filter((e) => e.from === file);
      expect(edges, `expected no edges from ${file}`).toHaveLength(0);
    }
  });

  it("dot-import _test.go produces an internal edge to its target package", () => {
    // pkg/response/json_test.go uses `. "github.com/example/go-project/pkg/response"`
    const edge = result.edges.find(
      (e) => e.from === "pkg/response/json_test.go" && e.to === "pkg/response",
    );
    expect(edge, "expected dot-import edge from json_test.go").toBeDefined();
  });

  // ── No phantom edges ──────────────────────────────────────────────────────

  it("does not produce edges to non-existent internal packages", () => {
    const validTargets = new Set([
      "internal/handler",
      "internal/service",
      "internal/repository",
      "internal/config",
      "internal/middleware",
      "pkg/response",
    ]);

    for (const edge of result.edges) {
      expect(
        validTargets.has(edge.to),
        `unexpected edge target: ${edge.to}`,
      ).toBe(true);
    }
  });

  it("does not produce edges from files that have no internal imports", () => {
    const filesWithNoInternalImports = [
      "internal/repository/user.go", // no imports at all
      "internal/repository/db.go", // only sqlx (third-party)
      "internal/repository/drivers.go", // only lib/pq (blank) + database/sql (stdlib)
      "cmd/api/router.go", // only chi (third-party)
      "cmd/api/setup.go", // only chi/middleware (aliased) + net/http (stdlib)
      "internal/config/config.go", // only os (stdlib)
      "internal/middleware/auth.go", // only net/http (stdlib)
      "internal/middleware/logging.go", // only stdlib
      "pkg/response/json.go", // only stdlib
    ];

    for (const filePath of filesWithNoInternalImports) {
      const fileEdges = result.edges.filter((e) => e.from === filePath);
      expect(fileEdges, `expected no edges from ${filePath}`).toHaveLength(0);
    }
  });

  // ── Summary consistency ────────────────────────────────────────────────────

  it("summary.totalEdges matches edges array length", () => {
    expect(result.summary.totalEdges).toBe(result.edges.length);
  });

  it("summary.totalExternal matches external array length", () => {
    expect(result.summary.totalExternal).toBe(result.external.length);
  });

  it("summary.circularCount is zero (the fixture has no circular deps)", () => {
    expect(result.summary.circularCount).toBe(0);
  });

  it("summary.avgImportsPerFile is a positive number", () => {
    expect(result.summary.avgImportsPerFile).toBeGreaterThan(0);
  });

  // ── Determinism ────────────────────────────────────────────────────────────

  it("produces deterministic output across runs", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, { languageConfig: goConfig });
    const result2 = await analyzeImports(GO_FIXTURE, inv, { language: "go" });
    expect(result2).toEqual(result);
  });
});
