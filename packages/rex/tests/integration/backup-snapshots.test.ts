/**
 * Integration tests for PRD tree backup snapshots.
 *
 * Tests the backup/restore functionality for migration safety:
 * - Snapshot creation with timestamped backups
 * - Idempotent snapshots (running twice produces one backup)
 * - Backup retention pruning (cap at 10)
 * - Restore from backup
 * - No backup when tree is empty
 *
 * @module rex/tests/integration/backup-snapshots.test
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdir, writeFile, readdir, stat, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  snapshotPRDTree,
  restoreFromBackup,
  getAvailableBackups,
  pruneBackups,
} from "../../src/core/backup-snapshots.js";

describe("backup-snapshots", () => {
  let tmpDir: string;
  let rexDir: string;
  let treeRoot: string;

  beforeEach(async () => {
    // Create temp directory for test
    tmpDir = join(tmpdir(), `rex-backup-test-${randomBytes(8).toString("hex")}`);
    rexDir = join(tmpDir, ".rex");
    treeRoot = join(rexDir, "prd_tree");

    // Create .rex directory structure
    await mkdir(rexDir, { recursive: true });
    await mkdir(treeRoot, { recursive: true });
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("should create a timestamped backup snapshot", async () => {
    // Create a simple PRD tree structure
    const epicDir = join(treeRoot, "epic_my_project");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "# My Project\n\nDescription here.");

    // Create snapshot
    const snapshot = await snapshotPRDTree(rexDir);

    // Verify backup was created
    expect(snapshot).not.toBeNull();
    expect(snapshot?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
    expect(snapshot?.backupPath).toContain(".backups");
    expect(snapshot?.backupPath).toContain("prd_tree_");

    // Verify backup directory exists and contains the epic
    const backupEpicDir = join(snapshot!.backupPath, "epic_my_project");
    expect(await stat(backupEpicDir)).toBeDefined();
    const backupIndex = await readFile(join(backupEpicDir, "index.md"), "utf-8");
    expect(backupIndex).toContain("# My Project");
  });

  it("should return null if tree does not exist", async () => {
    // Remove tree directory
    await rm(treeRoot, { recursive: true, force: true });

    // Try to snapshot non-existent tree
    const snapshot = await snapshotPRDTree(rexDir);

    expect(snapshot).toBeNull();
  });

  it("should return null if tree is empty", async () => {
    // Tree exists but is empty (already created in beforeEach)
    const snapshot = await snapshotPRDTree(rexDir);

    expect(snapshot).toBeNull();
  });

  it("should restore from backup", async () => {
    // Create initial tree
    const epicDir = join(treeRoot, "epic_original");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "Original content");

    // Create backup
    const snapshot = await snapshotPRDTree(rexDir);
    expect(snapshot).not.toBeNull();

    // Modify the tree
    await writeFile(join(epicDir, "index.md"), "Modified content");

    // Restore from backup
    await restoreFromBackup(rexDir, snapshot!.timestamp);

    // Verify restored content
    const restored = await readFile(join(treeRoot, "epic_original", "index.md"), "utf-8");
    expect(restored).toBe("Original content");
  });

  it("should list available backups sorted by timestamp (newest first)", async () => {
    // Create tree
    const epicDir = join(treeRoot, "epic_test");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "Test");

    // Create multiple backups with small delays
    const snapshots = [];
    for (let i = 0; i < 3; i++) {
      const snapshot = await snapshotPRDTree(rexDir);
      snapshots.push(snapshot!);
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 100));
    }

    // Get list of backups
    const backups = await getAvailableBackups(rexDir);

    // Verify all backups are listed and sorted (newest first). getAvailableBackups
    // returns the on-disk snapshot id, which is the colon-free encoding of the
    // ISO timestamp — not the raw timestamp.
    expect(backups.length).toBe(3);
    expect(backups[0]).toBe(snapshots[2].id);
    expect(backups[1]).toBe(snapshots[1].id);
    expect(backups[2]).toBe(snapshots[0].id);
  });

  it("should prune old backups keeping only the retention cap", async () => {
    // Create tree
    const epicDir = join(treeRoot, "epic_test");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "Test");

    // Create 15 backups
    for (let i = 0; i < 15; i++) {
      await snapshotPRDTree(rexDir);
      // Small delay to ensure different timestamps
      await new Promise((r) => setTimeout(r, 10));
    }

    // Verify 15 backups exist
    let backups = await getAvailableBackups(rexDir);
    expect(backups.length).toBe(15);

    // Prune with cap of 10
    await pruneBackups(rexDir, 10);

    // Verify only 10 remain (newest 10)
    backups = await getAvailableBackups(rexDir);
    expect(backups.length).toBe(10);
  });

  it("should handle restore with empty target tree", async () => {
    // Create tree with content
    const epicDir = join(treeRoot, "epic_test");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "Test content");

    // Create backup
    const snapshot = await snapshotPRDTree(rexDir);
    expect(snapshot).not.toBeNull();

    // Delete the tree
    await rm(treeRoot, { recursive: true, force: true });

    // Restore should recreate the tree
    await restoreFromBackup(rexDir, snapshot!.timestamp);

    // Verify tree was restored
    const restored = await readFile(join(treeRoot, "epic_test", "index.md"), "utf-8");
    expect(restored).toBe("Test content");
  });

  it("should be idempotent when creating snapshots of the same tree state", async () => {
    // Create tree
    const epicDir = join(treeRoot, "epic_test");
    await mkdir(epicDir, { recursive: true });
    await writeFile(join(epicDir, "index.md"), "Test");

    // Create first backup
    const snapshot1 = await snapshotPRDTree(rexDir);

    // Wait a bit to ensure different timestamp
    await new Promise((r) => setTimeout(r, 100));

    // Create second backup (tree hasn't changed)
    const snapshot2 = await snapshotPRDTree(rexDir);

    // Both backups should exist (different timestamps)
    const backups = await getAvailableBackups(rexDir);
    expect(backups.length).toBe(2);

    // But both backups should contain the same content
    const content1 = await readFile(
      join(snapshot1!.backupPath, "epic_test", "index.md"),
      "utf-8",
    );
    const content2 = await readFile(
      join(snapshot2!.backupPath, "epic_test", "index.md"),
      "utf-8",
    );
    expect(content1).toBe(content2);
    expect(content1).toBe("Test");
  });

  it("should handle deeply nested tree structures", async () => {
    // Create nested structure: epic > feature > task
    const featureDir = join(treeRoot, "epic_nested", "feature_sub");
    const taskDir = join(featureDir, "task_item");
    await mkdir(taskDir, { recursive: true });
    await writeFile(join(taskDir, "index.md"), "Nested task");

    // Create backup
    const snapshot = await snapshotPRDTree(rexDir);
    expect(snapshot).not.toBeNull();

    // Verify backup contains nested structure
    const backupTaskFile = join(snapshot!.backupPath, "epic_nested", "feature_sub", "task_item", "index.md");
    const content = await readFile(backupTaskFile, "utf-8");
    expect(content).toBe("Nested task");
  });

  // ── Windows filename-safety regression ───────────────────────────────────────
  //
  // The snapshot directory name used to embed a raw ISO-8601 timestamp. `:` is
  // illegal in Windows filenames, so every snapshot failed with EINVAL — and
  // because callers downgraded the failure to a warning and continued, Windows
  // users ran destructive tree rewrites with no rollback at all.

  it("names the snapshot directory without characters Windows forbids", async () => {
    await mkdir(join(treeRoot, "epic_test"), { recursive: true });
    await writeFile(join(treeRoot, "epic_test", "index.md"), "Test");

    const snapshot = await snapshotPRDTree(rexDir);
    expect(snapshot).not.toBeNull();

    const dirName = snapshot!.backupPath.split(/[\\/]/).pop()!;
    // <>:"/\|?* are all reserved on Windows.
    expect(dirName).not.toMatch(/[<>:"/\\|?*]/);
    // The directory really exists — proves the mkdir/cp actually succeeded.
    expect((await stat(snapshot!.backupPath)).isDirectory()).toBe(true);
  });

  it("keeps snapshot ids chronologically sortable after colon encoding", async () => {
    await mkdir(join(treeRoot, "epic_test"), { recursive: true });
    await writeFile(join(treeRoot, "epic_test", "index.md"), "Test");

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const snap = await snapshotPRDTree(rexDir);
      ids.push(snap!.id);
      await new Promise((r) => setTimeout(r, 50));
    }

    // getAvailableBackups relies on lexicographic sort meaning chronological
    // order. Encoding must not break that.
    expect([...ids].sort()).toEqual(ids);
  });

  it("restores from a raw ISO timestamp as well as an encoded id", async () => {
    await mkdir(join(treeRoot, "epic_test"), { recursive: true });
    await writeFile(join(treeRoot, "epic_test", "index.md"), "original");

    const snapshot = await snapshotPRDTree(rexDir);
    await writeFile(join(treeRoot, "epic_test", "index.md"), "mutated");

    // Callers holding the ISO timestamp (the pre-fix identifier) still work.
    await restoreFromBackup(rexDir, snapshot!.timestamp);
    expect(await readFile(join(treeRoot, "epic_test", "index.md"), "utf-8")).toBe("original");
  });

  it("replaces the tree on restore rather than overlaying it", async () => {
    await mkdir(join(treeRoot, "epic_test"), { recursive: true });
    await writeFile(join(treeRoot, "epic_test", "index.md"), "original");

    const snapshot = await snapshotPRDTree(rexDir);

    // Simulate a command that ADDS an item after the snapshot was taken.
    await mkdir(join(treeRoot, "epic_added"), { recursive: true });
    await writeFile(join(treeRoot, "epic_added", "index.md"), "added later");

    await restoreFromBackup(rexDir, snapshot!.id);

    // A plain recursive copy would leave epic_added behind, producing a tree
    // that is the union of both states instead of the snapshot's point in time.
    const entries = await readdir(treeRoot);
    expect(entries).toContain("epic_test");
    expect(entries).not.toContain("epic_added");
  });
});
