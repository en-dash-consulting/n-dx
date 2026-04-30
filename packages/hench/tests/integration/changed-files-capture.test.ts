/**
 * Integration test: End-to-end verification of changed-file capture.
 *
 * Simulates a realistic hench run scenario where:
 * 1. A task modifies multiple files (add, modify, delete)
 * 2. Files are staged and committed
 * 3. The run record captures accurate file changes from git
 *
 * This test ensures the run record's filesChanged matches the commit exactly.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import {
  captureCommitChanges,
  captureMultiCommitChanges,
  extractPaths,
  formatChanges,
} from "../../src/agent/analysis/git-changed-files.js";

describe("Changed files capture integration", () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-integration-"));
    // Initialize git repo
    execSync("git init", { cwd: projectDir, stdio: "ignore" });
    execSync('git config user.email "test@example.com"', {
      cwd: projectDir,
      stdio: "ignore",
    });
    execSync('git config user.name "Test User"', {
      cwd: projectDir,
      stdio: "ignore",
    });
  });

  afterEach(async () => {
    try {
      await rm(projectDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("realistic hench run scenario", () => {
    it("captures all three change types (add, modify, delete) from a single run", async () => {
      // Simulate a multi-file hench run:
      // 1. Existing files at start of run
      const initialFiles = {
        "src/existing1.ts": "initial content 1",
        "src/existing2.ts": "initial content 2",
        "tests/test.ts": "test content",
      };

      for (const [path, content] of Object.entries(initialFiles)) {
        const fullPath = join(projectDir, path);
        await mkdir(join(fullPath, ".."), { recursive: true });
        await writeFile(fullPath, content);
      }

      // Initial commit
      execSync("git add .", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Initial commit"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      // 2. Simulate hench modifications during the run:
      //    - Modify existing1.ts
      //    - Modify existing2.ts
      //    - Add a new file: src/new-feature.ts
      //    - Delete tests/test.ts
      //    - Add new test file: tests/feature.test.ts

      await writeFile(
        join(projectDir, "src/existing1.ts"),
        "modified content 1"
      );
      await writeFile(
        join(projectDir, "src/existing2.ts"),
        "modified content 2"
      );
      await writeFile(
        join(projectDir, "src/new-feature.ts"),
        "export function newFeature() {}"
      );
      execSync("git rm tests/test.ts", { cwd: projectDir, stdio: "ignore" });
      // Create parent directory first
      await mkdir(join(projectDir, "tests"), { recursive: true });
      await writeFile(
        join(projectDir, "tests/feature.test.ts"),
        "test code"
      );

      // 3. Stage all changes
      execSync("git add .", { cwd: projectDir, stdio: "ignore" });

      // 4. Commit changes (simulating hench's commit)
      execSync('git commit -m "Hench run: feature implementation"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      // 5. Get the commit SHA
      const commitSha = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      // 6. Capture changed files from the commit
      const changes = await captureCommitChanges(commitSha, projectDir);

      // 7. Verify the capture is accurate
      expect(changes.length).toBe(5);

      // Convert to path->status map for easier assertions
      const changeMap = Object.fromEntries(
        changes.map((c) => [c.path, c.status])
      );

      expect(changeMap).toMatchObject({
        "src/existing1.ts": "M", // Modified
        "src/existing2.ts": "M", // Modified
        "src/new-feature.ts": "A", // Added
        "tests/feature.test.ts": "A", // Added
        "tests/test.ts": "D", // Deleted
      });
    });

    it("correctly populates RunSummaryData filesChanged from git-captured changes", async () => {
      // This tests the integration between captureCommitChanges and
      // what would be stored in a RunSummaryData object

      // Create initial file
      await writeFile(join(projectDir, "README.md"), "# Project");
      execSync("git add .", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Initial"', {
        cwd: projectDir, stdio: "ignore",
      });

      // Make changes: add 3 files
      await writeFile(join(projectDir, "file1.ts"), "content 1");
      await writeFile(join(projectDir, "file2.ts"), "content 2");
      await writeFile(join(projectDir, "file3.ts"), "content 3");
      execSync("git add .", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Add three files"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(commitSha, projectDir);
      const filesChanged = extractPaths(changes);
      const filesWithStatus = formatChanges(changes);

      // Verify what would go into RunSummaryData
      expect(filesChanged).toEqual(["file1.ts", "file2.ts", "file3.ts"]);
      expect(filesWithStatus).toEqual([
        "A\tfile1.ts",
        "A\tfile2.ts",
        "A\tfile3.ts",
      ]);

      // In a real run, these would be set on run.structuredSummary:
      // run.structuredSummary.filesChanged = filesChanged;
      // run.structuredSummary.fileChangesWithStatus = filesWithStatus;
    });

    it("handles multi-commit runs correctly", async () => {
      // Simulate a run that creates multiple commits

      // Initial commit
      await writeFile(join(projectDir, "base.ts"), "base");
      execSync("git add .", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Initial"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      // Commit 1 of the run: add feature1
      await writeFile(join(projectDir, "feature1.ts"), "feature 1");
      execSync("git add feature1.ts", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Run commit 1: add feature1"', {
        cwd: projectDir,
        stdio: "ignore",
      });
      const sha1 = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      // Commit 2 of the run: add feature2 and modify base
      await writeFile(join(projectDir, "feature2.ts"), "feature 2");
      await writeFile(join(projectDir, "base.ts"), "modified base");
      execSync("git add feature2.ts base.ts", {
        cwd: projectDir,
        stdio: "ignore",
      });
      execSync('git commit -m "Run commit 2: add feature2 and modify base"', {
        cwd: projectDir,
        stdio: "ignore",
      });
      const sha2 = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      // Commit 3 of the run: delete feature1, add feature3
      execSync("git rm feature1.ts", { cwd: projectDir, stdio: "ignore" });
      await writeFile(join(projectDir, "feature3.ts"), "feature 3");
      execSync("git add feature3.ts", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Run commit 3: delete feature1, add feature3"', {
        cwd: projectDir,
        stdio: "ignore",
      });
      const sha3 = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      // Capture changes from all three run commits
      const allChanges = await captureMultiCommitChanges(
        [sha1, sha2, sha3],
        projectDir
      );
      const allFiles = extractPaths(allChanges);

      // The run touched 4 unique files across the 3 commits
      expect(allFiles.length).toBe(4);
      expect(allFiles.sort()).toEqual([
        "base.ts",
        "feature2.ts",
        "feature3.ts",
        "feature1.ts",
      ].sort());

      // Check final statuses (last-write-wins)
      const statusMap = Object.fromEntries(
        allChanges.map((c) => [c.path, c.status])
      );
      expect(statusMap).toMatchObject({
        "feature1.ts": "D", // Deleted in sha3 (latest)
        "feature2.ts": "A", // Added in sha2, unchanged
        "feature3.ts": "A", // Added in sha3
        "base.ts": "M", // Modified in sha2, unchanged
      });
    });

    it("handles directory structure with nested files", async () => {
      // Create nested directory structure
      const nestedDir = join(projectDir, "src/components");
      await mkdir(nestedDir, { recursive: true });

      await writeFile(
        join(nestedDir, "Button.tsx"),
        "export const Button = () => {};"
      );
      await writeFile(
        join(nestedDir, "Input.tsx"),
        "export const Input = () => {};"
      );

      execSync("git add .", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Initial structure"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      // Modify a nested file
      await writeFile(
        join(nestedDir, "Button.tsx"),
        "export const Button = (props) => {};"
      );
      execSync("git add src/components/Button.tsx", {
        cwd: projectDir,
        stdio: "ignore",
      });
      execSync('git commit -m "Update Button component"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      const changes = await captureCommitChanges(commitSha, projectDir);
      expect(changes).toEqual([
        { status: "M", path: "src/components/Button.tsx" },
      ]);
    });

    it("provides deterministic output across multiple invocations", async () => {
      // Ensure the capture produces identical results when run multiple times

      await writeFile(join(projectDir, "file1.ts"), "content 1");
      await writeFile(join(projectDir, "file2.ts"), "content 2");
      await writeFile(join(projectDir, "file3.ts"), "content 3");
      execSync("git add .", { cwd: projectDir, stdio: "ignore" });
      execSync('git commit -m "Add three files"', {
        cwd: projectDir,
        stdio: "ignore",
      });

      const commitSha = execSync("git rev-parse HEAD", {
        cwd: projectDir,
        encoding: "utf-8",
      }).trim();

      // Capture multiple times
      const capture1 = await captureCommitChanges(commitSha, projectDir);
      const capture2 = await captureCommitChanges(commitSha, projectDir);
      const capture3 = await captureCommitChanges(commitSha, projectDir);

      // All captures should be identical
      expect(capture1).toEqual(capture2);
      expect(capture2).toEqual(capture3);

      // Verify order is consistent (alphabetical by path)
      const paths = capture1.map((c) => c.path);
      const sortedPaths = [...paths].sort();
      expect(paths).toEqual(sortedPaths);
    });
  });
});
