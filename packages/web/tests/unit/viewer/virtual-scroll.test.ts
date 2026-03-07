// @vitest-environment jsdom
/**
 * Unit tests for the virtual scrolling engine.
 *
 * Tests the pure functions (flattenVisibleTree, computeVisibleRange,
 * findFlatNodeIndex) that power the PRD tree virtual scroll.
 * These functions have zero DOM dependencies and are fully deterministic.
 */
import { describe, it, expect } from "vitest";
import {
  flattenVisibleTree,
  computeVisibleRange,
  findFlatNodeIndex,
  DEFAULT_ITEM_HEIGHT,
  DEFAULT_BUFFER_COUNT,
} from "../../../src/viewer/components/prd-tree/virtual-scroll.js";
import type { FlatNode } from "../../../src/viewer/components/prd-tree/virtual-scroll.js";
import type { PRDItemData, ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** All statuses — matches everything. */
const ALL_STATUSES: Set<ItemStatus> = new Set([
  "pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted",
]);

/** Default "Active Work" filter. */
const ACTIVE_WORK: Set<ItemStatus> = new Set(["pending", "in_progress", "blocked"]);

function makeItem(
  overrides: Partial<PRDItemData> & Pick<PRDItemData, "id" | "title" | "level" | "status">,
): PRDItemData {
  return { ...overrides };
}

function generateTasks(n: number, status: ItemStatus = "pending"): PRDItemData[] {
  return Array.from({ length: n }, (_, i) =>
    makeItem({ id: `task-${i}`, title: `Task ${i}`, level: "task", status }),
  );
}

function buildSimpleTree(taskCount: number): PRDItemData[] {
  return [
    makeItem({
      id: "epic-1",
      title: "Epic 1",
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({
          id: "feature-1",
          title: "Feature 1",
          level: "feature",
          status: "in_progress",
          children: generateTasks(taskCount),
        }),
      ],
    }),
  ];
}

// ─── flattenVisibleTree ─────────────────────────────────────────────────────

describe("flattenVisibleTree", () => {
  it("returns empty array for empty items", () => {
    const result = flattenVisibleTree([], new Set(), ALL_STATUSES);
    expect(result).toEqual([]);
  });

  it("flattens flat list of items at depth 0", () => {
    const items = generateTasks(3);
    const result = flattenVisibleTree(items, new Set(), ALL_STATUSES);

    expect(result).toHaveLength(3);
    expect(result.map((n) => n.item.id)).toEqual(["task-0", "task-1", "task-2"]);
    expect(result.every((n) => n.depth === 0)).toBe(true);
    expect(result.every((n) => !n.hasChildren)).toBe(true);
    expect(result.every((n) => !n.isExpanded)).toBe(true);
  });

  it("includes expanded children at depth+1", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({ id: "task-1", title: "Task", level: "task", status: "pending" }),
        ],
      }),
    ];
    const expanded = new Set(["epic-1"]);
    const result = flattenVisibleTree(items, expanded, ALL_STATUSES);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ depth: 0, hasChildren: true, isExpanded: true });
    expect(result[0].item.id).toBe("epic-1");
    expect(result[1]).toMatchObject({ depth: 1, hasChildren: false, isExpanded: false });
    expect(result[1].item.id).toBe("task-1");
  });

  it("excludes collapsed children", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({ id: "task-1", title: "Task", level: "task", status: "pending" }),
        ],
      }),
    ];
    const result = flattenVisibleTree(items, new Set(), ALL_STATUSES);

    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("epic-1");
    expect(result[0].hasChildren).toBe(true);
    expect(result[0].isExpanded).toBe(false);
  });

  it("respects status filter (excludes non-matching items)", () => {
    const items = [
      makeItem({ id: "t1", title: "Pending", level: "task", status: "pending" }),
      makeItem({ id: "t2", title: "Completed", level: "task", status: "completed" }),
      makeItem({ id: "t3", title: "In Progress", level: "task", status: "in_progress" }),
    ];
    const filter: Set<ItemStatus> = new Set(["pending"]);
    const result = flattenVisibleTree(items, new Set(), filter);

    expect(result).toHaveLength(1);
    expect(result[0].item.id).toBe("t1");
  });

  it("includes parent when child matches filter", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "completed",
        children: [
          makeItem({ id: "task-1", title: "Task", level: "task", status: "pending" }),
        ],
      }),
    ];
    const expanded = new Set(["epic-1"]);
    const filter: Set<ItemStatus> = new Set(["pending"]);
    const result = flattenVisibleTree(items, expanded, filter);

    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe("epic-1");
    expect(result[1].item.id).toBe("task-1");
  });

  it("handles deep nesting with selective expansion", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        title: "E",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({
            id: "f1",
            title: "F",
            level: "feature",
            status: "in_progress",
            children: [
              makeItem({ id: "t1", title: "T", level: "task", status: "pending" }),
            ],
          }),
        ],
      }),
    ];
    // Only epic expanded, not feature
    const expanded = new Set(["e1"]);
    const result = flattenVisibleTree(items, expanded, ALL_STATUSES);

    expect(result).toHaveLength(2);
    expect(result[0].item.id).toBe("e1");
    expect(result[1].item.id).toBe("f1");
    expect(result[1].hasChildren).toBe(true);
    expect(result[1].isExpanded).toBe(false);
  });

  it("fully expands deep hierarchy", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        title: "E",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({
            id: "f1",
            title: "F",
            level: "feature",
            status: "in_progress",
            children: [
              makeItem({
                id: "t1",
                title: "T",
                level: "task",
                status: "in_progress",
                children: [
                  makeItem({ id: "s1", title: "S1", level: "subtask", status: "pending" }),
                  makeItem({ id: "s2", title: "S2", level: "subtask", status: "pending" }),
                ],
              }),
            ],
          }),
        ],
      }),
    ];
    const expanded = new Set(["e1", "f1", "t1"]);
    const result = flattenVisibleTree(items, expanded, ALL_STATUSES);

    expect(result).toHaveLength(5);
    expect(result.map((n) => n.depth)).toEqual([0, 1, 2, 3, 3]);
    expect(result.map((n) => n.item.id)).toEqual(["e1", "f1", "t1", "s1", "s2"]);
  });

  it("preserves render order across multiple top-level items", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1",
        title: "E1",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "T1", level: "task", status: "pending" }),
        ],
      }),
      makeItem({
        id: "e2",
        title: "E2",
        level: "epic",
        status: "in_progress",
        children: [
          makeItem({ id: "t2", title: "T2", level: "task", status: "pending" }),
        ],
      }),
    ];
    const expanded = new Set(["e1", "e2"]);
    const result = flattenVisibleTree(items, expanded, ALL_STATUSES);

    expect(result.map((n) => n.item.id)).toEqual(["e1", "t1", "e2", "t2"]);
  });

  it("handles large flat tree (500+ items)", () => {
    const items = generateTasks(500);
    const result = flattenVisibleTree(items, new Set(), ALL_STATUSES);

    expect(result).toHaveLength(500);
  });

  it("handles large hierarchical tree", () => {
    const items = buildSimpleTree(500);
    const expanded = new Set(["epic-1", "feature-1"]);
    const result = flattenVisibleTree(items, expanded, ALL_STATUSES);

    // 1 epic + 1 feature + 500 tasks = 502
    expect(result).toHaveLength(502);
  });
});

// ─── computeVisibleRange ────────────────────────────────────────────────────

describe("computeVisibleRange", () => {
  it("returns empty range for zero items", () => {
    const range = computeVisibleRange(0, 400, 0);
    expect(range).toEqual({ start: 0, end: 0, offsetY: 0 });
  });

  it("returns full range when container height is 0 (unmeasured)", () => {
    const range = computeVisibleRange(0, 0, 100, 40, 5);
    expect(range.start).toBe(0);
    expect(range.end).toBe(100);
    expect(range.offsetY).toBe(0);
  });

  it("returns full range when all items fit in viewport", () => {
    // 5 items × 40px = 200px. Container is 400px.
    const range = computeVisibleRange(0, 400, 5, 40, 0);
    expect(range.start).toBe(0);
    expect(range.end).toBe(5);
    expect(range.offsetY).toBe(0);
  });

  it("computes correct range at scroll top", () => {
    // 100 items × 40px. Container 400px. At scroll top.
    // visibleCount = ceil(400/40) = 10 → items 0-10
    const range = computeVisibleRange(0, 400, 100, 40, 0);
    expect(range.start).toBe(0);
    expect(range.end).toBe(10);
  });

  it("computes correct range for scrolled position", () => {
    // Scrolled to 400px → startIdx = 10
    // visibleCount = 10 → items 10-20
    const range = computeVisibleRange(400, 400, 100, 40, 0);
    expect(range.start).toBe(10);
    expect(range.end).toBe(20);
    expect(range.offsetY).toBe(400);
  });

  it("includes buffer items above and below", () => {
    // Scrolled to 400px → startIdx = 10, visibleCount = 10
    // Buffer 5 → start = 5, end = 25
    const range = computeVisibleRange(400, 400, 100, 40, 5);
    expect(range.start).toBe(5);
    expect(range.end).toBe(25);
    expect(range.offsetY).toBe(5 * 40);
  });

  it("clamps start to 0 when buffer exceeds scroll position", () => {
    // Scrolled to 80px → startIdx = 2, buffer = 5 → start = max(0, -3) = 0
    const range = computeVisibleRange(80, 400, 100, 40, 5);
    expect(range.start).toBe(0);
  });

  it("clamps end to totalCount near bottom", () => {
    // Scrolled to 3800px → startIdx = 95, visibleCount = 10
    // end = min(100, 95 + 10 + 5) = 100
    const range = computeVisibleRange(3800, 400, 100, 40, 5);
    expect(range.end).toBe(100);
  });

  it("computes correct offsetY based on start", () => {
    const range = computeVisibleRange(600, 400, 100, 40, 3);
    // startIdx = 15, start = 12, offsetY = 12 * 40 = 480
    expect(range.offsetY).toBe(range.start * 40);
  });

  it("uses default item height and buffer count", () => {
    const range = computeVisibleRange(
      DEFAULT_ITEM_HEIGHT * 50, // scroll to item 50
      DEFAULT_ITEM_HEIGHT * 10, // viewport fits 10 items
      200,
    );
    // With defaults: start = 50 - DEFAULT_BUFFER_COUNT, end = 50 + 10 + DEFAULT_BUFFER_COUNT
    expect(range.start).toBe(50 - DEFAULT_BUFFER_COUNT);
    expect(range.end).toBe(50 + 10 + DEFAULT_BUFFER_COUNT);
  });

  it("handles fractional scroll positions", () => {
    // Scroll at 65px with 40px items → startIdx = floor(65/40) = 1
    const range = computeVisibleRange(65, 400, 100, 40, 0);
    expect(range.start).toBe(1);
  });
});

// ─── findFlatNodeIndex ──────────────────────────────────────────────────────

describe("findFlatNodeIndex", () => {
  const flatNodes: FlatNode[] = generateTasks(5).map((item) => ({
    item,
    depth: 0,
    isExpanded: false,
    hasChildren: false,
  }));

  it("finds existing item by ID", () => {
    expect(findFlatNodeIndex(flatNodes, "task-0")).toBe(0);
    expect(findFlatNodeIndex(flatNodes, "task-2")).toBe(2);
    expect(findFlatNodeIndex(flatNodes, "task-4")).toBe(4);
  });

  it("returns -1 for non-existent ID", () => {
    expect(findFlatNodeIndex(flatNodes, "nonexistent")).toBe(-1);
  });

  it("returns -1 for empty array", () => {
    expect(findFlatNodeIndex([], "task-0")).toBe(-1);
  });
});

// ─── Constants ──────────────────────────────────────────────────────────────

describe("DEFAULT_ITEM_HEIGHT", () => {
  it("is a positive number", () => {
    expect(DEFAULT_ITEM_HEIGHT).toBeGreaterThan(0);
  });
});

describe("DEFAULT_BUFFER_COUNT", () => {
  it("is a positive number", () => {
    expect(DEFAULT_BUFFER_COUNT).toBeGreaterThan(0);
  });
});
