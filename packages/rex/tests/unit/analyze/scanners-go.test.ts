import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  scanTests,
  scanDocs,
  scanGoMod,
  parseGoMod,
} from "../../../src/analyze/scanners.js";

describe("Go scanner support", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "rex-go-scan-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  // ── SKIP_DIRS: vendor/ ──────────────────────────────────────────────

  describe("vendor/ directory skipping", () => {
    it("skips vendor/ directory during test scanning", async () => {
      // Create a test file inside vendor/ — should be ignored
      await mkdir(join(tempDir, "vendor", "github.com", "lib"), { recursive: true });
      await writeFile(
        join(tempDir, "vendor", "github.com", "lib", "lib_test.go"),
        "package lib\n",
      );

      // Create a test file outside vendor/ — should be found
      await mkdir(join(tempDir, "internal"), { recursive: true });
      await writeFile(
        join(tempDir, "internal", "handler_test.go"),
        "package internal\n",
      );

      const results = await scanTests(tempDir);
      const sourceFiles = results.flatMap((r) => r.sourceFile);

      expect(sourceFiles.some((f) => f.includes("vendor/"))).toBe(false);
      expect(results.length).toBeGreaterThan(0);
    });

    it("skips vendor/ directory during doc scanning", async () => {
      await mkdir(join(tempDir, "vendor", "pkg"), { recursive: true });
      await writeFile(
        join(tempDir, "vendor", "pkg", "README.md"),
        "# Vendored package\n- Item 1\n",
      );

      // Doc file outside vendor/ — should be found
      await writeFile(
        join(tempDir, "DESIGN.md"),
        "# Design\n- Feature A\n",
      );

      const results = await scanDocs(tempDir);
      const sourceFiles = results.map((r) => r.sourceFile);

      expect(sourceFiles.some((f) => f.includes("vendor/"))).toBe(false);
      expect(results.length).toBeGreaterThan(0);
    });

    it("skips vendor/ directory during go.mod scanning", async () => {
      // Vendored go.mod — should be ignored
      await mkdir(join(tempDir, "vendor", "submod"), { recursive: true });
      await writeFile(
        join(tempDir, "vendor", "submod", "go.mod"),
        "module vendored\n\ngo 1.20\n",
      );

      // Root go.mod — should be found
      await writeFile(
        join(tempDir, "go.mod"),
        "module example.com/myproject\n\ngo 1.21\n",
      );

      const results = await scanGoMod(tempDir);
      const sourceFiles = results.map((r) => r.sourceFile);

      expect(sourceFiles.some((f) => f.includes("vendor/"))).toBe(false);
      expect(results.some((r) => r.name === "example.com/myproject")).toBe(true);
    });
  });

  // ── SKIP_DOC_FILES: go.mod / go.sum ─────────────────────────────────

  describe("go.mod and go.sum are not scanned as docs", () => {
    it("does not treat go.mod as a doc file", async () => {
      await writeFile(
        join(tempDir, "go.mod"),
        "module example.com/project\n\ngo 1.21\n",
      );

      const results = await scanDocs(tempDir);
      const sourceFiles = results.map((r) => r.sourceFile);

      expect(sourceFiles).not.toContain("go.mod");
    });

    it("does not treat go.sum as a doc file", async () => {
      await writeFile(
        join(tempDir, "go.sum"),
        "github.com/lib/pq v1.10.9 h1:abc=\n",
      );

      const results = await scanDocs(tempDir);
      const sourceFiles = results.map((r) => r.sourceFile);

      expect(sourceFiles).not.toContain("go.sum");
    });

    it("still scans legitimate doc files in a Go project", async () => {
      await writeFile(join(tempDir, "go.mod"), "module example.com/project\n\ngo 1.21\n");
      await writeFile(join(tempDir, "go.sum"), "github.com/lib/pq v1.10.9 h1:abc=\n");
      await writeFile(join(tempDir, "DESIGN.md"), "# Design\n- Feature A\n");

      const results = await scanDocs(tempDir);
      const sourceFiles = results.map((r) => r.sourceFile);

      expect(sourceFiles).not.toContain("go.mod");
      expect(sourceFiles).not.toContain("go.sum");
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((r) => r.sourceFile === "DESIGN.md")).toBe(true);
    });
  });

  // ── _test.go detection ──────────────────────────────────────────────

  describe("_test.go test file detection", () => {
    it("detects _test.go files as test files", async () => {
      await writeFile(
        join(tempDir, "handler_test.go"),
        "package main\n",
      );

      const results = await scanTests(tempDir);

      expect(results.length).toBe(1);
      expect(results[0].source).toBe("test");
      expect(results[0].kind).toBe("feature");
      expect(results[0].name).toContain("Tests");
    });

    it("detects _test.go files in subdirectories", async () => {
      await mkdir(join(tempDir, "internal", "handler"), { recursive: true });
      await writeFile(
        join(tempDir, "internal", "handler", "handler_test.go"),
        "package handler\n",
      );

      const results = await scanTests(tempDir);

      expect(results.length).toBe(1);
      expect(results[0].source).toBe("test");
    });

    it("groups Go test files with JS/TS test files by epic", async () => {
      await mkdir(join(tempDir, "tests"), { recursive: true });
      await writeFile(join(tempDir, "tests", "app.test.ts"), "");
      await writeFile(join(tempDir, "tests", "app_test.go"), "package tests\n");

      const results = await scanTests(tempDir);

      // Both files are in the same directory, so grouped into one epic summary
      expect(results.length).toBe(1);
      expect(results[0].description).toContain("2 test files");
    });

    it("does not treat regular .go files as test files", async () => {
      await writeFile(join(tempDir, "main.go"), "package main\n");
      await writeFile(join(tempDir, "handler.go"), "package main\n");

      const results = await scanTests(tempDir);

      expect(results.length).toBe(0);
    });
  });

  // ── parseGoMod ──────────────────────────────────────────────────────

  describe("parseGoMod", () => {
    it("extracts module name, Go version, and dependencies", async () => {
      const goModContent = [
        "module github.com/example/myproject",
        "",
        "go 1.21",
        "",
        "require (",
        "\tgithub.com/go-chi/chi/v5 v5.0.10",
        "\tgithub.com/jmoiron/sqlx v1.3.5",
        "\tgithub.com/lib/pq v1.10.9",
        ")",
      ].join("\n");

      const goModPath = join(tempDir, "go.mod");
      await writeFile(goModPath, goModContent);

      const result = await parseGoMod(goModPath);

      expect(result).not.toBeNull();
      expect(result!.module).toBe("github.com/example/myproject");
      expect(result!.goVersion).toBe("1.21");
      expect(result!.dependencies).toEqual([
        { path: "github.com/go-chi/chi/v5", version: "v5.0.10" },
        { path: "github.com/jmoiron/sqlx", version: "v1.3.5" },
        { path: "github.com/lib/pq", version: "v1.10.9" },
      ]);
    });

    it("returns null for a missing go.mod", async () => {
      const result = await parseGoMod(join(tempDir, "nonexistent", "go.mod"));
      expect(result).toBeNull();
    });

    it("handles an empty require block", async () => {
      const goModContent = [
        "module github.com/example/empty",
        "",
        "go 1.22",
        "",
        "require (",
        ")",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const result = await parseGoMod(join(tempDir, "go.mod"));

      expect(result).not.toBeNull();
      expect(result!.module).toBe("github.com/example/empty");
      expect(result!.goVersion).toBe("1.22");
      expect(result!.dependencies).toEqual([]);
    });

    it("handles go.mod with no require block at all", async () => {
      const goModContent = [
        "module github.com/example/minimal",
        "",
        "go 1.20",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const result = await parseGoMod(join(tempDir, "go.mod"));

      expect(result).not.toBeNull();
      expect(result!.module).toBe("github.com/example/minimal");
      expect(result!.goVersion).toBe("1.20");
      expect(result!.dependencies).toEqual([]);
    });

    it("handles single-line require statements", async () => {
      const goModContent = [
        "module github.com/example/single",
        "",
        "go 1.21",
        "",
        "require github.com/pkg/errors v0.9.1",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const result = await parseGoMod(join(tempDir, "go.mod"));

      expect(result).not.toBeNull();
      expect(result!.dependencies).toEqual([
        { path: "github.com/pkg/errors", version: "v0.9.1" },
      ]);
    });

    it("handles mixed single-line and block require", async () => {
      const goModContent = [
        "module github.com/example/mixed",
        "",
        "go 1.21",
        "",
        "require github.com/pkg/errors v0.9.1",
        "",
        "require (",
        "\tgithub.com/go-chi/chi/v5 v5.0.10",
        ")",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const result = await parseGoMod(join(tempDir, "go.mod"));

      expect(result).not.toBeNull();
      expect(result!.dependencies).toHaveLength(2);
      expect(result!.dependencies[0].path).toBe("github.com/pkg/errors");
      expect(result!.dependencies[1].path).toBe("github.com/go-chi/chi/v5");
    });

    it("handles go.mod without Go version line", async () => {
      const goModContent = "module github.com/example/noversion\n";

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const result = await parseGoMod(join(tempDir, "go.mod"));

      expect(result).not.toBeNull();
      expect(result!.module).toBe("github.com/example/noversion");
      expect(result!.goVersion).toBeUndefined();
      expect(result!.dependencies).toEqual([]);
    });
  });

  // ── scanGoMod ───────────────────────────────────────────────────────

  describe("scanGoMod", () => {
    it("produces scan results from a go.mod file", async () => {
      const goModContent = [
        "module github.com/example/goproject",
        "",
        "go 1.21",
        "",
        "require (",
        "\tgithub.com/go-chi/chi/v5 v5.0.10",
        "\tgithub.com/jmoiron/sqlx v1.3.5",
        "\tgithub.com/lib/pq v1.10.9",
        ")",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const results = await scanGoMod(tempDir);

      // Should produce an epic, a Go version task, and a dependencies feature
      const epics = results.filter((r) => r.kind === "epic");
      const tasks = results.filter((r) => r.kind === "task");
      const features = results.filter((r) => r.kind === "feature");

      expect(epics.length).toBe(1);
      expect(epics[0].name).toBe("github.com/example/goproject");
      expect(epics[0].source).toBe("package");
      expect(epics[0].sourceFile).toBe("go.mod");
      expect(epics[0].description).toContain("Go module");

      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("Go version: 1.21");
      expect(tasks[0].description).toBe("Requires Go 1.21");
      expect(tasks[0].tags).toContain("engines");

      expect(features.length).toBe(1);
      expect(features[0].name).toBe("Dependencies");
      expect(features[0].description).toContain("3 dependencies");
      expect(features[0].tags).toContain("dependencies");
    });

    it("returns empty array when no go.mod exists", async () => {
      const results = await scanGoMod(tempDir);
      expect(results).toEqual([]);
    });

    it("handles go.mod with empty require block", async () => {
      const goModContent = [
        "module github.com/example/empty",
        "",
        "go 1.22",
        "",
        "require (",
        ")",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const results = await scanGoMod(tempDir);

      const epics = results.filter((r) => r.kind === "epic");
      const features = results.filter((r) => r.kind === "feature");

      expect(epics.length).toBe(1);
      // No Dependencies feature when there are no dependencies
      expect(features.filter((r) => r.name === "Dependencies").length).toBe(0);
    });

    it("uses lite mode — emits only feature-level results", async () => {
      const goModContent = [
        "module github.com/example/lite",
        "",
        "go 1.21",
        "",
        "require (",
        "\tgithub.com/lib/pq v1.10.9",
        ")",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const results = await scanGoMod(tempDir, { lite: true });

      expect(results.length).toBe(1);
      expect(results[0].kind).toBe("feature");
      expect(results[0].name).toBe("github.com/example/lite");
    });

    it("scans nested go.mod in subdirectory", async () => {
      await mkdir(join(tempDir, "services", "api"), { recursive: true });
      await writeFile(
        join(tempDir, "services", "api", "go.mod"),
        "module github.com/example/api\n\ngo 1.21\n",
      );

      const results = await scanGoMod(tempDir);

      // Not root go.mod, so no epic — only Go version task
      const epics = results.filter((r) => r.kind === "epic");
      expect(epics.length).toBe(0);

      const tasks = results.filter((r) => r.kind === "task");
      expect(tasks.length).toBe(1);
      expect(tasks[0].name).toBe("Go version: 1.21");
    });

    it("mirrors scanPackageJson output structure", async () => {
      // scanGoMod should produce source: "package" results, matching scanPackageJson
      const goModContent = [
        "module github.com/example/mirror",
        "",
        "go 1.21",
        "",
        "require (",
        "\tgithub.com/lib/pq v1.10.9",
        ")",
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const results = await scanGoMod(tempDir);

      // All results should have source: "package"
      for (const result of results) {
        expect(result.source).toBe("package");
      }

      // Dependencies feature should have the "dependencies" tag
      const depFeature = results.find((r) => r.name === "Dependencies");
      expect(depFeature).toBeDefined();
      expect(depFeature!.tags).toContain("dependencies");

      // Go version task should have the "engines" tag
      const versionTask = results.find((r) => r.name.startsWith("Go version:"));
      expect(versionTask).toBeDefined();
      expect(versionTask!.tags).toContain("engines");
    });

    it("handles many dependencies with truncation", async () => {
      const deps = Array.from({ length: 15 }, (_, i) =>
        `\tgithub.com/example/dep${i} v1.0.${i}`,
      ).join("\n");
      const goModContent = [
        "module github.com/example/many",
        "",
        "go 1.21",
        "",
        `require (\n${deps}\n)`,
      ].join("\n");

      await writeFile(join(tempDir, "go.mod"), goModContent);

      const results = await scanGoMod(tempDir);
      const depFeature = results.find((r) => r.name === "Dependencies");

      expect(depFeature).toBeDefined();
      expect(depFeature!.description).toContain("15 dependencies");
      expect(depFeature!.description).toContain("+5 more");
    });
  });

  // ── Integration: Go project produces meaningful analysis ────────────

  describe("Go project integration", () => {
    it("Go project produces meaningful Rex analysis proposals", async () => {
      // Set up a minimal Go project structure
      await writeFile(
        join(tempDir, "go.mod"),
        [
          "module github.com/example/goproject",
          "",
          "go 1.21",
          "",
          "require (",
          "\tgithub.com/go-chi/chi/v5 v5.0.10",
          "\tgithub.com/lib/pq v1.10.9",
          ")",
        ].join("\n"),
      );
      await writeFile(join(tempDir, "go.sum"), "github.com/lib/pq v1.10.9 h1:abc=\n");

      await mkdir(join(tempDir, "cmd", "api"), { recursive: true });
      await writeFile(join(tempDir, "cmd", "api", "main.go"), "package main\n");

      await mkdir(join(tempDir, "internal", "handler"), { recursive: true });
      await writeFile(
        join(tempDir, "internal", "handler", "handler.go"),
        "package handler\n",
      );
      await writeFile(
        join(tempDir, "internal", "handler", "handler_test.go"),
        "package handler\n",
      );

      await writeFile(join(tempDir, "README.md"), "# Go Project\n- Feature X\n");

      // Run all the scanners that would run during analysis
      const [testResults, docResults, goModResults] = await Promise.all([
        scanTests(tempDir),
        scanDocs(tempDir),
        scanGoMod(tempDir),
      ]);

      const allResults = [...testResults, ...docResults, ...goModResults];

      // Should have meaningful results from each scanner
      expect(allResults.length).toBeGreaterThan(0);

      // Go module epic
      expect(allResults.some((r) => r.kind === "epic" && r.name.includes("goproject"))).toBe(true);

      // Dependencies recognized
      expect(allResults.some((r) => r.name === "Dependencies")).toBe(true);

      // Test files detected (handler_test.go)
      expect(allResults.some((r) => r.source === "test")).toBe(true);

      // go.mod and go.sum not in doc results
      const docSourceFiles = docResults.map((r) => r.sourceFile);
      expect(docSourceFiles).not.toContain("go.mod");
      expect(docSourceFiles).not.toContain("go.sum");

      // README.md still scanned as a doc
      expect(docResults.some((r) => r.sourceFile === "README.md")).toBe(true);
    });
  });

  // ── Existing JS/TS behavior unchanged ───────────────────────────────

  describe("JS/TS scanning behavior unchanged", () => {
    it("still detects .test.ts files", async () => {
      await writeFile(join(tempDir, "app.test.ts"), "");

      const results = await scanTests(tempDir);
      expect(results.length).toBe(1);
    });

    it("still detects .spec.js files", async () => {
      await writeFile(join(tempDir, "app.spec.js"), "");

      const results = await scanTests(tempDir);
      expect(results.length).toBe(1);
    });

    it("still detects __tests__/ directory files", async () => {
      await mkdir(join(tempDir, "__tests__"), { recursive: true });
      await writeFile(join(tempDir, "__tests__", "helper.ts"), "");

      const results = await scanTests(tempDir);
      expect(results.length).toBe(1);
    });

    it("still skips node_modules", async () => {
      await mkdir(join(tempDir, "node_modules", "pkg"), { recursive: true });
      await writeFile(join(tempDir, "node_modules", "pkg", "test.test.ts"), "");

      const results = await scanTests(tempDir);
      expect(results.length).toBe(0);
    });
  });
});
