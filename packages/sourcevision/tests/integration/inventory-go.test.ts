import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { goConfig } from "../../src/language/go.js";

const GO_FIXTURE = join(import.meta.dirname, "../fixtures/go-project");

describe("analyzeInventory — Go fixture project", () => {
  // Pre-resolve language config to avoid auto-detection picking up the
  // monorepo's package.json instead of the fixture's go.mod.
  const opts = { languageConfig: goConfig };

  it("inventories the Go fixture without errors", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    expect(inv.files.length).toBeGreaterThan(0);
    expect(inv.summary.totalFiles).toBeGreaterThan(0);
  });

  // ── Role classification ──────────────────────────────────────────────

  it("classifies cmd/api/main.go as source", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const entry = inv.files.find((f) => f.path === "cmd/api/main.go");
    expect(entry).toBeDefined();
    expect(entry!.role).toBe("source");
  });

  it("classifies internal/handler/user_test.go as test", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const entry = inv.files.find((f) => f.path === "internal/handler/user_test.go");
    expect(entry).toBeDefined();
    expect(entry!.role).toBe("test");
  });

  it("classifies all _test.go files as test", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const testFiles = inv.files.filter((f) => f.path.endsWith("_test.go"));
    expect(testFiles.length).toBe(4); // handler, service, repository, response
    for (const f of testFiles) {
      expect(f.role).toBe("test");
    }
  });

  it("classifies internal source files as source", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);

    for (const path of [
      "internal/handler/user.go",
      "internal/service/user.go",
      "internal/repository/user.go",
      "internal/middleware/auth.go",
      "internal/middleware/logging.go",
      "internal/config/config.go",
      "pkg/response/json.go",
    ]) {
      const entry = inv.files.find((f) => f.path === path);
      expect(entry, `expected ${path} in inventory`).toBeDefined();
      expect(entry!.role, `expected ${path} role to be source`).toBe("source");
    }
  });

  it("classifies go.mod as config", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const entry = inv.files.find((f) => f.path === "go.mod");
    expect(entry).toBeDefined();
    expect(entry!.role).toBe("config");
  });

  it("classifies go.sum as generated (lockfile)", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const entry = inv.files.find((f) => f.path === "go.sum");
    expect(entry).toBeDefined();
    expect(entry!.role).toBe("generated");
  });

  it("classifies .golangci.yml as config", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const entry = inv.files.find((f) => f.path === ".golangci.yml");
    expect(entry).toBeDefined();
    expect(entry!.role).toBe("config");
  });

  it("classifies testdata/users.json as asset (Go testdata convention)", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const entry = inv.files.find((f) => f.path === "testdata/users.json");
    expect(entry).toBeDefined();
    expect(entry!.role).toBe("asset");
  });

  // ── Language detection ───────────────────────────────────────────────

  it("detects .go files as Go language", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const goFiles = inv.files.filter((f) => f.path.endsWith(".go"));
    expect(goFiles.length).toBeGreaterThan(0);
    for (const f of goFiles) {
      expect(f.language).toBe("Go");
    }
  });

  // ── vendor/ skip ────────────────────────────────────────────────────

  it("skips vendor/ directory entirely from inventory", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);
    const vendorFiles = inv.files.filter((f) => f.path.startsWith("vendor/"));
    expect(vendorFiles).toHaveLength(0);
  });

  // ── Category derivation ─────────────────────────────────────────────

  it("derives correct categories for Go paths", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);

    // "cmd" is not a generic prefix, so it's the first meaningful segment
    const mainEntry = inv.files.find((f) => f.path === "cmd/api/main.go");
    expect(mainEntry).toBeDefined();
    expect(mainEntry!.category).toBe("cmd");

    // "internal" IS a generic prefix, so it's skipped → "handler" is the category
    const handlerEntry = inv.files.find((f) => f.path === "internal/handler/user.go");
    expect(handlerEntry).toBeDefined();
    expect(handlerEntry!.category).toBe("handler");
  });

  // ── Summary counts ──────────────────────────────────────────────────

  it("summary counts are consistent with file entries", async () => {
    const inv = await analyzeInventory(GO_FIXTURE, opts);

    expect(inv.summary.totalFiles).toBe(inv.files.length);

    // Go files should dominate the language breakdown
    expect(inv.summary.byLanguage["Go"]).toBeGreaterThan(0);

    // Should have multiple roles represented
    expect(inv.summary.byRole["source"]).toBeGreaterThan(0);
    expect(inv.summary.byRole["test"]).toBeGreaterThan(0);
    expect(inv.summary.byRole["config"]).toBeGreaterThan(0);
  });

  // ── Determinism ─────────────────────────────────────────────────────

  it("produces deterministic output across runs", async () => {
    const run1 = await analyzeInventory(GO_FIXTURE, opts);
    const run2 = await analyzeInventory(GO_FIXTURE, opts);
    expect(run1).toEqual(run2);
  });
});
