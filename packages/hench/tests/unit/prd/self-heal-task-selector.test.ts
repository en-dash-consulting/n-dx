/**
 * Unit tests: task selector tag filtering in self-heal mode.
 *
 * Verifies that `findActionableTasks` and `findNextTask` — consumed via the
 * rex-gateway — honour the self-heal tag filter and never return untagged
 * items when the filter is active.
 *
 * Also contains a sentinel that explicitly fails when `SELF_HEAL_TAG` is
 * renamed without updating the fixture strings, preventing silent drift
 * between the constant and the tag strings used in real PRDs.
 */

import { describe, it, expect } from "vitest";
import { findActionableTasks, findNextTask } from "../../../src/prd/rex-gateway.js";
import { SELF_HEAL_TAG } from "@n-dx/rex/dist/store/index.js";
import type { PRDItem } from "../../../src/prd/rex-gateway.js";

// ---------------------------------------------------------------------------
// Sentinel
// ---------------------------------------------------------------------------

/**
 * This test will fail if someone renames SELF_HEAL_TAG without also updating
 * fixture PRDs and the integration tests in this file.  The failure message
 * is the signal to audit and update every hard-coded "self-heal" string.
 */
it("SELF_HEAL_TAG matches the fixture tag string used throughout self-heal tests", () => {
  // The string literal below is intentionally hard-coded so that renaming
  // SELF_HEAL_TAG (e.g. to "sh" or "auto-heal") causes this assertion to fail.
  const FIXTURE_TAG = "self-heal-items";
  expect(SELF_HEAL_TAG).toBe(FIXTURE_TAG);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeTask(
  id: string,
  opts: { tags?: string[]; priority?: PRDItem["priority"]; status?: PRDItem["status"] } = {},
): PRDItem {
  return {
    id,
    title: `Task ${id}`,
    level: "task",
    status: opts.status ?? "pending",
    priority: opts.priority ?? "medium",
    tags: opts.tags,
    children: [],
  };
}

/**
 * Mixed tree: one task tagged with SELF_HEAL_TAG, one untagged.
 *
 *   epic-root
 *     task-tagged   (tags: [SELF_HEAL_TAG], priority: high)
 *     task-untagged (no tags, priority: critical)
 */
function makeMixedTree(): PRDItem[] {
  return [
    {
      id: "epic-root",
      title: "Root Epic",
      level: "epic",
      status: "pending",
      children: [
        makeTask("task-tagged", { tags: [SELF_HEAL_TAG], priority: "high" }),
        makeTask("task-untagged", { priority: "critical" }),
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// findActionableTasks — tag filter scoping
// ---------------------------------------------------------------------------

describe("findActionableTasks with SELF_HEAL_TAG filter", () => {
  it("returns only the tagged task when self-heal filter is active", () => {
    const items = makeMixedTree();
    const results = findActionableTasks(items, new Set(), 20, { tags: [SELF_HEAL_TAG] });

    expect(results).toHaveLength(1);
    expect(results[0].item.id).toBe("task-tagged");
  });

  it("never returns an untagged task when self-heal filter is active", () => {
    const items = makeMixedTree();
    const results = findActionableTasks(items, new Set(), 20, { tags: [SELF_HEAL_TAG] });

    const untaggedInResults = results.find((e) => e.item.id === "task-untagged");
    expect(untaggedInResults).toBeUndefined();
  });

  it("returns all tasks when no filter is applied", () => {
    const items = makeMixedTree();
    const results = findActionableTasks(items, new Set(), 20);

    expect(results).toHaveLength(2);
  });

  it("returns empty when every tagged task is already completed", () => {
    const items: PRDItem[] = [
      {
        id: "epic-root",
        title: "Root Epic",
        level: "epic",
        status: "pending",
        children: [
          makeTask("task-tagged", { tags: [SELF_HEAL_TAG], status: "completed" }),
          makeTask("task-untagged"),
        ],
      },
    ];
    const completed = new Set(["task-tagged"]);
    const results = findActionableTasks(items, completed, 20, { tags: [SELF_HEAL_TAG] });

    expect(results).toHaveLength(0);
  });

  it("all returned items carry the self-heal tag", () => {
    const items: PRDItem[] = [
      {
        id: "epic-root",
        title: "Root",
        level: "epic",
        status: "pending",
        children: [
          makeTask("t1", { tags: [SELF_HEAL_TAG] }),
          makeTask("t2", { tags: [SELF_HEAL_TAG, "extra"] }),
          makeTask("t3"), // untagged — must not appear
        ],
      },
    ];
    const results = findActionableTasks(items, new Set(), 20, { tags: [SELF_HEAL_TAG] });

    expect(results.length).toBeGreaterThan(0);
    for (const entry of results) {
      expect(entry.item.tags).toContain(SELF_HEAL_TAG);
    }
  });
});

// ---------------------------------------------------------------------------
// findNextTask — tag filter scoping
// ---------------------------------------------------------------------------

describe("findNextTask with SELF_HEAL_TAG filter", () => {
  it("selects the tagged task even when the untagged task has higher priority", () => {
    // task-untagged is critical, task-tagged is high — without filter, untagged wins.
    const items = makeMixedTree();
    const result = findNextTask(items, new Set(), { tags: [SELF_HEAL_TAG] });

    expect(result).not.toBeNull();
    expect(result!.item.id).toBe("task-tagged");
  });

  it("returns null when no actionable tasks carry the self-heal tag", () => {
    const items: PRDItem[] = [
      {
        id: "epic-root",
        title: "Root Epic",
        level: "epic",
        status: "pending",
        children: [makeTask("task-untagged")],
      },
    ];
    const result = findNextTask(items, new Set(), { tags: [SELF_HEAL_TAG] });

    expect(result).toBeNull();
  });
});
