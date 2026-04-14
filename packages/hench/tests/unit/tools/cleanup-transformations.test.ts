import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  isTestFilePath,
  assertNotTestFile,
  TestFileGuardError,
  runCleanupTransformations,
  formatCleanupResults,
} from "../../../src/tools/cleanup-transformations.js";

// ---------------------------------------------------------------------------
// isTestFilePath (hard guard detection)
// ---------------------------------------------------------------------------

describe("isTestFilePath", () => {
  it("detects .test.ts files", () => {
    expect(isTestFilePath("src/foo.test.ts")).toBe(true);
    expect(isTestFilePath("src/agent/loop.test.ts")).toBe(true);
  });

  it("detects .spec.ts files", () => {
    expect(isTestFilePath("src/bar.spec.ts")).toBe(true);
    expect(isTestFilePath("lib/utils.spec.js")).toBe(true);
  });

  it("detects _test.ts files", () => {
    expect(isTestFilePath("src/utils_test.ts")).toBe(true);
    expect(isTestFilePath("internal/handler_test.go")).toBe(true);
  });

  it("detects files in tests/ directory", () => {
    expect(isTestFilePath("tests/unit/foo.ts")).toBe(true);
    expect(isTestFilePath("tests/integration/bar.ts")).toBe(true);
  });

  it("detects files in __tests__/ directory", () => {
    expect(isTestFilePath("src/__tests__/foo.ts")).toBe(true);
    expect(isTestFilePath("lib/__tests__/helpers.ts")).toBe(true);
  });

  it("detects nested tests directories", () => {
    expect(isTestFilePath("packages/core/tests/unit/foo.ts")).toBe(true);
    expect(isTestFilePath("src/components/__tests__/Button.tsx")).toBe(true);
  });

  it("rejects regular production files", () => {
    expect(isTestFilePath("src/foo.ts")).toBe(false);
    expect(isTestFilePath("src/agent/loop.ts")).toBe(false);
    expect(isTestFilePath("lib/utils.js")).toBe(false);
    expect(isTestFilePath("index.ts")).toBe(false);
  });

  it("normalizes Windows paths", () => {
    expect(isTestFilePath("tests\\unit\\foo.ts")).toBe(true);
    expect(isTestFilePath("src\\__tests__\\bar.ts")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertNotTestFile (hard guard)
// ---------------------------------------------------------------------------

describe("assertNotTestFile", () => {
  it("throws TestFileGuardError for test files", () => {
    expect(() => assertNotTestFile("src/foo.test.ts")).toThrow(TestFileGuardError);
    expect(() => assertNotTestFile("tests/unit/bar.ts")).toThrow(TestFileGuardError);
    expect(() => assertNotTestFile("src/__tests__/baz.ts")).toThrow(TestFileGuardError);
  });

  it("error message includes the file path", () => {
    try {
      assertNotTestFile("tests/critical.test.ts");
      expect.fail("Should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TestFileGuardError);
      expect((e as TestFileGuardError).message).toContain("tests/critical.test.ts");
      expect((e as TestFileGuardError).message).toContain("HARD GUARD VIOLATION");
    }
  });

  it("does not throw for production files", () => {
    expect(() => assertNotTestFile("src/foo.ts")).not.toThrow();
    expect(() => assertNotTestFile("lib/utils.js")).not.toThrow();
    expect(() => assertNotTestFile("index.ts")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// runCleanupTransformations
// ---------------------------------------------------------------------------

describe("runCleanupTransformations", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "cleanup-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns early with zero changes if no analyzer output", async () => {
    const result = await runCleanupTransformations({
      projectDir: tempDir,
      analyzerOutput: {},
    });

    expect(result.ran).toBe(true);
    expect(result.appliedCount).toBe(0);
    expect(result.rolledBackCount).toBe(0);
    expect(result.batches).toHaveLength(0);
  });

  it("throws TestFileGuardError if dead export targets a test file", async () => {
    await expect(
      runCleanupTransformations({
        projectDir: tempDir,
        analyzerOutput: {
          deadExports: [
            { file: "tests/unit/foo.ts", name: "deadFn", startLine: 1, endLine: 5 },
          ],
        },
      }),
    ).rejects.toThrow(TestFileGuardError);
  });

  it("throws TestFileGuardError if unused import targets a test file", async () => {
    await expect(
      runCleanupTransformations({
        projectDir: tempDir,
        analyzerOutput: {
          unusedImports: [
            {
              file: "src/foo.spec.ts",
              importStatement: "import { bar } from './bar'",
              startLine: 1,
              endLine: 1,
              symbols: ["bar"],
            },
          ],
        },
      }),
    ).rejects.toThrow(TestFileGuardError);
  });

  it("throws TestFileGuardError if duplicate utility canonical is a test file", async () => {
    await expect(
      runCleanupTransformations({
        projectDir: tempDir,
        analyzerOutput: {
          duplicateUtilities: [
            {
              canonical: { file: "__tests__/helpers.ts", name: "helper", startLine: 1, endLine: 5 },
              duplicates: [{ file: "src/utils.ts", name: "helper", startLine: 1, endLine: 5 }],
              callerFiles: [],
            },
          ],
        },
      }),
    ).rejects.toThrow(TestFileGuardError);
  });

  it("removes dead exports in dry-run mode without modifying files", async () => {
    // Create a test file
    const content = `export function used() { return 1; }

export function dead() { return 2; }

export const CONST = 42;
`;
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/utils.ts"), content);

    const result = await runCleanupTransformations({
      projectDir: tempDir,
      analyzerOutput: {
        deadExports: [
          { file: "src/utils.ts", name: "dead", startLine: 3, endLine: 3 },
        ],
      },
      dryRun: true,
    });

    expect(result.ran).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.batches).toHaveLength(1);
    expect(result.batches[0].transformations[0].type).toBe("dead_export_removal");
    expect(result.batches[0].transformations[0].description).toContain("dead");

    // Verify file was NOT modified
    const afterContent = await readFile(join(tempDir, "src/utils.ts"), "utf-8");
    expect(afterContent).toBe(content);
  });

  it("prunes unused imports in dry-run mode", async () => {
    const content = `import { used, unused } from './dep';
import { another } from './other';

export function main() {
  return used();
}
`;
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/main.ts"), content);

    const result = await runCleanupTransformations({
      projectDir: tempDir,
      analyzerOutput: {
        unusedImports: [
          {
            file: "src/main.ts",
            importStatement: "import { another } from './other'",
            startLine: 2,
            endLine: 2,
            symbols: ["another"],
          },
        ],
      },
      dryRun: true,
    });

    expect(result.ran).toBe(true);
    expect(result.appliedCount).toBe(1);
    expect(result.batches[0].transformations[0].type).toBe("unused_import_prune");
    expect(result.batches[0].transformations[0].description).toContain("another");
  });

  it("is idempotent - no changes on clean codebase", async () => {
    const result = await runCleanupTransformations({
      projectDir: tempDir,
      analyzerOutput: {
        deadExports: [],
        unusedImports: [],
        duplicateUtilities: [],
      },
    });

    expect(result.ran).toBe(true);
    expect(result.appliedCount).toBe(0);
    expect(result.rolledBackCount).toBe(0);
    expect(result.batches).toHaveLength(0);
  });

  it("logs transformations with file, line range, and type", async () => {
    const content = `// line 1
export function dead1() {}
// line 3
export function dead2() {}
// line 5
`;
    await mkdir(join(tempDir, "src"), { recursive: true });
    await writeFile(join(tempDir, "src/utils.ts"), content);

    const result = await runCleanupTransformations({
      projectDir: tempDir,
      analyzerOutput: {
        deadExports: [
          { file: "src/utils.ts", name: "dead1", startLine: 2, endLine: 2 },
          { file: "src/utils.ts", name: "dead2", startLine: 4, endLine: 4 },
        ],
      },
      dryRun: true,
    });

    expect(result.batches).toHaveLength(1);
    const transformations = result.batches[0].transformations;
    expect(transformations).toHaveLength(2);

    for (const t of transformations) {
      expect(t.file).toBe("src/utils.ts");
      expect(t.type).toBe("dead_export_removal");
      expect(typeof t.startLine).toBe("number");
      expect(typeof t.endLine).toBe("number");
      expect(t.description).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// formatCleanupResults
// ---------------------------------------------------------------------------

describe("formatCleanupResults", () => {
  it("formats empty results", () => {
    const output = formatCleanupResults({
      ran: true,
      appliedCount: 0,
      rolledBackCount: 0,
      batches: [],
      totalDurationMs: 100,
    });

    expect(output).toContain("Applied: 0");
    expect(output).toContain("Rolled back: 0");
    expect(output).toContain("Duration: 100ms");
  });

  it("formats results with batches", () => {
    const output = formatCleanupResults({
      ran: true,
      appliedCount: 2,
      rolledBackCount: 1,
      batches: [
        {
          transformations: [
            {
              type: "dead_export_removal",
              file: "src/utils.ts",
              startLine: 10,
              endLine: 15,
              description: "Removed dead export: foo",
            },
          ],
          validated: true,
          rolledBack: false,
        },
        {
          transformations: [
            {
              type: "unused_import_prune",
              file: "src/main.ts",
              startLine: 1,
              endLine: 1,
              description: "Pruned unused import: bar",
            },
          ],
          validated: false,
          rolledBack: true,
          error: "Type error: Cannot find module",
        },
      ],
      totalDurationMs: 5000,
    });

    expect(output).toContain("Applied: 2");
    expect(output).toContain("Rolled back: 1");
    expect(output).toContain("Duration: 5000ms");
    expect(output).toContain("APPLIED");
    expect(output).toContain("ROLLED BACK");
    expect(output).toContain("dead_export_removal");
    expect(output).toContain("unused_import_prune");
    expect(output).toContain("src/utils.ts:10-15");
    expect(output).toContain("Type error");
  });
});
