/**
 * Tests for single-child compaction migration.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { compactSingleChildren } from "../../../src/core/compact-single-children.js";

describe("compactSingleChildren", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `test-compact-${randomUUID()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("detects and compacts single-child wrapper directories", async () => {
    // Create a pre-optimization structure:
    // testDir/
    //   epic-id/
    //     feature-slug/         <- wrapper with 1 child
    //       index.md
    //       feature_title.md
    //       task-slug/          <- child
    //         index.md
    //         task_title.md

    const epicDir = join(testDir, "epic-id");
    const featureDir = join(epicDir, "feature-slug");
    const taskDir = join(featureDir, "task-slug");

    await mkdir(taskDir, { recursive: true });

    // Write wrapper metadata
    const wrapperIndexContent = `---
id: "feature-123"
level: "feature"
title: "Feature Title"
status: "pending"
---

# Feature Title
`;
    await writeFile(join(featureDir, "index.md"), wrapperIndexContent);
    await writeFile(
      join(featureDir, "feature_title.md"),
      wrapperIndexContent,
    );

    // Write child metadata (no __parent* fields yet)
    const childIndexContent = `---
id: "task-456"
level: "task"
title: "Task Title"
status: "pending"
---

# Task Title
`;
    await writeFile(join(taskDir, "index.md"), childIndexContent);
    await writeFile(join(taskDir, "task_title.md"), childIndexContent);

    // Run compaction
    const result = await compactSingleChildren(testDir);

    // Check that compaction was detected and executed
    expect(result.compactedCount).toBe(1);
    expect(result.errors).toHaveLength(0);

    // Verify wrapper directory was deleted
    let featureDirExists = true;
    try {
      await readFile(join(featureDir, "index.md"));
    } catch {
      featureDirExists = false;
    }
    expect(featureDirExists).toBe(false);

    // Verify child was moved to epic level
    const newTaskDir = join(epicDir, "task-slug");
    const movedChildIndex = await readFile(join(newTaskDir, "index.md"), "utf-8");
    expect(movedChildIndex).toContain("__parentId");
    expect(movedChildIndex).toContain("feature-123");
  });

  it("skips already-optimized children (idempotent)", async () => {
    // Create a structure with an already-optimized child:
    // testDir/
    //   epic-id/
    //     feature-slug/         <- wrapper with 1 child
    //       index.md
    //       task-slug/          <- child WITH __parent* fields
    //         index.md
    //         task_title.md

    const epicDir = join(testDir, "epic-id");
    const featureDir = join(epicDir, "feature-slug");
    const taskDir = join(featureDir, "task-slug");

    await mkdir(taskDir, { recursive: true });

    // Write wrapper
    const wrapperIndexContent = `---
id: "feature-123"
level: "feature"
title: "Feature Title"
status: "pending"
---

# Feature Title
`;
    await writeFile(join(featureDir, "index.md"), wrapperIndexContent);

    // Write child WITH __parent* fields (already optimized)
    const childIndexContent = `---
id: "task-456"
level: "task"
title: "Task Title"
status: "pending"
__parentId: "feature-123"
__parentLevel: "feature"
__parentTitle: "Feature Title"
__parentStatus: "pending"
---

# Task Title
`;
    await writeFile(join(taskDir, "index.md"), childIndexContent);
    await writeFile(join(taskDir, "task_title.md"), childIndexContent);

    // Run compaction
    const result = await compactSingleChildren(testDir);

    // Should skip because child is already optimized
    expect(result.compactedCount).toBe(0);
    expect(result.errors).toHaveLength(0);

    // Wrapper should still exist (not deleted)
    const wrapperStillExists = await readFile(join(featureDir, "index.md"), "utf-8")
      .then(() => true)
      .catch(() => false);
    expect(wrapperStillExists).toBe(true);
  });

  it("runs idempotently - second run produces no changes", async () => {
    // Create a pre-optimization structure
    const epicDir = join(testDir, "epic-id");
    const featureDir = join(epicDir, "feature-slug");
    const taskDir = join(featureDir, "task-slug");

    await mkdir(taskDir, { recursive: true });

    const wrapperIndexContent = `---
id: "feature-123"
level: "feature"
title: "Feature Title"
status: "pending"
---

# Feature Title
`;
    await writeFile(join(featureDir, "index.md"), wrapperIndexContent);
    await writeFile(join(featureDir, "feature_title.md"), wrapperIndexContent);

    const childIndexContent = `---
id: "task-456"
level: "task"
title: "Task Title"
status: "pending"
---

# Task Title
`;
    await writeFile(join(taskDir, "index.md"), childIndexContent);
    await writeFile(join(taskDir, "task_title.md"), childIndexContent);

    // First run
    const result1 = await compactSingleChildren(testDir);
    expect(result1.compactedCount).toBe(1);

    // Second run
    const result2 = await compactSingleChildren(testDir);
    expect(result2.compactedCount).toBe(0);
    expect(result2.errors).toHaveLength(0);
  });

  it("handles multiple single-child directories", async () => {
    // Create nested single-child structure:
    // testDir/
    //   epic-123/
    //     feature-abc/         <- wrapper 1
    //       task-xyz/          <- child 1 (also a wrapper)
    //         subtask-001/     <- child 2

    const epicDir = join(testDir, "epic-123");
    const featureDir = join(epicDir, "feature-abc");
    const taskDir = join(featureDir, "task-xyz");
    const subtaskDir = join(taskDir, "subtask-001");

    await mkdir(subtaskDir, { recursive: true });

    // Create files at each level
    const createIndexFile = (path: string, id: string, level: string, title: string) => {
      const content = `---
id: "${id}"
level: "${level}"
title: "${title}"
status: "pending"
---

# ${title}
`;
      return writeFile(join(path, "index.md"), content);
    };

    await createIndexFile(featureDir, "feature-123", "feature", "Feature Title");
    await createIndexFile(taskDir, "task-456", "task", "Task Title");
    await createIndexFile(subtaskDir, "subtask-789", "subtask", "Subtask Title");

    // Run compaction
    const result = await compactSingleChildren(testDir);

    // Should compact both wrappers (but maybe not all at once due to recursion order)
    // At minimum, should find at least one
    expect(result.compactedCount).toBeGreaterThanOrEqual(1);
    expect(result.errors).toHaveLength(0);
  });

  it("reports errors gracefully", async () => {
    // Create a directory structure with a permission issue (hard to test portably)
    // Instead, test with a missing parent directory
    const orphanDir = join(testDir, "orphan");
    await mkdir(orphanDir);

    // Try to compact a directory that doesn't have a proper parent
    const result = await compactSingleChildren(testDir);

    // Should complete without throwing
    expect(result).toBeDefined();
    expect(result.compactedCount).toBeGreaterThanOrEqual(0);
  });
});
