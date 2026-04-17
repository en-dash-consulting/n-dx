import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  analyzeDeadCode,
  toAnalyzerOutput,
  formatDeadCodeResults,
} from "../../../src/tools/dead-code-analyzer.js";

describe("dead-code-analyzer", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `dead-code-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await mkdir(join(tmpDir, "src"), { recursive: true });
    await mkdir(join(tmpDir, "src/utils"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("analyzeDeadCode", () => {
    it("returns error when sourcevision data is missing", async () => {
      const result = await analyzeDeadCode({ projectDir: tmpDir });

      expect(result.ran).toBe(false);
      expect(result.error).toContain("Missing sourcevision data files");
      expect(result.candidates).toHaveLength(0);
    });

    it("returns empty candidates when no issues found", async () => {
      // Write minimal sourcevision data
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({
          edges: [{ from: "src/a.ts", to: "src/b.ts", type: "static", symbols: ["foo"] }],
          external: [],
          summary: { totalEdges: 1, totalExternal: 0, circularCount: 0 },
        }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/a.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
            { path: "src/b.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      // Write source files
      await writeFile(join(tmpDir, "src/a.ts"), `import { foo } from "./b.js";\nfoo();`);
      await writeFile(join(tmpDir, "src/b.ts"), `export function foo() {}`);

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      expect(result.ran).toBe(true);
      expect(result.summary.totalFiles).toBe(2);
      expect(result.summary.filesExcluded).toBe(0);
    });

    it("excludes test files from analysis", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/a.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
            { path: "src/a.test.ts", size: 100, language: "typescript", lineCount: 10, role: "test" },
            { path: "tests/b.ts", size: 100, language: "typescript", lineCount: 10, role: "test" },
          ],
        }),
      );

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      expect(result.ran).toBe(true);
      expect(result.summary.filesAnalyzed).toBe(1);
      expect(result.summary.filesExcluded).toBe(2);
    });

    it("detects dead exports not imported anywhere", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({
          edges: [],
          external: [],
          summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 },
        }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/utils.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      // File with dead export
      await writeFile(
        join(tmpDir, "src/utils.ts"),
        `export function unusedHelper() {\n  return "dead";\n}`,
      );

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      expect(result.ran).toBe(true);
      const deadExports = result.candidates.filter((c) => c.type === "dead_export");
      expect(deadExports.length).toBeGreaterThanOrEqual(1);
      expect(deadExports[0].file).toBe("src/utils.ts");
      expect((deadExports[0] as any).name).toBe("unusedHelper");
    });

    it("does not flag exports that are imported", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({
          edges: [{ from: "src/consumer.ts", to: "src/utils.ts", type: "static", symbols: ["usedHelper"] }],
          external: [],
          summary: { totalEdges: 1, totalExternal: 0, circularCount: 0 },
        }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/utils.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
            { path: "src/consumer.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      await writeFile(join(tmpDir, "src/utils.ts"), `export function usedHelper() { return "used"; }`);
      await writeFile(join(tmpDir, "src/consumer.ts"), `import { usedHelper } from "./utils.js";\nusedHelper();`);

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      const deadExports = result.candidates.filter(
        (c) => c.type === "dead_export" && (c as any).name === "usedHelper",
      );
      expect(deadExports).toHaveLength(0);
    });

    it("ignores test consumer imports for dead export detection", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({
          edges: [{ from: "src/utils.test.ts", to: "src/utils.ts", type: "static", symbols: ["onlyUsedInTests"] }],
          external: [],
          summary: { totalEdges: 1, totalExternal: 0, circularCount: 0 },
        }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/utils.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
            { path: "src/utils.test.ts", size: 100, language: "typescript", lineCount: 10, role: "test" },
          ],
        }),
      );

      await writeFile(join(tmpDir, "src/utils.ts"), `export function onlyUsedInTests() { return "test"; }`);

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      // Should flag as dead because only test imports don't count
      const deadExports = result.candidates.filter(
        (c) => c.type === "dead_export" && (c as any).name === "onlyUsedInTests",
      );
      expect(deadExports.length).toBe(1);
    });

    it("detects unused imports within files", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/consumer.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      // File with unused import
      await writeFile(
        join(tmpDir, "src/consumer.ts"),
        `import { used, unused } from "./lib.js";\nused();`,
      );

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      const unusedImports = result.candidates.filter((c) => c.type === "unused_import");
      expect(unusedImports.length).toBeGreaterThanOrEqual(1);
      expect((unusedImports[0] as any).symbols).toContain("unused");
    });

    it("does not flag imports that are used", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/consumer.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      await writeFile(
        join(tmpDir, "src/consumer.ts"),
        `import { helper } from "./lib.js";\nconst result = helper();\nconsole.log(result);`,
      );

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      const unusedImports = result.candidates.filter(
        (c) => c.type === "unused_import" && (c as any).symbols.includes("helper"),
      );
      expect(unusedImports).toHaveLength(0);
    });

    it("detects duplicate utilities across files", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/utils/a.ts", size: 100, language: "typescript", lineCount: 20, role: "source" },
            { path: "src/utils/b.ts", size: 100, language: "typescript", lineCount: 20, role: "source" },
          ],
        }),
      );

      // Two nearly identical utility functions
      const funcBody = `
export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return \`\${year}-\${month}-\${day}\`;
}
`;
      await writeFile(join(tmpDir, "src/utils/a.ts"), funcBody);
      await writeFile(join(tmpDir, "src/utils/b.ts"), funcBody.replace("formatDate", "formatDateStr")); // Same body, different name

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      const duplicates = result.candidates.filter((c) => c.type === "duplicate_utility");
      expect(duplicates.length).toBeGreaterThanOrEqual(1);
      expect((duplicates[0] as any).similarity).toBeGreaterThan(0.8);
    });

    it("skips entry point files for dead export detection", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/index.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
            { path: "src/public.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      await writeFile(join(tmpDir, "src/index.ts"), `export function main() {}`);
      await writeFile(join(tmpDir, "src/public.ts"), `export function publicApi() {}`);

      const result = await analyzeDeadCode({ projectDir: tmpDir });

      // index.ts and public.ts exports should not be flagged as dead
      const deadExports = result.candidates.filter((c) => c.type === "dead_export");
      expect(deadExports.filter((c) => c.file === "src/index.ts")).toHaveLength(0);
      expect(deadExports.filter((c) => c.file === "src/public.ts")).toHaveLength(0);
    });

    it("respects maxCandidatesPerCategory limit", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );

      // Create many files with dead exports
      const files: any[] = [];
      for (let i = 0; i < 10; i++) {
        const path = `src/module${i}.ts`;
        files.push({ path, size: 100, language: "typescript", lineCount: 10, role: "source" });
        await writeFile(join(tmpDir, path), `export function deadFunc${i}() {}`);
      }

      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({ files }),
      );

      const result = await analyzeDeadCode({
        projectDir: tmpDir,
        maxCandidatesPerCategory: 3,
      });

      const deadExports = result.candidates.filter((c) => c.type === "dead_export");
      expect(deadExports.length).toBeLessThanOrEqual(3);
    });

    it("applies custom excludePatterns", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision/imports.json"),
        JSON.stringify({ edges: [], external: [], summary: { totalEdges: 0, totalExternal: 0, circularCount: 0 } }),
      );
      await writeFile(
        join(tmpDir, ".sourcevision/inventory.json"),
        JSON.stringify({
          files: [
            { path: "src/generated/types.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
            { path: "src/real.ts", size: 100, language: "typescript", lineCount: 10, role: "source" },
          ],
        }),
      );

      await mkdir(join(tmpDir, "src/generated"), { recursive: true });
      await writeFile(join(tmpDir, "src/generated/types.ts"), `export type Foo = string;`);
      await writeFile(join(tmpDir, "src/real.ts"), `export function dead() {}`);

      const result = await analyzeDeadCode({
        projectDir: tmpDir,
        excludePatterns: [/generated\//],
      });

      // generated/types.ts should be excluded
      const deadExports = result.candidates.filter((c) => c.type === "dead_export");
      expect(deadExports.filter((c) => c.file.includes("generated"))).toHaveLength(0);
    });
  });

  describe("toAnalyzerOutput", () => {
    it("converts analysis result to AnalyzerOutput format", async () => {
      const result = {
        ran: true,
        candidates: [
          {
            type: "dead_export" as const,
            file: "src/a.ts",
            name: "deadFunc",
            line: 1,
            endLine: 3,
            confidence: "high" as const,
            blastRadius: 0,
            reason: "test",
          },
          {
            type: "unused_import" as const,
            file: "src/b.ts",
            importStatement: 'import { x } from "y"',
            symbols: ["x"],
            line: 1,
            endLine: 1,
            confidence: "medium" as const,
            blastRadius: 0,
            reason: "test",
          },
          {
            type: "duplicate_utility" as const,
            file: "src/c.ts",
            name: "helper",
            line: 1,
            endLine: 5,
            canonicalFile: "src/d.ts",
            similarity: 0.9,
            confidence: "low" as const, // Should be excluded
            blastRadius: 1,
            reason: "test",
          },
        ],
        summary: {
          deadExports: 1,
          unusedImports: 1,
          duplicateUtilities: 1,
          totalFiles: 3,
          filesAnalyzed: 3,
          filesExcluded: 0,
        },
        totalDurationMs: 100,
      };

      const output = toAnalyzerOutput(result);

      // Only high/medium confidence should be included
      expect(output.deadExports).toHaveLength(1);
      expect(output.unusedImports).toHaveLength(1);
      expect(output.duplicateUtilities).toBeUndefined(); // Low confidence excluded
    });

    it("returns empty output for failed analysis", () => {
      const result = {
        ran: false,
        error: "test error",
        candidates: [],
        summary: {
          deadExports: 0,
          unusedImports: 0,
          duplicateUtilities: 0,
          totalFiles: 0,
          filesAnalyzed: 0,
          filesExcluded: 0,
        },
        totalDurationMs: 0,
      };

      const output = toAnalyzerOutput(result);

      expect(output.deadExports).toBeUndefined();
      expect(output.unusedImports).toBeUndefined();
      expect(output.duplicateUtilities).toBeUndefined();
    });
  });

  describe("formatDeadCodeResults", () => {
    it("formats results for human-readable output", () => {
      const result = {
        ran: true,
        candidates: [
          {
            type: "dead_export" as const,
            file: "src/a.ts",
            name: "deadFunc",
            line: 1,
            endLine: 3,
            confidence: "high" as const,
            blastRadius: 0,
            reason: "Export has no consumers",
          },
        ],
        summary: {
          deadExports: 1,
          unusedImports: 0,
          duplicateUtilities: 0,
          totalFiles: 10,
          filesAnalyzed: 8,
          filesExcluded: 2,
        },
        totalDurationMs: 150,
      };

      const formatted = formatDeadCodeResults(result);

      expect(formatted).toContain("Dead Code Analysis Results");
      expect(formatted).toContain("Files analyzed: 8");
      expect(formatted).toContain("Files excluded (tests/fixtures): 2");
      expect(formatted).toContain("Dead exports: 1");
      expect(formatted).toContain("HIGH");
      expect(formatted).toContain("src/a.ts");
    });

    it("shows error message when analysis failed", () => {
      const result = {
        ran: false,
        error: "Missing sourcevision data",
        candidates: [],
        summary: {
          deadExports: 0,
          unusedImports: 0,
          duplicateUtilities: 0,
          totalFiles: 0,
          filesAnalyzed: 0,
          filesExcluded: 0,
        },
        totalDurationMs: 10,
      };

      const formatted = formatDeadCodeResults(result);

      expect(formatted).toContain("Error: Missing sourcevision data");
    });

    it("shows no candidates message when none found", () => {
      const result = {
        ran: true,
        candidates: [],
        summary: {
          deadExports: 0,
          unusedImports: 0,
          duplicateUtilities: 0,
          totalFiles: 5,
          filesAnalyzed: 5,
          filesExcluded: 0,
        },
        totalDurationMs: 50,
      };

      const formatted = formatDeadCodeResults(result);

      expect(formatted).toContain("No cleanup candidates found");
    });
  });
});
