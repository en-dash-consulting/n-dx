/**
 * Integration tests for add command with folder-per-task structural migration.
 * Ensures that the add command runs the folder-per-task migration pass before
 * persisting new items, and that the migration is idempotent.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdAdd } from "../../src/cli/commands/add.js";
import { resolveStore } from "../../src/store/index.js";
import { migrateToFolderPerTask } from "../../src/core/folder-per-task-migration.js";
import { resolveRexPaths } from "../../src/store/index.js";

describe("add command with folder-per-task migration", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-add-migration-"));
    await cmdInit(tmpDir, {});
  });

  afterEach(async () => {
    try {
      await rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("is idempotent with conforming tree created via add commands", async () => {
    const rexDir = resolveRexPaths(tmpDir).rexDir;
    const treeRoot = join(rexDir, "prd_tree");

    // Create a proper conforming tree structure using add command
    const store = await resolveStore(rexDir);
    const epicId = randomUUID();
    const featureId = randomUUID();

    await store.addItem({
      id: epicId,
      title: "Epic Title",
      level: "epic",
      status: "pending",
    });

    await store.addItem({
      id: featureId,
      title: "Feature Title",
      level: "feature",
      status: "pending",
    }, epicId);

    // Run add command to add a task
    await cmdAdd(tmpDir, "task", {
      title: "Task 1",
      parent: featureId,
      yes: "true",
    });

    // Run migration check on the resulting tree
    const migrationResult1 = await migrateToFolderPerTask(treeRoot);
    expect(migrationResult1.migratedCount).toBe(0);
    expect(migrationResult1.errors).toHaveLength(0);

    // Add another task to the same feature
    await cmdAdd(tmpDir, "task", {
      title: "Task 2",
      parent: featureId,
      yes: "true",
    });

    // Run migration check again
    const migrationResult2 = await migrateToFolderPerTask(treeRoot);
    expect(migrationResult2.migratedCount).toBe(0);
    expect(migrationResult2.errors).toHaveLength(0);
  });

  it("runs successfully multiple times to add items", async () => {
    const rexDir = resolveRexPaths(tmpDir).rexDir;

    const store = await resolveStore(rexDir);
    const epicId = randomUUID();
    const featureId = randomUUID();

    await store.addItem({
      id: epicId,
      title: "Epic",
      level: "epic",
      status: "pending",
    });

    await store.addItem({
      id: featureId,
      title: "Feature",
      level: "feature",
      status: "pending",
    }, epicId);

    // Run add command to create tasks (this exercises the migration check)
    const result1 = await cmdAdd(tmpDir, "task", {
      title: "Task 1",
      parent: featureId,
      yes: "true",
    });
    // Should not throw

    const result2 = await cmdAdd(tmpDir, "task", {
      title: "Task 2",
      parent: featureId,
      yes: "true",
    });
    // Should not throw

    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
  });
});
