/**
 * Integration test for the rex store → tree → task-selection pipeline.
 *
 * Exercises the in-process contract between:
 *   1. FileStore (store/file-adapter.ts) — persistence
 *   2. Tree utilities (core/tree.ts) — traversal and mutation
 *   3. Task selection (core/next-task.ts) — prioritization
 *
 * This test catches store mutation regressions that currently require
 * a full CLI spawn (e2e) to detect, by exercising the pipeline in-process.
 *
 * @see packages/rex/src/store/file-adapter.ts
 * @see packages/rex/src/core/tree.ts
 * @see packages/rex/src/core/next-task.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveStore,
  findItem,
  walkTree,
  collectAllIds,
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  computeTimestampUpdates,
  findAutoCompletions,
  computeStats,
  SCHEMA_VERSION,
} from "../../src/public.js";
import { ensureRexDir } from "../../src/store/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import type { PRDDocument, PRDItem } from "../../src/schema/v1.js";

describe("store → tree → task-selection pipeline", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-pipeline-test-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** Create a store with initial PRD items. */
  async function createStore(items: PRDItem[]) {
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Pipeline Test",
      items,
    };
    const store = await resolveStore(rexDir);
    await store.saveDocument(doc);
    return store;
  }

  it("roundtrips a document through store, walks tree, and selects next task", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Authentication",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feat-1",
            title: "Login flow",
            level: "feature",
            status: "pending",
            priority: "high",
            children: [
              {
                id: "task-1",
                title: "Implement login form",
                level: "task",
                status: "completed",
                priority: "high",
                children: [],
              },
              {
                id: "task-2",
                title: "Add validation",
                level: "task",
                status: "pending",
                priority: "high",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const store = await createStore(items);
    const doc = await store.loadDocument();

    // Tree traversal
    const allIds = collectAllIds(doc.items);
    expect(allIds.size).toBe(4); // epic + feature + 2 tasks

    // Task selection
    const next = findNextTask(doc.items);
    expect(next).not.toBeNull();
    expect(next!.item.id).toBe("task-2"); // Only pending task

    // Completed IDs
    const completed = collectCompletedIds(doc.items);
    expect(completed.has("task-1")).toBe(true);
    expect(completed.size).toBe(1);
  });

  it("store mutation propagates to task selection", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            priority: "high",
            children: [
              {
                id: "task-a",
                title: "First",
                level: "task",
                status: "pending",
                priority: "critical",
                children: [],
              },
              {
                id: "task-b",
                title: "Second",
                level: "task",
                status: "pending",
                priority: "medium",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const store = await createStore(items);

    // Task-a should be selected first (critical priority)
    let doc = await store.loadDocument();
    let next = findNextTask(doc.items);
    expect(next!.item.id).toBe("task-a");

    // Complete task-a through the store
    const timestamps = computeTimestampUpdates("pending", "completed");
    await store.updateItem("task-a", {
      status: "completed",
      resolutionType: "code-change",
      ...timestamps,
    });

    // After reload, task-b should be next
    doc = await store.loadDocument();
    next = findNextTask(doc.items);
    expect(next).not.toBeNull();
    expect(next!.item.id).toBe("task-b");
  });

  it("findAutoCompletions cascades from completed leaf to parent", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            priority: "high",
            children: [
              {
                id: "task-1",
                title: "Only task",
                level: "task",
                status: "completed",
                priority: "high",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const store = await createStore(items);
    const doc = await store.loadDocument();

    const completions = findAutoCompletions(doc.items, "task-1");
    expect(completions.completedIds).toContain("feat-1");
  });

  it("computeStats reflects tree structure accurately", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            priority: "high",
            children: [
              {
                id: "task-done",
                title: "Done",
                level: "task",
                status: "completed",
                priority: "high",
                children: [],
              },
              {
                id: "task-pending",
                title: "Pending",
                level: "task",
                status: "pending",
                priority: "medium",
                children: [],
              },
              {
                id: "task-failing",
                title: "Failing",
                level: "task",
                status: "failing",
                priority: "critical",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const store = await createStore(items);
    const doc = await store.loadDocument();
    const stats = computeStats(doc.items);

    // computeStats only counts work items (tasks/subtasks), not containers
    expect(stats.total).toBe(3); // 3 tasks (epic is a container)
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1); // task-pending only
    expect(stats.failing).toBe(1);
  });

  it("findItem returns correct entry with parent chain from store", async () => {
    const items: PRDItem[] = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            children: [
              {
                id: "task-1",
                title: "Deep Task",
                level: "task",
                status: "pending",
                children: [],
              },
            ],
          },
        ],
      },
    ];

    const store = await createStore(items);
    const doc = await store.loadDocument();
    const entry = findItem(doc.items, "task-1");

    expect(entry).not.toBeNull();
    expect(entry!.item.title).toBe("Deep Task");
    expect(entry!.parents.map((p) => p.id)).toEqual(["epic-1", "feat-1"]);
  });

  it("addItem + findNextTask selects newly added task", async () => {
    const store = await createStore([
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feat-1",
            title: "Feature",
            level: "feature",
            status: "pending",
            priority: "high",
            children: [],
          },
        ],
      },
    ]);

    // Initially the feature is actionable (leaf with no task children)
    let doc = await store.loadDocument();
    let actionable = findActionableTasks(doc.items, collectCompletedIds(doc.items));
    expect(actionable.length).toBe(1);
    expect(actionable[0].item.id).toBe("feat-1");

    // Add a task under the feature
    await store.addItem({
      id: "task-new",
      title: "New Task",
      level: "task",
      status: "pending",
      priority: "critical",
      children: [],
    }, "feat-1");

    // Now the new task is actionable; the feature is no longer a leaf
    doc = await store.loadDocument();
    actionable = findActionableTasks(doc.items, collectCompletedIds(doc.items));
    expect(actionable.length).toBe(1);
    expect(actionable[0].item.id).toBe("task-new");
  });
});
