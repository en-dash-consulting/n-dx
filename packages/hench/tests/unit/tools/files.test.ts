import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { ToolGuard } from "../../../src/tools/contracts.js";
import { toolReadFile, toolWriteFile, toolListDirectory, toolSearchFiles } from "../../../src/tools/files.js";

function createToolGuard(projectDir: string): ToolGuard {
  const maxFileSize = 1024 * 1024;
  return {
    checkPath(filepath: string): string {
      const resolved = resolve(projectDir, filepath);
      if (!resolved.startsWith(projectDir)) {
        throw new Error(`Path escapes project directory: ${filepath}`);
      }
      return resolved;
    },
    checkCommand(): void {},
    checkGitSubcommand(): void {},
    recordFileRead(): void {},
    recordFileWrite(): void {},
    maxFileSize,
    commandTimeout: 30_000,
  };
}

describe("file tools", () => {
  let projectDir: string;
  let guard: ToolGuard;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-files-"));
    guard = createToolGuard(projectDir);

    // Create test files
    await mkdir(join(projectDir, "src"), { recursive: true });
    await writeFile(join(projectDir, "src", "main.ts"), 'console.log("hello");\n');
    await writeFile(join(projectDir, "src", "utils.ts"), 'export function add(a: number, b: number) { return a + b; }\n');
    await writeFile(join(projectDir, "README.md"), "# Test Project\n");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  describe("toolReadFile", () => {
    it("reads file contents", async () => {
      const content = await toolReadFile(guard, { path: "src/main.ts" });
      expect(content).toContain('console.log("hello")');
    });

    it("throws for non-existent file", async () => {
      await expect(
        toolReadFile(guard, { path: "nonexistent.ts" }),
      ).rejects.toThrow();
    });
  });

  describe("toolWriteFile", () => {
    it("writes new file", async () => {
      const result = await toolWriteFile(guard, {
        path: "src/new.ts",
        content: "export const x = 1;\n",
      });
      expect(result).toContain("Wrote");

      const content = await toolReadFile(guard, { path: "src/new.ts" });
      expect(content).toBe("export const x = 1;\n");
    });

    it("creates parent directories", async () => {
      await toolWriteFile(guard, {
        path: "src/deep/nested/file.ts",
        content: "hello",
      });
      const content = await toolReadFile(guard, { path: "src/deep/nested/file.ts" });
      expect(content).toBe("hello");
    });
  });

  describe("toolListDirectory", () => {
    it("lists directory contents", async () => {
      const result = await toolListDirectory(guard, { path: "." });
      expect(result).toContain("src/");
      expect(result).toContain("README.md");
    });

    it("lists recursively", async () => {
      const result = await toolListDirectory(guard, { path: ".", recursive: true });
      expect(result).toContain("src/main.ts");
      expect(result).toContain("src/utils.ts");
    });
  });

  describe("toolSearchFiles", () => {
    it("finds pattern matches", async () => {
      const result = await toolSearchFiles(guard, {
        pattern: "console\\.log",
        path: ".",
      });
      expect(result).toContain("src/main.ts");
    });

    it("returns no matches message", async () => {
      const result = await toolSearchFiles(guard, {
        pattern: "nonexistent_pattern_xyz",
        path: ".",
      });
      expect(result).toContain("No matches found");
    });

    it("filters by glob", async () => {
      const result = await toolSearchFiles(guard, {
        pattern: "export",
        path: ".",
        glob: "*.md",
      });
      expect(result).toBe("No matches found");
    });

    it("throws on invalid regex pattern", async () => {
      await expect(
        toolSearchFiles(guard, {
          pattern: "(unclosed",
          path: ".",
        }),
      ).rejects.toThrow("Invalid regex");
    });
  });
});
