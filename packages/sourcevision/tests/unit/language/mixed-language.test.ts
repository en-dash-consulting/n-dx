/**
 * Mixed-language detection tests.
 *
 * Covers:
 * - detectLanguages: returns all detected configs (not just the winner)
 * - mergeLanguageConfigs: combines skip dirs, test patterns, extensions, etc.
 * - Signal filtering: archetype signals with a `languages` array respect the project language
 * - Regression: pure Go and pure TypeScript detection remain unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { detectLanguage, detectLanguages, mergeLanguageConfigs, getLanguageConfig } from "../../../src/language/index.js";
import { typescriptConfig } from "../../../src/language/typescript.js";
import { goConfig } from "../../../src/language/go.js";
import { analyzeClassifications } from "../../../src/analyzers/classify.js";
import type { Inventory, Imports, ArchetypeSignal } from "../../../src/schema/v1.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeInventory(paths: string[]): Inventory {
  return {
    files: paths.map((path) => ({
      path,
      size: 100,
      language: path.endsWith(".go") ? "Go" : "TypeScript",
      lineCount: 10,
      hash: "abc",
      role: "source" as const,
      category: "code",
    })),
    summary: {
      totalFiles: paths.length,
      totalLines: paths.length * 10,
      byLanguage: {},
      byRole: { source: paths.length },
      byCategory: { code: paths.length },
    },
  };
}

function makeImports(edges: Array<{ from: string; to: string }>): Imports {
  return {
    edges: edges.map((e) => ({
      from: e.from,
      to: e.to,
      type: "static" as const,
      symbols: ["*"],
    })),
    external: [],
    summary: {
      totalEdges: edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

// ── detectLanguages ─────────────────────────────────────────────────────────

describe("detectLanguages", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-multi-lang-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns both Go and TypeScript configs when both go.mod and package.json are present", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/mixed\n\ngo 1.21\n");
    await writeFile(join(tmpDir, "package.json"), '{"name": "mixed"}\n');

    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(2);

    const ids = configs.map((c) => c.id);
    expect(ids).toContain("go");
    expect(ids).toContain("typescript");
  });

  it("returns Go first when Go files outnumber TS files", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/mixed\n");
    await writeFile(join(tmpDir, "package.json"), "{}");
    // Create more Go files than TS files
    await writeFile(join(tmpDir, "main.go"), "package main\n");
    await writeFile(join(tmpDir, "server.go"), "package main\n");
    await writeFile(join(tmpDir, "handler.go"), "package main\n");
    await writeFile(join(tmpDir, "index.ts"), "export {};\n");

    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(2);
    expect(configs[0].id).toBe("go");
    expect(configs[1].id).toBe("typescript");
  });

  it("returns TypeScript first when TS files outnumber Go files", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/mixed\n");
    await writeFile(join(tmpDir, "package.json"), "{}");
    // Create more TS files than Go files
    await writeFile(join(tmpDir, "index.ts"), "export {};\n");
    await writeFile(join(tmpDir, "app.ts"), "export {};\n");
    await writeFile(join(tmpDir, "config.ts"), "export {};\n");
    await writeFile(join(tmpDir, "main.go"), "package main\n");

    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(2);
    expect(configs[0].id).toBe("typescript");
    expect(configs[1].id).toBe("go");
  });

  it("returns only Go when only go.mod is present", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n");

    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("go");
    expect(configs[0]).toBe(goConfig);
  });

  it("returns only TypeScript when only package.json is present", async () => {
    await writeFile(join(tmpDir, "package.json"), "{}");

    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("typescript");
    expect(configs[0]).toBe(typescriptConfig);
  });

  it("returns TypeScript fallback when no markers exist", async () => {
    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(1);
    expect(configs[0].id).toBe("typescript");
    expect(configs[0]).toBe(typescriptConfig);
  });
});

// ── mergeLanguageConfigs ────────────────────────────────────────────────────

describe("mergeLanguageConfigs", () => {
  it("includes skip directories from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    // Go-specific skip directories
    expect(merged.skipDirectories.has("vendor")).toBe(true);

    // TypeScript-specific skip directories
    expect(merged.skipDirectories.has("node_modules")).toBe(true);
    expect(merged.skipDirectories.has(".next")).toBe(true);

    // Common skip directories
    expect(merged.skipDirectories.has("dist")).toBe(true);
    expect(merged.skipDirectories.has("build")).toBe(true);
  });

  it("includes test file patterns from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    // Go test pattern: _test.go
    const goTestMatch = merged.testFilePatterns.some((p) => p.test("handler_test.go"));
    expect(goTestMatch).toBe(true);

    // TypeScript test patterns: .test., .spec.
    const tsTestMatch = merged.testFilePatterns.some((p) => p.test("handler.test.ts"));
    expect(tsTestMatch).toBe(true);

    const tsSpecMatch = merged.testFilePatterns.some((p) => p.test("handler.spec.ts"));
    expect(tsSpecMatch).toBe(true);
  });

  it("includes extensions from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    // Go extensions
    expect(merged.extensions.has(".go")).toBe(true);

    // TypeScript extensions
    expect(merged.extensions.has(".ts")).toBe(true);
    expect(merged.extensions.has(".tsx")).toBe(true);
    expect(merged.extensions.has(".js")).toBe(true);
  });

  it("includes parseable extensions from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    expect(merged.parseableExtensions.has(".go")).toBe(true);
    expect(merged.parseableExtensions.has(".ts")).toBe(true);
    expect(merged.parseableExtensions.has(".tsx")).toBe(true);
  });

  it("includes config filenames from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    // Go config filenames
    expect(merged.configFilenames.has("go.mod")).toBe(true);
    expect(merged.configFilenames.has("go.sum")).toBe(true);
    expect(merged.configFilenames.has(".golangci.yml")).toBe(true);

    // TypeScript config filenames
    expect(merged.configFilenames.has("package.json")).toBe(true);
    expect(merged.configFilenames.has("tsconfig.json")).toBe(true);
  });

  it("includes generated file patterns from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    // Go generated patterns
    const pbMatch = merged.generatedFilePatterns.some((p) => p.test("service.pb.go"));
    expect(pbMatch).toBe(true);

    // TypeScript generated patterns
    const dtsMatch = merged.generatedFilePatterns.some((p) => p.test("types.d.ts"));
    expect(dtsMatch).toBe(true);
  });

  it("includes entry point patterns from both languages", () => {
    const merged = mergeLanguageConfigs([goConfig, typescriptConfig]);

    // Go entry points
    const goMain = merged.entryPointPatterns.some((p) => p.test("main.go"));
    expect(goMain).toBe(true);

    // TypeScript entry points
    const tsIndex = merged.entryPointPatterns.some((p) => p.test("index.ts"));
    expect(tsIndex).toBe(true);
  });

  it("uses primary config id and displayName", () => {
    const mergedGoFirst = mergeLanguageConfigs([goConfig, typescriptConfig]);
    expect(mergedGoFirst.id).toBe("go");
    expect(mergedGoFirst.displayName).toBe("Go");

    const mergedTsFirst = mergeLanguageConfigs([typescriptConfig, goConfig]);
    expect(mergedTsFirst.id).toBe("typescript");
    expect(mergedTsFirst.displayName).toBe("TypeScript");
  });

  it("uses primary config moduleFile", () => {
    const mergedGoFirst = mergeLanguageConfigs([goConfig, typescriptConfig]);
    expect(mergedGoFirst.moduleFile).toBe("go.mod");

    const mergedTsFirst = mergeLanguageConfigs([typescriptConfig, goConfig]);
    expect(mergedTsFirst.moduleFile).toBe("package.json");
  });

  it("returns the original config when only one is provided", () => {
    const merged = mergeLanguageConfigs([goConfig]);
    expect(merged).toBe(goConfig);
  });

  it("returns TypeScript fallback when empty array is provided", () => {
    const merged = mergeLanguageConfigs([]);
    expect(merged).toBe(typescriptConfig);
  });
});

// ── Signal filtering ────────────────────────────────────────────────────────

describe("classification signal filtering — language scoping", () => {
  // Use unique file names that don't collide with built-in archetype signals.
  // We check that our language-scoped signal appears in evidence (proving it
  // fired), rather than checking the final archetype (which may be outscored
  // by built-in signals).

  it("matches a signal when projectLanguage is in the signal's languages array", () => {
    const customArchetype = {
      id: "test-go-scanner",
      name: "Go Scanner Module",
      description: "Go scanner module files",
      signals: [
        {
          kind: "filename" as const,
          pattern: "^scanner\\.go$",
          weight: 0.9,
          languages: ["go"],
        },
      ],
    };

    const inv = makeInventory(["scanner.go"]);
    const result = analyzeClassifications(inv, makeImports([]), {
      customArchetypes: [customArchetype],
      projectLanguage: "go",
    });

    const file = result.files.find((f) => f.path === "scanner.go");
    expect(file).toBeDefined();
    // The Go-scoped signal should fire when projectLanguage is "go"
    const evidence = file!.evidence ?? [];
    const match = evidence.find((e) => e.archetypeId === "test-go-scanner");
    expect(match, "expected test-go-scanner signal to fire for Go project").toBeDefined();
    expect(match!.weight).toBe(0.9);
  });

  it("skips a signal when projectLanguage is NOT in the signal's languages array", () => {
    const customArchetype = {
      id: "test-go-scanner",
      name: "Go Scanner Module",
      description: "Go scanner module files",
      signals: [
        {
          kind: "filename" as const,
          pattern: "^scanner\\.go$",
          weight: 0.9,
          languages: ["go"],
        },
      ],
    };

    const inv = makeInventory(["scanner.go"]);
    const result = analyzeClassifications(inv, makeImports([]), {
      customArchetypes: [customArchetype],
      projectLanguage: "typescript",
    });

    const file = result.files.find((f) => f.path === "scanner.go");
    expect(file).toBeDefined();
    // The Go-scoped signal should NOT fire when projectLanguage is "typescript"
    const evidence = file!.evidence ?? [];
    const match = evidence.find((e) => e.archetypeId === "test-go-scanner");
    expect(match, "expected test-go-scanner signal to NOT fire for TS project").toBeUndefined();
  });

  it("matches a signal when languages array contains multiple entries including projectLanguage", () => {
    const customArchetype = {
      id: "test-multi-resolver",
      name: "Multi-lang resolver",
      description: "Resolver for Go and TypeScript",
      signals: [
        {
          kind: "filename" as const,
          pattern: "^resolver\\.",
          weight: 0.9,
          languages: ["go", "typescript"],
        },
      ],
    };

    const inv = makeInventory(["resolver.ts"]);
    const result = analyzeClassifications(inv, makeImports([]), {
      customArchetypes: [customArchetype],
      projectLanguage: "typescript",
    });

    const file = result.files.find((f) => f.path === "resolver.ts");
    expect(file).toBeDefined();
    // The multi-language signal should fire when projectLanguage is in the list
    const evidence = file!.evidence ?? [];
    const match = evidence.find((e) => e.archetypeId === "test-multi-resolver");
    expect(match, "expected test-multi-resolver signal to fire for TS project").toBeDefined();
  });

  it("fires language-neutral signals regardless of projectLanguage", () => {
    const customArchetype = {
      id: "test-neutral-scanner",
      name: "Language-neutral scanner",
      description: "Scanner with no language scope",
      signals: [
        {
          kind: "filename" as const,
          pattern: "^scanner\\.",
          weight: 0.9,
          // No `languages` field — should always fire
        },
      ],
    };

    const inv = makeInventory(["scanner.go"]);
    const result = analyzeClassifications(inv, makeImports([]), {
      customArchetypes: [customArchetype],
      projectLanguage: "go",
    });

    const file = result.files.find((f) => f.path === "scanner.go");
    expect(file).toBeDefined();
    // Signal without languages field should fire regardless of projectLanguage
    const evidence = file!.evidence ?? [];
    const match = evidence.find((e) => e.archetypeId === "test-neutral-scanner");
    expect(match, "expected language-neutral signal to fire").toBeDefined();
  });
});

// ── Regression: pure language detection ─────────────────────────────────────

describe("regression: pure Go detection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-pure-go-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("detectLanguage returns Go config for pure Go project", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n\ngo 1.21\n");
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("go");
    expect(config).toBe(goConfig);
  });

  it("detectLanguages returns only Go config for pure Go project", async () => {
    await writeFile(join(tmpDir, "go.mod"), "module example.com/test\n\ngo 1.21\n");
    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toBe(goConfig);
  });

  it("Go config has expected id and displayName", () => {
    expect(goConfig.id).toBe("go");
    expect(goConfig.displayName).toBe("Go");
  });

  it("Go config has vendor in skip directories", () => {
    expect(goConfig.skipDirectories.has("vendor")).toBe(true);
  });

  it("Go config detects _test.go files", () => {
    expect(goConfig.testFilePatterns.some((p) => p.test("handler_test.go"))).toBe(true);
    expect(goConfig.testFilePatterns.some((p) => p.test("handler.go"))).toBe(false);
  });

  it("Go config has go.mod as moduleFile", () => {
    expect(goConfig.moduleFile).toBe("go.mod");
  });

  it("Go config has go.mod and go.sum in configFilenames", () => {
    expect(goConfig.configFilenames.has("go.mod")).toBe(true);
    expect(goConfig.configFilenames.has("go.sum")).toBe(true);
  });
});

describe("regression: pure TypeScript detection", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-pure-ts-"));
  });

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it("detectLanguage returns TypeScript config for pure TS project", async () => {
    await writeFile(join(tmpDir, "package.json"), '{"name": "test"}\n');
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });

  it("detectLanguages returns only TypeScript config for pure TS project", async () => {
    await writeFile(join(tmpDir, "package.json"), '{"name": "test"}\n');
    const configs = await detectLanguages(tmpDir);
    expect(configs).toHaveLength(1);
    expect(configs[0]).toBe(typescriptConfig);
  });

  it("TypeScript config has expected id and displayName", () => {
    expect(typescriptConfig.id).toBe("typescript");
    expect(typescriptConfig.displayName).toBe("TypeScript");
  });

  it("TypeScript config has node_modules in skip directories", () => {
    expect(typescriptConfig.skipDirectories.has("node_modules")).toBe(true);
  });

  it("TypeScript config detects .test. and .spec. files", () => {
    expect(typescriptConfig.testFilePatterns.some((p) => p.test("handler.test.ts"))).toBe(true);
    expect(typescriptConfig.testFilePatterns.some((p) => p.test("handler.spec.ts"))).toBe(true);
    expect(typescriptConfig.testFilePatterns.some((p) => p.test("handler.ts"))).toBe(false);
  });

  it("TypeScript config has package.json as moduleFile", () => {
    expect(typescriptConfig.moduleFile).toBe("package.json");
  });

  it("TypeScript config has package.json and tsconfig.json in configFilenames", () => {
    expect(typescriptConfig.configFilenames.has("package.json")).toBe(true);
    expect(typescriptConfig.configFilenames.has("tsconfig.json")).toBe(true);
  });

  it("detectLanguage falls back to TypeScript when no markers exist", async () => {
    const config = await detectLanguage(tmpDir);
    expect(config.id).toBe("typescript");
    expect(config).toBe(typescriptConfig);
  });
});
