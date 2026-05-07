/**
 * Regression tests for single-child compaction feature.
 *
 * These tests focus on the compactSingleChildren migration function
 * and its integration with parser round-tripping to ensure metadata is preserved.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { compactSingleChildren } from "../../src/core/compact-single-children.js";
import { parseFolderTree } from "../../src/store/folder-tree-parser.js";

let testDir: string;

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `single-child-regression-${Date.now()}-${randomUUID().slice(0, 8)}`,
  );
  await mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

/**
 * Create a pre-optimization fixture with 3 over-wrapped single-child directories
 */
async function createFixture(prdTreeRoot: string): Promise<void> {
  // Fixture 1: epic-a → feature-a → task-a
  await mkdir(join(prdTreeRoot, "epic-a", "feature-a", "task-a"), { recursive: true });
  await writeFile(join(prdTreeRoot, "epic-a", "index.md"), `---\nid: "epic-a-id"\nlevel: "epic"\ntitle: "Epic A"\nstatus: "pending"\n---\n# Epic A\n`);
  await writeFile(join(prdTreeRoot, "epic-a", "feature-a", "index.md"), `---\nid: "feature-a-id"\nlevel: "feature"\ntitle: "Feature A"\nstatus: "pending"\nacceptanceCriteria: []\n---\n# Feature A\n`);
  await writeFile(join(prdTreeRoot, "epic-a", "feature-a", "task-a", "index.md"), `---\nid: "task-a-id"\nlevel: "task"\ntitle: "Task A"\nstatus: "pending"\nacceptanceCriteria: []\n---\n# Task A\n`);

  // Fixture 2: epic-b → feature-b → task-b → subtask-b
  await mkdir(join(prdTreeRoot, "epic-b", "feature-b", "task-b", "subtask-b"), { recursive: true });
  await writeFile(join(prdTreeRoot, "epic-b", "index.md"), `---\nid: "epic-b-id"\nlevel: "epic"\ntitle: "Epic B"\nstatus: "pending"\n---\n# Epic B\n`);
  await writeFile(join(prdTreeRoot, "epic-b", "feature-b", "index.md"), `---\nid: "feature-b-id"\nlevel: "feature"\ntitle: "Feature B"\nstatus: "pending"\nacceptanceCriteria: []\npriority: "high"\n---\n# Feature B\n`);
  await writeFile(join(prdTreeRoot, "epic-b", "feature-b", "task-b", "index.md"), `---\nid: "task-b-id"\nlevel: "task"\ntitle: "Task B"\nstatus: "in_progress"\nacceptanceCriteria: []\n---\n# Task B\n`);
  await writeFile(join(prdTreeRoot, "epic-b", "feature-b", "task-b", "subtask-b", "index.md"), `---\nid: "subtask-b-id"\nlevel: "subtask"\ntitle: "Subtask B"\nstatus: "pending"\n---\n# Subtask B\n`);

  // Fixture 3: epic-c → feature-c → task-c (with metadata)
  await mkdir(join(prdTreeRoot, "epic-c", "feature-c", "task-c"), { recursive: true });
  await writeFile(join(prdTreeRoot, "epic-c", "index.md"), `---\nid: "epic-c-id"\nlevel: "epic"\ntitle: "Epic C"\nstatus: "in_progress"\npriority: "high"\ndescription: "Epic C description"\ntags:\n  - "important"\n  - "core"\n---\n# Epic C\n`);
  await writeFile(join(prdTreeRoot, "epic-c", "feature-c", "index.md"), `---\nid: "feature-c-id"\nlevel: "feature"\ntitle: "Feature C"\nstatus: "pending"\ndescription: "Feature C description"\npriority: "critical"\nacceptanceCriteria:\n  - "AC1"\n  - "AC2"\n---\n# Feature C\n`);
  await writeFile(join(prdTreeRoot, "epic-c", "feature-c", "task-c", "index.md"), `---\nid: "task-c-id"\nlevel: "task"\ntitle: "Task C"\nstatus: "pending"\ndescription: "Task C description"\npriority: "medium"\nacceptanceCriteria:\n  - "Task AC1"\n---\n# Task C\n`);
}

describe("reshape command: single-child compaction migration", () => {
  it("compacts fixture tree with 3 over-wrapped directories in one reshape run", async () => {
    const prdTreeRoot = join(testDir, ".rex", "prd_tree");
    await mkdir(prdTreeRoot, { recursive: true });
    await createFixture(prdTreeRoot);

    const result = await compactSingleChildren(prdTreeRoot);

    // Should detect and compact 3 single-child wrappers
    expect(result.compactedCount).toBe(3);
    expect(result.errors).toHaveLength(0);
  });

  // Note: Idempotency is tested in unit tests. This integration test verifies
  // that compaction works correctly on fixture trees created manually.
});

describe("parseFolderTree: compacted tree round-trip fidelity", () => {
  it("compacted fixture tree round-trips with all metadata intact", async () => {
    const prdTreeRoot = join(testDir, ".rex", "prd_tree");
    await mkdir(prdTreeRoot, { recursive: true });
    await createFixture(prdTreeRoot);
    await compactSingleChildren(prdTreeRoot);

    const result = await parseFolderTree(prdTreeRoot);
    expect(result.warnings).toHaveLength(0);

    // Verify structure is correct after round-trip
    const epicIds = result.items.map((e) => e.id).sort();
    expect(epicIds).toContain("epic-a-id");
    expect(epicIds).toContain("epic-b-id");
    expect(epicIds).toContain("epic-c-id");

    // Verify epic-a → feature-a → task-a structure
    const epicA = result.items.find((e) => e.id === "epic-a-id")!;
    expect(epicA.title).toBe("Epic A");
    expect(epicA.children).toHaveLength(1);
    expect(epicA.children![0].id).toBe("feature-a-id");
    expect(epicA.children![0].children![0].id).toBe("task-a-id");

    // Verify epic-b → feature-b → task-b → subtask-b structure
    const epicB = result.items.find((e) => e.id === "epic-b-id")!;
    const featureB = epicB.children![0];
    expect(featureB.id).toBe("feature-b-id");
    expect(featureB.priority).toBe("high");
    const taskB = featureB.children![0];
    expect(taskB.id).toBe("task-b-id");
    expect(taskB.status).toBe("in_progress");
    expect(taskB.children![0].id).toBe("subtask-b-id");

    // Verify epic-c metadata is preserved
    const epicC = result.items.find((e) => e.id === "epic-c-id")!;
    expect(epicC.status).toBe("in_progress");
    expect(epicC.priority).toBe("high");
    expect(epicC.tags).toEqual(["important", "core"]);
    const featureC = epicC.children![0];
    expect(featureC.priority).toBe("critical");
    expect(featureC.acceptanceCriteria).toEqual(["AC1", "AC2"]);
  });
});
