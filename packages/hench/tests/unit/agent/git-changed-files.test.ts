/**
 * Tests for git-changed-files module.
 *
 * Verifies accurate capture of changed files using git diff-tree,
 * including file status codes (A/M/D/R) and handling of single and
 * multi-commit scenarios.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { execSync } from "node:child_process";
import {
  captureCommitChanges,
  captureMultiCommitChanges,
  extractPaths,
  formatChanges,
  type FileChangeWithStatus,
} from "../../../src/agent/analysis/git-changed-files.js";

describe("git-changed-files", () => {
  let repoDir: string;

  beforeEach(async () => {
    // Create a temporary git repository
    repoDir = await mkdtemp(join(tmpdir(), "hench-git-test-"));
    execSync("git init", { cwd: repoDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', {
      cwd: repoDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test User"', {
      cwd: repoDir,
      stdio: "ignore",
    });
  });

  afterEach(async () => {
    // Clean up temporary directory
    try {
      execSync("rm -rf " + repoDir, { stdio: "ignore" });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("captureCommitChanges", () => {
    it("captures added files", async () => {
      // Create and commit a new file
      await writeFile(join(repoDir, "new-file.ts"), "export const x = 1;");
      execSync("git add new-file.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Add new file"', {
        cwd: repoDir,
        stdio: "ignore",
      });

      const sha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(sha, repoDir);
      expect(changes).toEqual([{ status: "A", path: "new-file.ts" }]);
    });

    it("captures modified files", async () => {
      // Create and commit an initial file
      await writeFile(join(repoDir, "existing.ts"), "initial content");
      execSync("git add existing.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Initial"', { cwd: repoDir, stdio: "ignore" });

      // Modify and commit
      await writeFile(join(repoDir, "existing.ts"), "modified content");
      execSync("git add existing.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Modify"', { cwd: repoDir, stdio: "ignore" });

      const sha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(sha, repoDir);
      expect(changes).toEqual([{ status: "M", path: "existing.ts" }]);
    });

    it("captures deleted files", async () => {
      // Create and commit an initial file
      await writeFile(join(repoDir, "to-delete.ts"), "content");
      execSync("git add to-delete.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Initial"', { cwd: repoDir, stdio: "ignore" });

      // Delete and commit
      execSync("git rm to-delete.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Delete"', { cwd: repoDir, stdio: "ignore" });

      const sha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(sha, repoDir);
      expect(changes).toEqual([{ status: "D", path: "to-delete.ts" }]);
    });

    it("captures multiple changes in one commit", async () => {
      // Create initial files
      await writeFile(join(repoDir, "file1.ts"), "initial");
      await writeFile(join(repoDir, "file2.ts"), "initial");
      execSync("git add .", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Initial"', { cwd: repoDir, stdio: "ignore" });

      // Multi-file commit: modify both existing files
      await writeFile(join(repoDir, "file1.ts"), "modified");
      await writeFile(join(repoDir, "file2.ts"), "modified");
      execSync("git add file1.ts file2.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Modify both"', { cwd: repoDir, stdio: "ignore" });

      const sha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(sha, repoDir);
      // Should have 2 changes: modify file1, modify file2
      expect(changes.length).toBe(2);
      expect(changes).toContainEqual({ status: "M", path: "file1.ts" });
      expect(changes).toContainEqual({ status: "M", path: "file2.ts" });
    });

    it("returns sorted results for deterministic output", async () => {
      // Create multiple files in non-alphabetical order
      await writeFile(join(repoDir, "zebra.ts"), "z");
      await writeFile(join(repoDir, "apple.ts"), "a");
      await writeFile(join(repoDir, "middle.ts"), "m");
      execSync("git add .", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Many files"', { cwd: repoDir, stdio: "ignore" });

      const sha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(sha, repoDir);
      const paths = changes.map((c) => c.path);
      expect(paths).toEqual(["apple.ts", "middle.ts", "zebra.ts"]);
    });

  });

  describe("captureMultiCommitChanges", () => {
    it("handles empty commit list", async () => {
      const changes = await captureMultiCommitChanges([], repoDir);
      expect(changes).toEqual([]);
    });

    it("handles single commit", async () => {
      await writeFile(join(repoDir, "single.ts"), "content");
      execSync("git add single.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Single"', { cwd: repoDir, stdio: "ignore" });

      const sha = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureMultiCommitChanges([sha], repoDir);
      expect(changes).toEqual([{ status: "A", path: "single.ts" }]);
    });

    it("aggregates changes from multiple commits", async () => {
      // Commit 1: add file1
      await writeFile(join(repoDir, "file1.ts"), "content1");
      execSync("git add file1.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Add file1"', { cwd: repoDir, stdio: "ignore" });
      const sha1 = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      // Commit 2: add file2, modify file1
      await writeFile(join(repoDir, "file2.ts"), "content2");
      await writeFile(join(repoDir, "file1.ts"), "modified");
      execSync("git add file1.ts file2.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Add file2 and modify file1"', {
        cwd: repoDir,
        stdio: "ignore",
      });
      const sha2 = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      // Commit 3: delete file1, add file3
      execSync("git rm file1.ts", { cwd: repoDir, stdio: "ignore" });
      await writeFile(join(repoDir, "file3.ts"), "content3");
      execSync("git add file3.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Delete file1, add file3"', {
        cwd: repoDir,
        stdio: "ignore",
      });
      const sha3 = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      // Aggregate across all three commits
      const changes = await captureMultiCommitChanges([sha1, sha2, sha3], repoDir);

      // Should have 3 unique paths: file1 (latest status: D), file2 (A), file3 (A)
      // Note: When aggregating commits, file2 appears as "A" because it was first
      // introduced in sha2. The final status is based on the last operation on each file.
      expect(changes.length).toBe(3);
      const pathMap = Object.fromEntries(
        changes.map((c) => [c.path, c.status])
      );
      expect(pathMap).toEqual({
        "file1.ts": "D", // Latest status from sha3
        "file2.ts": "A", // From sha2, unchanged in sha3
        "file3.ts": "A", // From sha3
      });
    });

    it("uses last-write-wins deduplication", async () => {
      // Commit 1: add file
      await writeFile(join(repoDir, "file.ts"), "v1");
      execSync("git add file.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Add file"', { cwd: repoDir, stdio: "ignore" });
      const sha1 = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      // Commit 2: modify file
      await writeFile(join(repoDir, "file.ts"), "v2");
      execSync("git add file.ts", { cwd: repoDir, stdio: "ignore" });
      execSync('git commit -m "Modify file"', { cwd: repoDir, stdio: "ignore" });
      const sha2 = execSync("git rev-parse HEAD", {
        cwd: repoDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureMultiCommitChanges([sha1, sha2], repoDir);
      // Should report M (from sha2, the last operation)
      expect(changes).toEqual([{ status: "M", path: "file.ts" }]);
    });
  });

  describe("extractPaths", () => {
    it("extracts paths from file changes", () => {
      const changes: FileChangeWithStatus[] = [
        { status: "A", path: "new.ts" },
        { status: "M", path: "modified.ts" },
        { status: "D", path: "deleted.ts" },
      ];

      const paths = extractPaths(changes);
      expect(paths).toEqual(["new.ts", "modified.ts", "deleted.ts"]);
    });

    it("handles empty list", () => {
      expect(extractPaths([])).toEqual([]);
    });
  });

  describe("formatChanges", () => {
    it("formats changes as STATUS\\tPATH", () => {
      const changes: FileChangeWithStatus[] = [
        { status: "A", path: "new.ts" },
        { status: "M", path: "modified.ts" },
        { status: "D", path: "deleted.ts" },
      ];

      const formatted = formatChanges(changes);
      expect(formatted).toEqual([
        "A\tnew.ts",
        "M\tmodified.ts",
        "D\tdeleted.ts",
      ]);
    });

    it("handles paths with spaces and special characters", () => {
      const changes: FileChangeWithStatus[] = [
        { status: "A", path: "src/my feature.ts" },
        { status: "M", path: "README (draft).md" },
      ];

      const formatted = formatChanges(changes);
      expect(formatted).toEqual([
        "A\tsrc/my feature.ts",
        "M\tREADME (draft).md",
      ]);
    });
  });
});
