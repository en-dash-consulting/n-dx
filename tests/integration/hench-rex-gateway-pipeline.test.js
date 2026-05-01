/**
 * Hench → rex-gateway pipeline integration test.
 *
 * Verifies the end-to-end data flow from hench's rex-gateway through
 * to actual rex operations using built dist/ artifacts. This is the
 * highest-value missing contract test since hench's rex-gateway imports
 * 19+ functions from rex.
 *
 * Unlike gateway-pipeline.test.js (which tests individual function calls),
 * this test exercises composed multi-step workflows: store load → task
 * selection → status update → auto-completion cascade.
 *
 * @see packages/hench/src/prd/rex-gateway.ts
 * @see TESTING.md — gateway admission criterion
 */

import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Import from built dist/ artifacts to test the compiled boundary
const gw = await import("../../packages/hench/dist/prd/rex-gateway.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(items) {
  const tmpDir = mkdtempSync(join(tmpdir(), "hench-rex-gw-test-"));
  const rexDir = join(tmpDir, ".rex");
  mkdirSync(rexDir, { recursive: true });

  const doc = {
    schema: gw.SCHEMA_VERSION,
    title: "Gateway Test",
    items: items || [],
  };

  // Write tree-meta.json with the document title
  writeFileSync(
    join(rexDir, "tree-meta.json"),
    JSON.stringify({ title: doc.title }),
    "utf-8",
  );

  // Create minimal folder-tree structure for tests
  mkdirSync(join(rexDir, gw.PRD_TREE_DIRNAME), { recursive: true });

  // Write each item to the folder tree
  // Simple implementation: just write epics for now (test items are simple)
  for (const item of doc.items) {
    const itemDir = join(rexDir, gw.PRD_TREE_DIRNAME, item.id);
    mkdirSync(itemDir, { recursive: true });
    const markdown = createItemMarkdown(item);
    writeFileSync(join(itemDir, "index.md"), markdown, "utf-8");

    // Handle nested items (features, tasks, etc.)
    if (item.children && Array.isArray(item.children)) {
      for (const child of item.children) {
        const childDir = join(itemDir, child.id);
        mkdirSync(childDir, { recursive: true });
        const childMarkdown = createItemMarkdown(child);
        writeFileSync(join(childDir, "index.md"), childMarkdown, "utf-8");

        // Handle nested tasks
        if (child.children && Array.isArray(child.children)) {
          for (const grandchild of child.children) {
            const grandchildDir = join(childDir, grandchild.id);
            mkdirSync(grandchildDir, { recursive: true });
            const grandchildMarkdown = createItemMarkdown(grandchild);
            writeFileSync(join(grandchildDir, "index.md"), grandchildMarkdown, "utf-8");
          }
        }
      }
    }
  }

  writeFileSync(
    join(rexDir, "config.json"),
    JSON.stringify({
      schema: gw.SCHEMA_VERSION,
      project: "test",
      adapter: "file",
    }),
    "utf-8",
  );

  return { tmpDir, rexDir };
}

function createItemMarkdown(item) {
  const lines = ["---"];
  lines.push(`id: "${item.id}"`);
  lines.push(`level: "${item.level}"`);
  lines.push(`title: "${item.title}"`);
  lines.push(`status: "${item.status}"`);
  lines.push(`priority: "${item.priority || "medium"}"`);
  if (item.description) {
    lines.push(`description: "${item.description}"`);
  }
  lines.push("---");
  lines.push("");
  lines.push(`# ${item.title}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("hench → rex gateway composed workflows", () => {
  const cleanupDirs = [];

  afterEach(() => {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    cleanupDirs.length = 0;
  });

  it("resolveStore → findNextTask → computeTimestampUpdates → findAutoCompletions pipeline", async () => {
    const { tmpDir, rexDir } = makeTmpProject([
      {
        id: "feat-1",
        title: "Feature",
        level: "feature",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "task-1",
            title: "Only Task",
            level: "task",
            status: "pending",
            priority: "high",
            children: [],
          },
        ],
      },
    ]);
    cleanupDirs.push(tmpDir);

    // Step 1: Load store
    const store = await gw.resolveStore(rexDir);
    const doc = await store.loadDocument();
    expect(doc.items.length).toBe(1);

    // Step 2: Select next task
    const next = gw.findNextTask(doc.items);
    expect(next).not.toBeNull();
    expect(next.item.id).toBe("task-1");

    // Step 3: Compute timestamp updates for status transition
    const timestamps = gw.computeTimestampUpdates("pending", "in_progress");
    expect(timestamps.startedAt).toBeDefined();

    // Step 4: Simulate completing the task and check auto-completion
    // First mark it completed in the tree
    doc.items[0].children[0].status = "completed";
    const completions = gw.findAutoCompletions(doc.items, "task-1");
    expect(completions.completedIds).toContain("feat-1");
  });

  it("findActionableTasks filters completed items correctly", async () => {
    const { tmpDir } = makeTmpProject([
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "task-done",
            title: "Done",
            level: "task",
            status: "completed",
            priority: "critical",
            children: [],
          },
          {
            id: "task-todo",
            title: "Todo",
            level: "task",
            status: "pending",
            priority: "medium",
            children: [],
          },
          {
            id: "task-blocked",
            title: "Blocked",
            level: "task",
            status: "pending",
            priority: "high",
            blockedBy: ["task-todo"],
            children: [],
          },
        ],
      },
    ]);
    cleanupDirs.push(tmpDir);

    const items = [
      {
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          { id: "task-done", title: "Done", level: "task", status: "completed", priority: "critical", children: [] },
          { id: "task-todo", title: "Todo", level: "task", status: "pending", priority: "medium", children: [] },
          { id: "task-blocked", title: "Blocked", level: "task", status: "pending", priority: "high", blockedBy: ["task-todo"], children: [] },
        ],
      },
    ];

    const completed = gw.collectCompletedIds(items);
    const actionable = gw.findActionableTasks(items, completed);
    const ids = actionable.map((a) => a.item.id);

    // task-done is completed → not actionable
    expect(ids).not.toContain("task-done");
    // task-todo is pending → actionable
    expect(ids).toContain("task-todo");
    // task-blocked depends on task-todo → not actionable
    expect(ids).not.toContain("task-blocked");
  });

  it("schema version functions validate correctly through gateway", () => {
    expect(gw.isCompatibleSchema(gw.SCHEMA_VERSION)).toBe(true);
    expect(gw.isCompatibleSchema("invalid/v999")).toBe(false);

    expect(() =>
      gw.assertSchemaVersion({ schema: gw.SCHEMA_VERSION }),
    ).not.toThrow();

    expect(() =>
      gw.assertSchemaVersion({ schema: "invalid/v1" }),
    ).toThrow();
  });

  it("level helpers classify correctly through gateway", () => {
    expect(gw.isRootLevel("epic")).toBe(true);
    expect(gw.isRootLevel("task")).toBe(false);
    expect(gw.isWorkItem("task")).toBe(true);
    expect(gw.isWorkItem("subtask")).toBe(true);
    expect(gw.isWorkItem("feature")).toBe(false);
  });

  it("walkTree traverses full depth through gateway", () => {
    const items = [
      {
        id: "root",
        children: [
          {
            id: "child-1",
            children: [
              { id: "grandchild", children: [] },
            ],
          },
          { id: "child-2", children: [] },
        ],
      },
    ];

    const entries = [...gw.walkTree(items)];
    expect(entries.map((e) => e.item.id)).toEqual([
      "root",
      "child-1",
      "grandchild",
      "child-2",
    ]);
  });

  it("collectCompletedIds works through gateway", () => {
    const items = [
      {
        id: "epic-1",
        status: "pending",
        children: [
          { id: "t1", status: "completed", children: [] },
          { id: "t2", status: "pending", children: [] },
          { id: "t3", status: "completed", children: [] },
        ],
      },
    ];

    const completed = gw.collectCompletedIds(items);
    expect(completed.size).toBe(2);
    expect(completed.has("t1")).toBe(true);
    expect(completed.has("t3")).toBe(true);
    expect(completed.has("t2")).toBe(false);
  });
});
