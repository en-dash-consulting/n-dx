// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  countVisibleNodes,
  sliceVisibleTree,
  DEFAULT_CHUNK_SIZE,
  PROGRESSIVE_THRESHOLD,
  LoadMoreIndicator,
} from "../../../src/viewer/components/progressive-loader.js";
import type { PRDItemData, ItemStatus } from "../../../src/viewer/components/prd-tree/types.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** All statuses — matches everything. */
const ALL_STATUSES: Set<ItemStatus> = new Set([
  "pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted",
]);

/** Default "Active Work" filter (pending, in_progress, blocked). */
const ACTIVE_WORK: Set<ItemStatus> = new Set(["pending", "in_progress", "blocked"]);

function makeItem(
  overrides: Partial<PRDItemData> & Pick<PRDItemData, "id" | "title" | "level" | "status">,
): PRDItemData {
  return { ...overrides };
}

/** Generate N flat tasks with sequential IDs. */
function generateTasks(n: number, statusFn?: (i: number) => ItemStatus): PRDItemData[] {
  return Array.from({ length: n }, (_, i) =>
    makeItem({
      id: `task-${i}`,
      title: `Task ${i}`,
      level: "task",
      status: statusFn ? statusFn(i) : "pending",
    }),
  );
}

/** Build a simple hierarchy: 1 epic → 1 feature → N tasks. */
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

/** Build a multi-epic tree for testing cross-branch slicing. */
function buildMultiEpicTree(epicsCount: number, tasksPerEpic: number): PRDItemData[] {
  return Array.from({ length: epicsCount }, (_, ei) =>
    makeItem({
      id: `epic-${ei}`,
      title: `Epic ${ei}`,
      level: "epic",
      status: "in_progress",
      children: [
        makeItem({
          id: `feature-${ei}-0`,
          title: `Feature ${ei}-0`,
          level: "feature",
          status: "in_progress",
          children: Array.from({ length: tasksPerEpic }, (_, ti) =>
            makeItem({
              id: `task-${ei}-${ti}`,
              title: `Task ${ei}-${ti}`,
              level: "task",
              status: "pending",
            }),
          ),
        }),
      ],
    }),
  );
}

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => {
    render(vnode, root);
  });
  return root;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("countVisibleNodes", () => {
  it("returns 0 for an empty tree", () => {
    expect(countVisibleNodes([], ALL_STATUSES)).toBe(0);
  });

  it("counts flat items", () => {
    const items = generateTasks(5);
    expect(countVisibleNodes(items, ALL_STATUSES)).toBe(5);
  });

  it("counts hierarchical items (epic + feature + tasks)", () => {
    const items = buildSimpleTree(3);
    // 1 epic + 1 feature + 3 tasks = 5
    expect(countVisibleNodes(items, ALL_STATUSES)).toBe(5);
  });

  it("excludes items that do not match the status filter", () => {
    const items: PRDItemData[] = [
      makeItem({ id: "t1", title: "Pending", level: "task", status: "pending" }),
      makeItem({ id: "t2", title: "Completed", level: "task", status: "completed" }),
      makeItem({ id: "t3", title: "In Progress", level: "task", status: "in_progress" }),
    ];
    const filter: Set<ItemStatus> = new Set(["pending"]);
    expect(countVisibleNodes(items, filter)).toBe(1);
  });

  it("includes parent when any descendant matches the filter", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "epic-1",
        title: "Epic",
        level: "epic",
        status: "completed",
        children: [
          makeItem({ id: "t1", title: "Pending Task", level: "task", status: "pending" }),
        ],
      }),
    ];
    // Filter is "pending" only — the epic itself is "completed" but has a pending child
    const filter: Set<ItemStatus> = new Set(["pending"]);
    expect(countVisibleNodes(items, filter)).toBe(2); // epic + task
  });

  it("counts deeply nested items", () => {
    const items: PRDItemData[] = [
      makeItem({
        id: "e1", title: "E", level: "epic", status: "in_progress",
        children: [
          makeItem({
            id: "f1", title: "F", level: "feature", status: "in_progress",
            children: [
              makeItem({
                id: "t1", title: "T", level: "task", status: "in_progress",
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
    expect(countVisibleNodes(items, ALL_STATUSES)).toBe(5);
  });
});

describe("sliceVisibleTree", () => {
  describe("no slicing needed (under limit)", () => {
    it("returns original items when tree fits within limit", () => {
      const items = generateTasks(3);
      const result = sliceVisibleTree(items, ALL_STATUSES, 10);

      expect(result.items).toBe(items); // Same reference
      expect(result.renderedCount).toBe(3);
      expect(result.totalCount).toBe(3);
    });

    it("returns original items when tree exactly matches limit", () => {
      const items = generateTasks(5);
      const result = sliceVisibleTree(items, ALL_STATUSES, 5);

      expect(result.items).toBe(items);
      expect(result.renderedCount).toBe(5);
      expect(result.totalCount).toBe(5);
    });
  });

  describe("flat list slicing", () => {
    it("slices flat list to the specified limit", () => {
      const items = generateTasks(10);
      const result = sliceVisibleTree(items, ALL_STATUSES, 5);

      expect(result.items).toHaveLength(5);
      expect(result.renderedCount).toBe(5);
      expect(result.totalCount).toBe(10);
    });

    it("preserves item order", () => {
      const items = generateTasks(10);
      const result = sliceVisibleTree(items, ALL_STATUSES, 3);

      expect(result.items.map((i) => i.id)).toEqual(["task-0", "task-1", "task-2"]);
    });

    it("respects status filter when slicing", () => {
      const items: PRDItemData[] = [
        makeItem({ id: "t1", title: "Pending 1", level: "task", status: "pending" }),
        makeItem({ id: "t2", title: "Completed", level: "task", status: "completed" }),
        makeItem({ id: "t3", title: "Pending 2", level: "task", status: "pending" }),
        makeItem({ id: "t4", title: "Pending 3", level: "task", status: "pending" }),
      ];

      const filter: Set<ItemStatus> = new Set(["pending"]);
      const result = sliceVisibleTree(items, filter, 2);

      expect(result.renderedCount).toBe(2);
      expect(result.totalCount).toBe(3); // 3 pending items total
      expect(result.items.map((i) => i.id)).toEqual(["t1", "t3"]);
    });
  });

  describe("hierarchical slicing", () => {
    it("preserves parent structure when slicing children", () => {
      const items = buildSimpleTree(10);
      // Budget 5: epic(1) + feature(1) + 3 tasks = 5 nodes
      const result = sliceVisibleTree(items, ALL_STATUSES, 5);

      expect(result.renderedCount).toBe(5);
      expect(result.totalCount).toBe(12); // 1+1+10
      expect(result.items).toHaveLength(1); // 1 epic
      expect(result.items[0].children).toHaveLength(1); // 1 feature
      expect(result.items[0].children![0].children).toHaveLength(3); // 3 tasks
    });

    it("slices across multiple top-level branches", () => {
      // 3 epics × (1 feature + 5 tasks) = 3 × 7 = 21 visible nodes
      const items = buildMultiEpicTree(3, 5);

      // Budget 10: epic0(1) + feature0(1) + 5 tasks(5) + epic1(1) + feature1(1) + 1 task = 10
      const result = sliceVisibleTree(items, ALL_STATUSES, 10);

      expect(result.renderedCount).toBe(10);
      expect(result.totalCount).toBe(21);
      expect(result.items).toHaveLength(2); // 2 epics fit (partially)
    });

    it("maintains structural sharing for untruncated items", () => {
      // 2 epics × (1 feature + 2 tasks) = 2 × 4 = 8 total
      const items = buildMultiEpicTree(2, 2);

      // Budget large enough for first epic but not second
      // First epic: 1 + 1 + 2 = 4 nodes. Budget = 5 leaves 1 for second epic.
      const result = sliceVisibleTree(items, ALL_STATUSES, 5);

      // First epic should be the same reference (all children survived)
      expect(result.items[0]).toBe(items[0]);
    });

    it("creates new objects only at truncation boundaries", () => {
      const items = buildSimpleTree(10);
      // Budget 4: epic + feature + 2 tasks
      const result = sliceVisibleTree(items, ALL_STATUSES, 4);

      // The epic and feature got new references (children were truncated)
      expect(result.items[0]).not.toBe(items[0]);
      // But the tasks that survived are the same references
      const originalTasks = items[0].children![0].children!;
      expect(result.items[0].children![0].children![0]).toBe(originalTasks[0]);
      expect(result.items[0].children![0].children![1]).toBe(originalTasks[1]);
    });
  });

  describe("edge cases", () => {
    it("handles limit of 0", () => {
      const items = generateTasks(5);
      const result = sliceVisibleTree(items, ALL_STATUSES, 0);

      expect(result.items).toHaveLength(0);
      expect(result.renderedCount).toBe(0);
      expect(result.totalCount).toBe(5);
    });

    it("handles limit of 1", () => {
      const items = buildSimpleTree(5);
      const result = sliceVisibleTree(items, ALL_STATUSES, 1);

      expect(result.renderedCount).toBe(1);
      // Only the epic, no children (budget exhausted)
      expect(result.items).toHaveLength(1);
      expect(result.items[0].children).toBeUndefined();
    });

    it("handles deeply nested tree with small budget", () => {
      const items: PRDItemData[] = [
        makeItem({
          id: "e1", title: "E", level: "epic", status: "in_progress",
          children: [
            makeItem({
              id: "f1", title: "F", level: "feature", status: "in_progress",
              children: [
                makeItem({
                  id: "t1", title: "T", level: "task", status: "in_progress",
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

      // Budget 3: epic + feature + task (no subtasks)
      const result = sliceVisibleTree(items, ALL_STATUSES, 3);
      expect(result.renderedCount).toBe(3);
      expect(result.items[0].children![0].children![0].children).toBeUndefined();
    });

    it("handles empty tree", () => {
      const result = sliceVisibleTree([], ALL_STATUSES, 50);
      expect(result.items).toEqual([]);
      expect(result.renderedCount).toBe(0);
      expect(result.totalCount).toBe(0);
    });
  });
});

describe("DEFAULT_CHUNK_SIZE", () => {
  it("is a positive integer", () => {
    expect(DEFAULT_CHUNK_SIZE).toBeGreaterThan(0);
    expect(Number.isInteger(DEFAULT_CHUNK_SIZE)).toBe(true);
  });
});

describe("PROGRESSIVE_THRESHOLD", () => {
  it("is a positive integer", () => {
    expect(PROGRESSIVE_THRESHOLD).toBeGreaterThan(0);
    expect(Number.isInteger(PROGRESSIVE_THRESHOLD)).toBe(true);
  });

  it("equals DEFAULT_CHUNK_SIZE (progressive loading activates at first chunk boundary)", () => {
    expect(PROGRESSIVE_THRESHOLD).toBe(DEFAULT_CHUNK_SIZE);
  });
});

describe("LoadMoreIndicator", () => {
  it("shows rendered and total count", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    expect(root.textContent).toContain("Showing 50 of 200 nodes");
  });

  it("shows next chunk size in load more button", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    expect(root.textContent).toContain("Load 50 more");
  });

  it("shows remaining count when less than chunk size", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 180,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    expect(root.textContent).toContain("Load 20 more");
  });

  it("shows load all button with remaining count", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    expect(root.textContent).toContain("Load all (150)");
  });

  it("disables buttons when loading", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: true,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    const buttons = root.querySelectorAll("button");
    for (const btn of buttons) {
      expect(btn.disabled).toBe(true);
    }
  });

  it("shows loading text when loading", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: true,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    const buttons = root.querySelectorAll("button");
    // Both buttons should show "Loading…"
    expect(buttons[0].textContent).toContain("Loading");
    expect(buttons[1].textContent).toContain("Loading");
  });

  it("calls onLoadMore when primary button is clicked", () => {
    const onLoadMore = vi.fn();
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore,
        onLoadAll: () => {},
      }),
    );
    const btn = root.querySelector(".prd-load-more-btn-primary") as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it("calls onLoadAll when secondary button is clicked", () => {
    const onLoadAll = vi.fn();
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll,
      }),
    );
    const btn = root.querySelector(".prd-load-more-btn-secondary") as HTMLButtonElement;
    act(() => {
      btn.click();
    });
    expect(onLoadAll).toHaveBeenCalledTimes(1);
  });

  it("has a progress bar with correct aria attributes", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 75,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    const progressbar = root.querySelector("[role='progressbar']");
    expect(progressbar).not.toBeNull();
    expect(progressbar!.getAttribute("aria-valuenow")).toBe("75");
    expect(progressbar!.getAttribute("aria-valuemax")).toBe("200");
  });

  it("has role=status and aria-live for screen reader announcements", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    const container = root.querySelector(".prd-load-more");
    expect(container!.getAttribute("role")).toBe("status");
    expect(container!.getAttribute("aria-live")).toBe("polite");
  });

  it("has accessible labels on buttons", () => {
    const root = renderToDiv(
      h(LoadMoreIndicator, {
        renderedCount: 50,
        totalCount: 200,
        chunkSize: 50,
        isLoading: false,
        onLoadMore: () => {},
        onLoadAll: () => {},
      }),
    );
    const primary = root.querySelector(".prd-load-more-btn-primary");
    const secondary = root.querySelector(".prd-load-more-btn-secondary");
    expect(primary!.getAttribute("aria-label")).toContain("50 more");
    expect(secondary!.getAttribute("aria-label")).toContain("150 remaining");
  });
});
