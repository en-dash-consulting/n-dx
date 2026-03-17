/**
 * Gateway pipeline integration tests — verifies end-to-end data flow
 * through gateway modules with real in-process instances.
 *
 * Unlike cross-package-contracts.test.js (which validates export existence),
 * these tests exercise multi-step pipelines: store → gateway → result.
 *
 * @see packages/hench/src/prd/rex-gateway.ts
 * @see packages/hench/src/prd/llm-gateway.ts
 * @see TESTING.md — gateway admission criterion
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// hench → rex gateway pipeline: task selection flow
// ---------------------------------------------------------------------------

describe("hench → rex gateway pipeline", () => {
  it("resolveStore → findNextTask → computeTimestampUpdates pipeline", async () => {
    const gw = await import("../../packages/hench/dist/prd/rex-gateway.js");

    // Build a minimal PRD tree with actionable tasks
    const items = [
      {
        id: "epic-1",
        title: "Test Epic",
        level: "epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feature-1",
            title: "Test Feature",
            level: "feature",
            status: "pending",
            priority: "high",
            children: [
              {
                id: "task-1",
                title: "Test Task",
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

    // findNextTask should pick the only pending task
    // Returns a TreeEntry { item, parents } or the item directly
    const next = gw.findNextTask(items);
    expect(next).not.toBeNull();
    const nextId = next.item ? next.item.id : next.id;
    expect(nextId).toBe("task-1");

    // computeTimestampUpdates should produce timestamps for the transition
    const timestamps = gw.computeTimestampUpdates("pending", "in_progress");
    expect(timestamps).toBeDefined();
    expect(timestamps.startedAt).toBeDefined();

    // findAutoCompletions returns { completedIds, completedItems }
    const completions = gw.findAutoCompletions(items, "task-1");
    expect(completions).toBeDefined();
    expect(Array.isArray(completions.completedIds)).toBe(true);
  });

  it("walkTree yields all items in correct order", async () => {
    const gw = await import("../../packages/hench/dist/prd/rex-gateway.js");

    const items = [
      {
        id: "a",
        children: [
          { id: "b", children: [{ id: "c", children: [] }] },
          { id: "d", children: [] },
        ],
      },
    ];

    const visited = [];
    for (const entry of gw.walkTree(items)) {
      visited.push({ id: entry.item.id, depth: entry.parents.length });
    }

    expect(visited).toEqual([
      { id: "a", depth: 0 },
      { id: "b", depth: 1 },
      { id: "c", depth: 2 },
      { id: "d", depth: 1 },
    ]);
  });

  it("collectCompletedIds + findActionableTasks work together", async () => {
    const gw = await import("../../packages/hench/dist/prd/rex-gateway.js");

    const items = [
      {
        id: "epic-1",
        title: "E",
        level: "epic",
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
            id: "task-todo",
            title: "Todo",
            level: "task",
            status: "pending",
            priority: "high",
            children: [],
          },
        ],
      },
    ];

    const completed = gw.collectCompletedIds(items);
    expect(completed.has("task-done")).toBe(true);
    expect(completed.has("task-todo")).toBe(false);

    const actionable = gw.findActionableTasks(items);
    expect(actionable.length).toBeGreaterThan(0);
    // May return TreeEntry { item, parents } or direct items
    const getItemId = (t) => t.item ? t.item.id : t.id;
    expect(actionable.some((t) => getItemId(t) === "task-todo")).toBe(true);
    expect(actionable.some((t) => getItemId(t) === "task-done")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hench → llm-client gateway pipeline: config + output flow
// ---------------------------------------------------------------------------

describe("hench → llm-client gateway pipeline", () => {
  it("PROJECT_DIRS contains expected directory keys", async () => {
    const gw = await import("../../packages/hench/dist/prd/llm-gateway.js");

    expect(gw.PROJECT_DIRS).toBeDefined();
    expect(typeof gw.PROJECT_DIRS.HENCH).toBe("string");
    expect(typeof gw.PROJECT_DIRS.REX).toBe("string");
    expect(typeof gw.PROJECT_DIRS.SOURCEVISION).toBe("string");
  });

  it("toCanonicalJSON produces deterministic output", async () => {
    const gw = await import("../../packages/hench/dist/prd/llm-gateway.js");

    const obj = { b: 2, a: 1, c: [3, 1, 2] };
    const json1 = gw.toCanonicalJSON(obj);
    const json2 = gw.toCanonicalJSON(obj);

    expect(json1).toBe(json2);
    expect(typeof json1).toBe("string");
    // Should be valid JSON
    const parsed = JSON.parse(json1);
    expect(parsed.a).toBe(1);
    expect(parsed.b).toBe(2);
  });

  it("quiet mode toggles output suppression", async () => {
    const gw = await import("../../packages/hench/dist/prd/llm-gateway.js");

    // Default should be not quiet
    const wasQuiet = gw.isQuiet();

    gw.setQuiet(true);
    expect(gw.isQuiet()).toBe(true);

    gw.setQuiet(false);
    expect(gw.isQuiet()).toBe(false);

    // Restore original state
    gw.setQuiet(wasQuiet);
  });

  it("CLIError and ClaudeClientError are proper error classes", async () => {
    const gw = await import("../../packages/hench/dist/prd/llm-gateway.js");

    const cliErr = new gw.CLIError("test error");
    expect(cliErr).toBeInstanceOf(Error);
    expect(cliErr.message).toBe("test error");

    const clientErr = new gw.ClaudeClientError("client error", "api");
    expect(clientErr).toBeInstanceOf(Error);
    expect(clientErr.message).toBe("client error");
  });
});
