/**
 * Integration tests for single-child compaction in reshape command.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

describe("reshape command with single-child compaction", () => {
  let testDir: string;
  let rexDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-reshape-compact-${randomUUID()}`);
    rexDir = join(testDir, ".rex");
    await mkdir(rexDir, { recursive: true });

    // Initialize minimal rex directory structure
    // (just prd_tree, no config needed for compaction test)
    const prdTreeRoot = join(rexDir, "prd_tree");
    await mkdir(prdTreeRoot, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("detects single-child directories in the prd_tree", async () => {
    // Create a pre-optimization folder tree with a single-child wrapper
    const prdTreeRoot = join(rexDir, "prd_tree");
    const epicDir = join(prdTreeRoot, "epic-123");
    const featureDir = join(epicDir, "feature-456");
    const taskDir = join(featureDir, "task-789");

    await mkdir(taskDir, { recursive: true });

    // Write wrapper (parent) metadata
    const wrapperIndex = `---
id: "feature-456-id"
level: "feature"
title: "Feature 456"
status: "pending"
---

# Feature 456
`;
    await writeFile(join(featureDir, "index.md"), wrapperIndex);

    // Write child (task) metadata
    const childIndex = `---
id: "task-789-id"
level: "task"
title: "Task 789"
status: "pending"
---

# Task 789
`;
    await writeFile(join(taskDir, "index.md"), childIndex);

    // Import compaction module and run directly
    const { compactSingleChildren } = await import("../../../src/core/compact-single-children.js");

    // Run compaction
    const result = await compactSingleChildren(prdTreeRoot);

    // Verify that compaction was detected and executed
    expect(result.compactedCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify that the task was moved to epic level
    const movedTaskDir = join(epicDir, "task-789");
    const movedTaskIndex = await readdir(movedTaskDir)
      .then(() => readdir(movedTaskDir))
      .then((files) => files.includes("index.md"))
      .catch(() => false);

    expect(movedTaskIndex).toBe(true);

    // Verify that the wrapper directory was deleted
    const wrapperStillExists = await readdir(featureDir)
      .then(() => true)
      .catch(() => false);

    expect(wrapperStillExists).toBe(false);
  });
});
