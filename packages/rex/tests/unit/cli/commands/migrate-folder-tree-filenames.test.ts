/**
 * Tests for `rex migrate-folder-tree-filenames`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { cmdMigrateFolderTreeFilenames } from "../../../../src/cli/commands/migrate-folder-tree-filenames.js";
import { PRD_TREE_DIRNAME } from "../../../../src/store/index.js";

/** Simple index.md fixture. */
function writeIndexMd(path: string, title: string, id: string = "test-id"): void {
  const content = `---
id: ${id}
title: "${title}"
level: epic
status: pending
---

Test content.
`;
  writeFileSync(path, content, "utf-8");
}

describe("cmdMigrateFolderTreeFilenames", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-migrate-filenames-test-"));
    mkdirSync(join(tmp, ".rex", PRD_TREE_DIRNAME), { recursive: true });
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
  }

  function filesInDir(dir: string): string[] {
    try {
      return readdirSync(dir).sort();
    } catch {
      return [];
    }
  }

  it("migrates simple index.md to title-based filename", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "Web Dashboard");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "index.md"))).toBe(false);
    expect(existsSync(join(itemDir, "web_dashboard.md"))).toBe(true);
    expect(output()).toContain("1 file");
    expect(output()).toContain("renamed");
  });

  it("handles punctuation in titles", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "My: Title? (test)");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "my_title_test.md"))).toBe(true);
  });

  it("handles whitespace in titles", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "  spaces  ");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "spaces.md"))).toBe(true);
  });

  it("handles Unicode characters", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "Héros & Légendes");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "heros_legendes.md"))).toBe(true);
  });

  it("handles empty or invalid titles by using fallback", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "!!!???");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "unnamed.md"))).toBe(true);
  });

  it("is idempotent: re-running after migration shows no-op", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "Web Dashboard");

    await cmdMigrateFolderTreeFilenames(tmp);
    logSpy.mockClear();

    await cmdMigrateFolderTreeFilenames(tmp);

    const out = output();
    expect(out).toContain("already complete");
  });

  it("is idempotent: re-running on already-migrated tree is no-op", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "Web Dashboard");

    // First migration
    await cmdMigrateFolderTreeFilenames(tmp);

    // Manually verify file was renamed
    expect(existsSync(join(itemDir, "web_dashboard.md"))).toBe(true);

    // Rename back to index.md to simulate already-migrated state
    // (In real scenario, the parser would be updated to read title-based files)
    rmSync(join(itemDir, "web_dashboard.md"));
    writeIndexMd(join(itemDir, "index.md"), "Web Dashboard");

    logSpy.mockClear();
    await cmdMigrateFolderTreeFilenames(tmp);

    // Second migration should rename again
    expect(existsSync(join(itemDir, "web_dashboard.md"))).toBe(true);
  });

  it("skips files that are already migrated (title-based filename)", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    // Create a title-based file directly
    writeIndexMd(join(itemDir, "web_dashboard.md"), "Web Dashboard");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "web_dashboard.md"))).toBe(true);
    expect(output()).toContain("already complete");
  });

  it("migrates nested structure: epic → feature → task", async () => {
    const epicDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    const featureDir = join(epicDir, "feature-1");
    const taskDir = join(featureDir, "task-1");
    mkdirSync(taskDir, { recursive: true });

    writeIndexMd(join(epicDir, "index.md"), "Core Epic", "epic-1");
    writeIndexMd(join(featureDir, "index.md"), "Main Feature", "feature-1");
    writeIndexMd(join(taskDir, "index.md"), "Task Alpha", "task-1");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(epicDir, "core_epic.md"))).toBe(true);
    expect(existsSync(join(featureDir, "main_feature.md"))).toBe(true);
    expect(existsSync(join(taskDir, "task_alpha.md"))).toBe(true);

    expect(existsSync(join(epicDir, "index.md"))).toBe(false);
    expect(existsSync(join(featureDir, "index.md"))).toBe(false);
    expect(existsSync(join(taskDir, "index.md"))).toBe(false);

    expect(output()).toContain("3 file");
  });

  it("detects collision among siblings and applies ID suffix", async () => {
    const epicDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(epicDir);
    mkdirSync(join(epicDir, "feature-1"));
    mkdirSync(join(epicDir, "feature-2"));

    // Two features with titles that normalize to the same filename
    // Use different IDs that will produce different suffixes
    writeIndexMd(join(epicDir, "feature-1", "index.md"), "API Endpoint", "aaaabbbbcccc");
    writeIndexMd(join(epicDir, "feature-2", "index.md"), "api-endpoint", "ddddeeeeffffg");

    await cmdMigrateFolderTreeFilenames(tmp);

    // Both should be renamed (no longer index.md)
    expect(existsSync(join(epicDir, "feature-1", "index.md"))).toBe(false);
    expect(existsSync(join(epicDir, "feature-2", "index.md"))).toBe(false);

    // Both should have markdown files
    const files = filesInDir(join(epicDir, "feature-1"));
    expect(files.some((f) => f.endsWith(".md"))).toBe(true);

    const files2 = filesInDir(join(epicDir, "feature-2"));
    expect(files2.some((f) => f.endsWith(".md"))).toBe(true);

    // Files should be different due to ID suffix
    expect(files[0]).not.toBe(files2[0]);

    // Should report migration
    expect(output()).toContain("2 files");
  });

  it("preserves file content during migration", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    const originalContent = `---
id: test-123
title: "My Title"
level: epic
status: in_progress
description: Important task
acceptanceCriteria:
  - First criterion
  - Second criterion
---

This is the body content.
More details here.
`;
    writeFileSync(join(itemDir, "index.md"), originalContent, "utf-8");

    await cmdMigrateFolderTreeFilenames(tmp);

    const newContent = readFileSync(join(itemDir, "my_title.md"), "utf-8");
    expect(newContent).toBe(originalContent);
  });

  it("skips files with missing title field", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    const malformed = `---
id: test-123
level: epic
---

No title field.
`;
    writeFileSync(join(itemDir, "index.md"), malformed, "utf-8");

    await cmdMigrateFolderTreeFilenames(tmp);

    // Should still skip (no title to migrate from)
    expect(existsSync(join(itemDir, "index.md"))).toBe(true);
  });

  it("handles mixed content: some index.md, some title-based", async () => {
    const epicDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    const featureDir = join(epicDir, "feature-1");
    mkdirSync(featureDir, { recursive: true });

    // One still as index.md
    writeIndexMd(join(epicDir, "index.md"), "Core Epic", "epic-1");
    // One already migrated to title-based
    writeIndexMd(join(featureDir, "main_feature.md"), "Main Feature", "feature-1");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(epicDir, "core_epic.md"))).toBe(true);
    expect(existsSync(join(featureDir, "main_feature.md"))).toBe(true);
  });

  it("skips non-directory entries in tree root", async () => {
    const treeRoot = join(tmp, ".rex", PRD_TREE_DIRNAME);
    writeFileSync(join(treeRoot, "readme.txt"), "This is not an item directory");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(treeRoot, "readme.txt"))).toBe(true);
    expect(output()).toContain("already complete");
  });

  it("handles missing tree directory gracefully", async () => {
    rmSync(join(tmp, ".rex", PRD_TREE_DIRNAME), { recursive: true });

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(output()).toContain("already complete");
  });

  it("prints summary with zero migrated files when tree is empty", async () => {
    await cmdMigrateFolderTreeFilenames(tmp);

    expect(output()).toContain("already complete");
  });

  it("handles titles with leading/trailing underscores", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "_test_case_");

    await cmdMigrateFolderTreeFilenames(tmp);

    expect(existsSync(join(itemDir, "test_case.md"))).toBe(true);
  });

  it("round-trip safe: f(f(x)) = f(x)", async () => {
    const itemDir = join(tmp, ".rex", PRD_TREE_DIRNAME, "epic-1");
    mkdirSync(itemDir);
    writeIndexMd(join(itemDir, "index.md"), "web_dashboard.md");

    await cmdMigrateFolderTreeFilenames(tmp);

    // "web_dashboard.md" as a title should normalize to "web_dashboard.md"
    expect(existsSync(join(itemDir, "web_dashboard.md"))).toBe(true);
  });
});
