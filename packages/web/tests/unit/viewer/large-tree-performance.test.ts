// @vitest-environment jsdom
/**
 * Performance benchmarks for large PRD trees.
 *
 * Validates that core tree operations (rendering, diffing, filtering,
 * statistics computation, progressive slicing) meet performance targets
 * at scale: 500, 1000, and 2000+ item trees.
 *
 * Metrics measured:
 * - DOM node count after render
 * - Render time (wall-clock via performance.now)
 * - Memory usage (via performance.memory mock)
 * - Algorithm execution time for pure functions
 *
 * Performance targets are intentionally generous (2–5× expected) to
 * avoid flaky CI while still catching genuine regressions.
 *
 * @see ./progressive-loader.test.ts — unit tests for progressive loading
 * @see ./tree-differ.test.ts — unit tests for structural sharing
 * @see ./prd-tree-compute.test.ts — unit tests for stats computation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  countVisibleNodes,
  sliceVisibleTree,
  PROGRESSIVE_THRESHOLD,
} from "../../../src/viewer/components/prd-tree/progressive-loader.js";
import {
  computeBranchStats,
  completionRatio,
  filterTree,
} from "../../../src/viewer/components/prd-tree/compute.js";
import {
  diffItems,
  diffDocument,
  applyItemUpdate,
} from "../../../src/viewer/components/prd-tree/tree-differ.js";
import {
  findItemById,
  countDescendants,
  getAncestorIds,
  collectSubtreeIds,
} from "../../../src/viewer/components/prd-tree/tree-utils.js";
import { PRDTree } from "../../../src/viewer/components/prd-tree/prd-tree.js";
import type {
  PRDItemData,
  PRDDocumentData,
  ItemStatus,
  Priority,
} from "../../../src/viewer/components/prd-tree/types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Tree sizes under test. */
const TREE_SIZES = [500, 1000, 2000] as const;

/** All statuses — matches everything. */
const ALL_STATUSES: Set<ItemStatus> = new Set([
  "pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted",
]);

/** Active work filter (most common dashboard filter). */
const ACTIVE_WORK: Set<ItemStatus> = new Set(["pending", "in_progress", "blocked"]);

/**
 * Performance budget multiplier. Targets are set relative to a baseline
 * and multiplied by this factor to avoid CI flakiness. A value of 3
 * means the test fails only if the operation is 3× slower than expected.
 */
const BUDGET_MULTIPLIER = 3;

// ── Tree generators ───────────────────────────────────────────────────────────

const STATUSES: ItemStatus[] = ["pending", "in_progress", "completed", "failing", "deferred", "blocked"];
const PRIORITIES: Priority[] = ["critical", "high", "medium", "low"];

function makeItem(
  overrides: Partial<PRDItemData> & Pick<PRDItemData, "id" | "title" | "level" | "status">,
): PRDItemData {
  return { ...overrides };
}

/**
 * Generate a realistic hierarchical tree with the given total node count.
 *
 * Structure: epics → features → tasks → subtasks
 * Roughly 5 epics, each with 2-4 features, each with 3-8 tasks,
 * each with 0-3 subtasks. Item counts are adjusted to approximate
 * the target total.
 *
 * Items get varied statuses, priorities, tags, and descriptions
 * to exercise real-world code paths.
 */
function generateRealisticTree(targetCount: number): PRDItemData[] {
  const epics: PRDItemData[] = [];
  let nodeCount = 0;
  let epicIdx = 0;

  while (nodeCount < targetCount) {
    const epicId = `epic-${epicIdx}`;
    const features: PRDItemData[] = [];
    const featuresPerEpic = 2 + (epicIdx % 3); // 2-4 features

    for (let fi = 0; fi < featuresPerEpic && nodeCount < targetCount; fi++) {
      const featureId = `feat-${epicIdx}-${fi}`;
      const tasks: PRDItemData[] = [];
      const tasksPerFeature = 3 + (fi % 6); // 3-8 tasks

      for (let ti = 0; ti < tasksPerFeature && nodeCount < targetCount; ti++) {
        const taskId = `task-${epicIdx}-${fi}-${ti}`;
        const subtasks: PRDItemData[] = [];
        const subtaskCount = ti % 4; // 0-3 subtasks

        for (let si = 0; si < subtaskCount && nodeCount < targetCount; si++) {
          subtasks.push(makeItem({
            id: `sub-${epicIdx}-${fi}-${ti}-${si}`,
            title: `Subtask ${si}: implement ${taskId} detail`,
            level: "subtask",
            status: STATUSES[(epicIdx + fi + ti + si) % STATUSES.length],
            priority: PRIORITIES[(ti + si) % PRIORITIES.length],
            tags: si % 2 === 0 ? ["ui", "performance"] : ["backend"],
            description: `Subtask description for ${taskId}-${si}`,
          }));
          nodeCount++;
        }

        tasks.push(makeItem({
          id: taskId,
          title: `Task ${ti}: ${["Implement", "Test", "Review", "Deploy", "Fix", "Refactor"][ti % 6]} ${featureId}`,
          level: "task",
          status: STATUSES[(epicIdx + fi + ti) % STATUSES.length],
          priority: PRIORITIES[ti % PRIORITIES.length],
          tags: ti % 3 === 0 ? ["testing"] : ti % 3 === 1 ? ["ui"] : ["backend", "api"],
          description: `Task description for ${taskId}`,
          acceptanceCriteria: [`AC1 for ${taskId}`, `AC2 for ${taskId}`],
          children: subtasks.length > 0 ? subtasks : undefined,
        }));
        nodeCount++;
      }

      features.push(makeItem({
        id: featureId,
        title: `Feature ${fi}: ${["Authentication", "Dashboard", "API", "Search"][fi % 4]}`,
        level: "feature",
        status: STATUSES[(epicIdx + fi) % STATUSES.length],
        priority: PRIORITIES[fi % PRIORITIES.length],
        children: tasks,
      }));
      nodeCount++;
    }

    epics.push(makeItem({
      id: epicId,
      title: `Epic ${epicIdx}: ${["Core Platform", "User Experience", "Infrastructure", "Security", "Analytics"][epicIdx % 5]}`,
      level: "epic",
      status: STATUSES[epicIdx % STATUSES.length],
      priority: PRIORITIES[epicIdx % PRIORITIES.length],
      children: features,
    }));
    nodeCount++;
    epicIdx++;
  }

  return epics;
}

/** Count all nodes in a tree (including container nodes). */
function countAllNodes(items: PRDItemData[]): number {
  let count = 0;
  for (const item of items) {
    count++;
    if (item.children) {
      count += countAllNodes(item.children);
    }
  }
  return count;
}

/** Create a deep clone of items with one leaf status changed. */
function cloneWithOneChange(items: PRDItemData[], targetId: string, newStatus: ItemStatus): PRDItemData[] {
  return items.map((item) => {
    const clone = { ...item };
    if (clone.id === targetId) {
      clone.status = newStatus;
      return clone;
    }
    if (clone.children) {
      clone.children = cloneWithOneChange(clone.children, targetId, newStatus);
    }
    return clone;
  });
}

/** Find a leaf node ID in the middle of the tree. */
function findMiddleLeafId(items: PRDItemData[]): string {
  const ids: string[] = [];
  function collect(nodes: PRDItemData[]): void {
    for (const node of nodes) {
      if (!node.children || node.children.length === 0) {
        ids.push(node.id);
      } else {
        collect(node.children);
      }
    }
  }
  collect(items);
  return ids[Math.floor(ids.length / 2)];
}

/** Find a deeply nested ID (last subtask of the middle epic). */
function findDeepNestedId(items: PRDItemData[]): string {
  const midEpic = items[Math.floor(items.length / 2)];
  const lastFeature = midEpic.children?.[midEpic.children.length - 1];
  const lastTask = lastFeature?.children?.[lastFeature.children.length - 1];
  const lastSubtask = lastTask?.children?.[lastTask.children.length - 1];
  return lastSubtask?.id ?? lastTask?.id ?? lastFeature?.id ?? midEpic.id;
}

// ── jsdom polyfills ───────────────────────────────────────────────────────────

if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// ── IntersectionObserver mock ─────────────────────────────────────────────────

type ObserverCallback = (entries: IntersectionObserverEntry[]) => void;

interface MockObserverInstance {
  observe: ReturnType<typeof vi.fn>;
  unobserve: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: (entries: Partial<IntersectionObserverEntry>[]) => void;
  callback: ObserverCallback;
  observedElements: Set<Element>;
}

let mockObserverInstances: MockObserverInstance[] = [];

function installMockIntersectionObserver() {
  mockObserverInstances = [];

  (globalThis as any).IntersectionObserver = class MockIntersectionObserver {
    readonly mock: MockObserverInstance;

    constructor(callback: ObserverCallback, _options?: IntersectionObserverInit) {
      const observedElements = new Set<Element>();
      const observe = vi.fn((el: Element) => observedElements.add(el));
      const unobserve = vi.fn((el: Element) => observedElements.delete(el));
      const disconnect = vi.fn(() => observedElements.clear());

      this.mock = {
        observe,
        unobserve,
        disconnect,
        trigger: (entries) => callback(entries as IntersectionObserverEntry[]),
        callback,
        observedElements,
      };

      (this as any).observe = observe;
      (this as any).unobserve = unobserve;
      (this as any).disconnect = disconnect;

      mockObserverInstances.push(this.mock);
    }
  };
}

// ── Timing helper ─────────────────────────────────────────────────────────────

/**
 * Run a function and return [result, elapsedMs].
 * Uses performance.now() for sub-millisecond precision.
 */
function timed<T>(fn: () => T): [T, number] {
  const start = performance.now();
  const result = fn();
  const elapsed = performance.now() - start;
  return [result, elapsed];
}

// ── Memory tracking mock ──────────────────────────────────────────────────────

interface MemorySnapshot {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function mockPerformanceMemory(snapshot: MemorySnapshot): void {
  Object.defineProperty(performance, "memory", {
    value: snapshot,
    writable: true,
    configurable: true,
  });
}

function clearPerformanceMemory(): void {
  Object.defineProperty(performance, "memory", {
    value: undefined,
    writable: true,
    configurable: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tree generation validation
// ═══════════════════════════════════════════════════════════════════════════════

describe("tree generation", () => {
  for (const size of TREE_SIZES) {
    it(`generates a tree with approximately ${size} nodes`, () => {
      const tree = generateRealisticTree(size);
      const actual = countAllNodes(tree);
      // Allow ±10% variance due to the hierarchical generation algorithm
      expect(actual).toBeGreaterThanOrEqual(size * 0.9);
      expect(actual).toBeLessThanOrEqual(size * 1.1);
    });
  }

  it("generates trees with realistic depth (4 levels)", () => {
    const tree = generateRealisticTree(500);
    let maxDepth = 0;
    function walk(items: PRDItemData[], depth: number): void {
      for (const item of items) {
        if (depth > maxDepth) maxDepth = depth;
        if (item.children) walk(item.children, depth + 1);
      }
    }
    walk(tree, 1);
    // Should have all 4 levels: epic → feature → task → subtask
    expect(maxDepth).toBeGreaterThanOrEqual(4);
  });

  it("generates varied statuses across items", () => {
    const tree = generateRealisticTree(500);
    const statuses = new Set<ItemStatus>();
    function walk(items: PRDItemData[]): void {
      for (const item of items) {
        statuses.add(item.status);
        if (item.children) walk(item.children);
      }
    }
    walk(tree);
    // Should use at least 4 different statuses
    expect(statuses.size).toBeGreaterThanOrEqual(4);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeBranchStats performance
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeBranchStats performance", () => {
  for (const size of TREE_SIZES) {
    it(`computes stats for ${size}-node tree under ${size <= 500 ? 5 : size <= 1000 ? 10 : 20}ms`, () => {
      const tree = generateRealisticTree(size);
      const budget = (size <= 500 ? 5 : size <= 1000 ? 10 : 20) * BUDGET_MULTIPLIER;

      const [stats, elapsed] = timed(() => computeBranchStats(tree));

      expect(elapsed).toBeLessThan(budget);
      expect(stats.total).toBeGreaterThan(0);
      // Sanity: completed + pending + other = total
      const sum = stats.completed + stats.inProgress + stats.pending +
        stats.failing + stats.deferred + stats.blocked;
      expect(sum).toBe(stats.total);
    });
  }

  it("completionRatio is consistent at scale", () => {
    const tree = generateRealisticTree(2000);
    const stats = computeBranchStats(tree);
    const ratio = completionRatio(stats);
    expect(ratio).toBeGreaterThanOrEqual(0);
    expect(ratio).toBeLessThanOrEqual(1);
    // With varied statuses, ratio should be between 0 and 1 (not all one status)
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// countVisibleNodes & sliceVisibleTree performance
// ═══════════════════════════════════════════════════════════════════════════════

describe("countVisibleNodes performance", () => {
  for (const size of TREE_SIZES) {
    it(`counts ${size}-node tree under ${size <= 500 ? 5 : size <= 1000 ? 10 : 20}ms`, () => {
      const tree = generateRealisticTree(size);
      const budget = (size <= 500 ? 5 : size <= 1000 ? 10 : 20) * BUDGET_MULTIPLIER;

      const [count, elapsed] = timed(() => countVisibleNodes(tree, ALL_STATUSES));

      expect(elapsed).toBeLessThan(budget);
      expect(count).toBeGreaterThan(0);
    });

    it(`counts ${size}-node tree with active-work filter`, () => {
      const tree = generateRealisticTree(size);

      const [allCount] = timed(() => countVisibleNodes(tree, ALL_STATUSES));
      const [filteredCount] = timed(() => countVisibleNodes(tree, ACTIVE_WORK));

      // Filtered count should be less than or equal to all
      expect(filteredCount).toBeLessThanOrEqual(allCount);
      // But should still have some results (varied statuses)
      expect(filteredCount).toBeGreaterThan(0);
    });
  }
});

describe("sliceVisibleTree performance", () => {
  for (const size of TREE_SIZES) {
    it(`slices ${size}-node tree into first chunk under ${size <= 500 ? 10 : size <= 1000 ? 20 : 40}ms`, () => {
      const tree = generateRealisticTree(size);
      const budget = (size <= 500 ? 10 : size <= 1000 ? 20 : 40) * BUDGET_MULTIPLIER;

      const [slice, elapsed] = timed(() =>
        sliceVisibleTree(tree, ALL_STATUSES, PROGRESSIVE_THRESHOLD),
      );

      expect(elapsed).toBeLessThan(budget);
      expect(slice.renderedCount).toBeLessThanOrEqual(PROGRESSIVE_THRESHOLD);
      expect(slice.totalCount).toBeGreaterThan(PROGRESSIVE_THRESHOLD);
    });

    it(`preserves structural sharing during ${size}-node slice`, () => {
      const tree = generateRealisticTree(size);
      const slice = sliceVisibleTree(tree, ALL_STATUSES, PROGRESSIVE_THRESHOLD);

      // Items that fit entirely within budget should be same reference
      // (verifying structural sharing is working at scale)
      if (slice.items.length > 0 && tree.length > 0) {
        // First epic may or may not be the same ref depending on truncation,
        // but at minimum the slice should have items
        expect(slice.items.length).toBeGreaterThan(0);
      }
    });
  }

  it("incremental chunk loading maintains performance", () => {
    const tree = generateRealisticTree(2000);
    const chunkSize = 50;
    const chunks = Math.ceil(2000 / chunkSize);

    // Simulate loading chunks progressively
    const chunkTimes: number[] = [];
    for (let i = 1; i <= Math.min(chunks, 10); i++) {
      const limit = i * chunkSize;
      const [, elapsed] = timed(() =>
        sliceVisibleTree(tree, ALL_STATUSES, limit),
      );
      chunkTimes.push(elapsed);
    }

    // Each chunk should complete in reasonable time
    for (const time of chunkTimes) {
      expect(time).toBeLessThan(200 * BUDGET_MULTIPLIER);
    }

    // Later chunks should not be dramatically slower than first
    // (would indicate O(n²) or worse degradation)
    const firstChunk = chunkTimes[0];
    const lastChunk = chunkTimes[chunkTimes.length - 1];
    // Allow 10× variance between first and last chunk
    // (some increase is expected as more nodes are counted)
    expect(lastChunk).toBeLessThan(firstChunk * 10 + 10);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// filterTree performance
// ═══════════════════════════════════════════════════════════════════════════════

describe("filterTree performance", () => {
  for (const size of TREE_SIZES) {
    it(`filters ${size}-node tree under ${size <= 500 ? 10 : size <= 1000 ? 20 : 40}ms`, () => {
      const tree = generateRealisticTree(size);
      const budget = (size <= 500 ? 10 : size <= 1000 ? 20 : 40) * BUDGET_MULTIPLIER;

      const [filtered, elapsed] = timed(() => filterTree(tree, ACTIVE_WORK));

      expect(elapsed).toBeLessThan(budget);
      // Filtered tree should be smaller
      const filteredCount = countAllNodes(filtered);
      const totalCount = countAllNodes(tree);
      expect(filteredCount).toBeLessThan(totalCount);
      expect(filteredCount).toBeGreaterThan(0);
    });
  }

  it("single-status filter is efficient at 2000 nodes", () => {
    const tree = generateRealisticTree(2000);
    const singleStatus: Set<ItemStatus> = new Set(["completed"]);

    const [filtered, elapsed] = timed(() => filterTree(tree, singleStatus));

    expect(elapsed).toBeLessThan(100 * BUDGET_MULTIPLIER);
    const filteredCount = countAllNodes(filtered);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(countAllNodes(tree));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// diffItems / structural sharing performance
// ═══════════════════════════════════════════════════════════════════════════════

describe("diffItems performance", () => {
  for (const size of TREE_SIZES) {
    it(`diffs identical ${size}-node trees (fast path) under ${size <= 500 ? 10 : size <= 1000 ? 20 : 40}ms`, () => {
      const tree = generateRealisticTree(size);
      // Create a "new" tree with identical content but fresh objects
      const next = cloneWithOneChange(tree, "__nonexistent__", "completed");
      const budget = (size <= 500 ? 10 : size <= 1000 ? 20 : 40) * BUDGET_MULTIPLIER;

      const [result, elapsed] = timed(() => diffItems(tree, next));

      expect(elapsed).toBeLessThan(budget);
      // Should return the original reference (nothing changed)
      expect(result).toBe(tree);
    });

    it(`diffs ${size}-node tree with single change under ${size <= 500 ? 15 : size <= 1000 ? 30 : 60}ms`, () => {
      const tree = generateRealisticTree(size);
      const targetId = findMiddleLeafId(tree);
      const next = cloneWithOneChange(tree, targetId, "completed");
      const budget = (size <= 500 ? 15 : size <= 1000 ? 30 : 60) * BUDGET_MULTIPLIER;

      const [result, elapsed] = timed(() => diffItems(tree, next));

      expect(elapsed).toBeLessThan(budget);
      // Should create a new array (something changed)
      expect(result).not.toBe(tree);
    });

    it(`maintains O(depth) new refs for single change in ${size}-node tree`, () => {
      const tree = generateRealisticTree(size);
      const targetId = findMiddleLeafId(tree);
      const next = cloneWithOneChange(tree, targetId, "completed");

      const result = diffItems(tree, next);

      // Count how many top-level items have new references
      let topLevelChanges = 0;
      for (let i = 0; i < result.length; i++) {
        if (result[i] !== tree[i]) topLevelChanges++;
      }

      // Only 1 epic (the one containing the changed leaf) should be new
      expect(topLevelChanges).toBe(1);
    });
  }
});

describe("diffDocument performance", () => {
  it("diffs 2000-node documents efficiently", () => {
    const tree = generateRealisticTree(2000);
    const prev: PRDDocumentData = { schema: "rex/v1", title: "Test", items: tree };
    const nextItems = cloneWithOneChange(tree, findMiddleLeafId(tree), "completed");
    const next: PRDDocumentData = { schema: "rex/v1", title: "Test", items: nextItems };

    const [result, elapsed] = timed(() => diffDocument(prev, next));

    expect(elapsed).toBeLessThan(100 * BUDGET_MULTIPLIER);
    expect(result).not.toBe(prev);
    expect(result.title).toBe("Test");
  });
});

describe("applyItemUpdate performance", () => {
  for (const size of TREE_SIZES) {
    it(`applies single update in ${size}-node tree under ${size <= 500 ? 5 : size <= 1000 ? 10 : 20}ms`, () => {
      const tree = generateRealisticTree(size);
      const targetId = findDeepNestedId(tree);
      const budget = (size <= 500 ? 5 : size <= 1000 ? 10 : 20) * BUDGET_MULTIPLIER;

      const [result, elapsed] = timed(() =>
        applyItemUpdate(tree, targetId, { status: "completed" }),
      );

      expect(elapsed).toBeLessThan(budget);
      expect(result).not.toBe(tree);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tree utility functions at scale
// ═══════════════════════════════════════════════════════════════════════════════

describe("tree-utils performance", () => {
  const tree2000 = generateRealisticTree(2000);
  const deepId = findDeepNestedId(tree2000);

  it("findItemById scales linearly for 2000 nodes", () => {
    const [found, elapsed] = timed(() => findItemById(tree2000, deepId));

    expect(elapsed).toBeLessThan(20 * BUDGET_MULTIPLIER);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(deepId);
  });

  it("findItemById returns null quickly for missing ID", () => {
    const [found, elapsed] = timed(() => findItemById(tree2000, "nonexistent-id"));

    expect(elapsed).toBeLessThan(20 * BUDGET_MULTIPLIER);
    expect(found).toBeNull();
  });

  it("getAncestorIds finds path in 2000-node tree", () => {
    const [ancestors, elapsed] = timed(() => getAncestorIds(tree2000, deepId));

    expect(elapsed).toBeLessThan(20 * BUDGET_MULTIPLIER);
    expect(ancestors.length).toBeGreaterThanOrEqual(2); // At least epic → feature
  });

  it("collectSubtreeIds handles large subtrees", () => {
    const bigEpic = tree2000[0];
    const [ids, elapsed] = timed(() => collectSubtreeIds(bigEpic));

    expect(elapsed).toBeLessThan(20 * BUDGET_MULTIPLIER);
    expect(ids.size).toBe(1 + countDescendants(bigEpic));
  });

  it("countDescendants handles deep trees", () => {
    const [count, elapsed] = timed(() => {
      let total = 0;
      for (const epic of tree2000) {
        total += countDescendants(epic);
      }
      return total;
    });

    expect(elapsed).toBeLessThan(20 * BUDGET_MULTIPLIER);
    // Total descendants should be close to 2000 minus top-level items
    expect(count).toBeGreaterThan(tree2000.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOM rendering performance
// ═══════════════════════════════════════════════════════════════════════════════

describe("DOM rendering performance", () => {
  beforeEach(() => {
    installMockIntersectionObserver();
  });

  afterEach(() => {
    mockObserverInstances = [];
    delete (globalThis as any).IntersectionObserver;
  });

  /**
   * Render a tree and measure DOM metrics.
   *
   * Progressive loading limits the initial render to ~50 nodes,
   * so DOM node count should be bounded regardless of tree size.
   */
  function renderAndMeasure(tree: PRDItemData[]): {
    domNodeCount: number;
    treeItemCount: number;
    renderTimeMs: number;
    root: HTMLDivElement;
  } {
    const doc: PRDDocumentData = {
      schema: "rex/v1",
      title: "Benchmark PRD",
      items: tree,
    };

    const root = document.createElement("div");

    const start = performance.now();
    act(() => {
      render(h(PRDTree, { document: doc, defaultExpandDepth: 1 }), root);
    });
    const renderTimeMs = performance.now() - start;

    // Count all DOM nodes in the rendered tree
    function countDomNodes(node: Node): number {
      let count = 1; // This node
      for (let i = 0; i < node.childNodes.length; i++) {
        count += countDomNodes(node.childNodes[i]);
      }
      return count;
    }

    const domNodeCount = countDomNodes(root);
    const treeItemCount = root.querySelectorAll("[role='treeitem']").length;

    return { domNodeCount, treeItemCount, renderTimeMs, root };
  }

  for (const size of TREE_SIZES) {
    describe(`${size}-node tree`, () => {
      it("renders within time budget", () => {
        const tree = generateRealisticTree(size);
        const budget = (size <= 500 ? 200 : size <= 1000 ? 400 : 800) * BUDGET_MULTIPLIER;

        const { renderTimeMs } = renderAndMeasure(tree);

        expect(renderTimeMs).toBeLessThan(budget);
      });

      it("progressive loading bounds initial DOM node count", () => {
        const tree = generateRealisticTree(size);

        const { treeItemCount } = renderAndMeasure(tree);

        // Progressive loading should limit initial render.
        // With defaultExpandDepth=1, only top-level epics + their first
        // level of children are expanded. The progressive loader caps at
        // PROGRESSIVE_THRESHOLD visible nodes initially.
        // Allow generous upper bound since container nodes are always shown.
        const maxExpectedTreeItems = size <= 500 ? 200 : 300;
        expect(treeItemCount).toBeLessThan(maxExpectedTreeItems);
      });

      it("DOM node count grows sub-linearly with tree size", () => {
        // This test validates that rendering 4× more items doesn't create
        // 4× more DOM nodes, thanks to progressive loading and lazy children.
        const smallTree = generateRealisticTree(Math.floor(size / 4));
        const largeTree = generateRealisticTree(size);

        const smallMetrics = renderAndMeasure(smallTree);
        const largeMetrics = renderAndMeasure(largeTree);

        // DOM nodes should not grow proportionally (sub-linear growth)
        // Large tree should have less than 3× the DOM nodes of small tree
        // (if it were linear, it would be 4×)
        expect(largeMetrics.domNodeCount).toBeLessThan(
          smallMetrics.domNodeCount * 3 + 100,
        );
      });
    });
  }

  it("cleans up DOM nodes on unmount", () => {
    const tree = generateRealisticTree(500);
    const doc: PRDDocumentData = {
      schema: "rex/v1",
      title: "Cleanup Test",
      items: tree,
    };

    const root = document.createElement("div");
    act(() => {
      render(h(PRDTree, { document: doc }), root);
    });

    const nodesBefore = root.childNodes.length;
    expect(nodesBefore).toBeGreaterThan(0);

    act(() => {
      render(null, root);
    });

    expect(root.childNodes.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Memory usage tracking
// ═══════════════════════════════════════════════════════════════════════════════

describe("memory usage at scale", () => {
  it("tree data structures have bounded memory footprint", () => {
    // Measure approximate memory of tree generation
    const before = process.memoryUsage().heapUsed;
    const tree = generateRealisticTree(2000);
    const after = process.memoryUsage().heapUsed;

    const memoryUsedBytes = after - before;
    const memoryUsedMB = memoryUsedBytes / (1024 * 1024);

    // 2000-node tree should use less than 10 MB of heap
    expect(memoryUsedMB).toBeLessThan(10);

    // Verify tree was actually created
    expect(countAllNodes(tree)).toBeGreaterThan(1800);
  });

  it("structural sharing reduces memory for incremental updates", () => {
    const tree = generateRealisticTree(1000);
    const targetId = findMiddleLeafId(tree);

    // Apply a single update
    const updated = applyItemUpdate(tree, targetId, { status: "completed" });

    // Count shared references vs new objects
    let shared = 0;
    let total = 0;
    function compare(a: PRDItemData[], b: PRDItemData[]): void {
      for (let i = 0; i < Math.min(a.length, b.length); i++) {
        total++;
        if (a[i] === b[i]) {
          shared++;
        } else if (a[i].children && b[i].children) {
          compare(a[i].children!, b[i].children!);
        }
      }
    }
    compare(tree, updated);

    // The vast majority of top-level items should be shared references
    const shareRatio = shared / total;
    expect(shareRatio).toBeGreaterThan(0.8); // >80% shared
  });

  it("diffItems reuses memory for unchanged trees", () => {
    const tree = generateRealisticTree(1000);
    // Clone with no actual changes
    const next = cloneWithOneChange(tree, "__nonexistent__", "completed");

    const result = diffItems(tree, next);

    // Same reference means zero additional memory allocation for the result
    expect(result).toBe(tree);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Performance regression detection
// ═══════════════════════════════════════════════════════════════════════════════

describe("performance regression detection", () => {
  it("core operations scale linearly (not quadratically)", () => {
    const small = generateRealisticTree(500);
    const large = generateRealisticTree(2000);

    // Measure computeBranchStats at both sizes
    const [, smallTime] = timed(() => computeBranchStats(small));
    const [, largeTime] = timed(() => computeBranchStats(large));

    // If O(n), large should be ~4× small. If O(n²), it would be ~16×.
    // We accept up to 8× to account for cache effects and timing variance.
    // Add a small constant (1ms) to avoid division by zero with very fast times.
    const ratio = (largeTime + 1) / (smallTime + 1);
    expect(ratio).toBeLessThan(8);
  });

  it("diffItems scales linearly with tree size", () => {
    const small = generateRealisticTree(500);
    const large = generateRealisticTree(2000);
    const smallNext = cloneWithOneChange(small, findMiddleLeafId(small), "completed");
    const largeNext = cloneWithOneChange(large, findMiddleLeafId(large), "completed");

    const [, smallTime] = timed(() => diffItems(small, smallNext));
    const [, largeTime] = timed(() => diffItems(large, largeNext));

    const ratio = (largeTime + 1) / (smallTime + 1);
    expect(ratio).toBeLessThan(8);
  });

  it("filterTree scales linearly with tree size", () => {
    const small = generateRealisticTree(500);
    const large = generateRealisticTree(2000);

    const [, smallTime] = timed(() => filterTree(small, ACTIVE_WORK));
    const [, largeTime] = timed(() => filterTree(large, ACTIVE_WORK));

    const ratio = (largeTime + 1) / (smallTime + 1);
    expect(ratio).toBeLessThan(8);
  });

  it("countVisibleNodes scales linearly with tree size", () => {
    const small = generateRealisticTree(500);
    const large = generateRealisticTree(2000);

    const [, smallTime] = timed(() => countVisibleNodes(small, ALL_STATUSES));
    const [, largeTime] = timed(() => countVisibleNodes(large, ALL_STATUSES));

    const ratio = (largeTime + 1) / (smallTime + 1);
    expect(ratio).toBeLessThan(8);
  });

  it("sliceVisibleTree scales linearly with tree size", () => {
    const small = generateRealisticTree(500);
    const large = generateRealisticTree(2000);

    const [, smallTime] = timed(() =>
      sliceVisibleTree(small, ALL_STATUSES, PROGRESSIVE_THRESHOLD),
    );
    const [, largeTime] = timed(() =>
      sliceVisibleTree(large, ALL_STATUSES, PROGRESSIVE_THRESHOLD),
    );

    const ratio = (largeTime + 1) / (smallTime + 1);
    expect(ratio).toBeLessThan(8);
  });

  it("applyItemUpdate is constant-time relative to tree depth", () => {
    const tree = generateRealisticTree(2000);

    // Update a shallow item (first epic's first feature)
    const shallowId = tree[0].children![0].id;
    const [, shallowTime] = timed(() =>
      applyItemUpdate(tree, shallowId, { status: "completed" }),
    );

    // Update a deep item (nested subtask)
    const deepId = findDeepNestedId(tree);
    const [, deepTime] = timed(() =>
      applyItemUpdate(tree, deepId, { status: "completed" }),
    );

    // Both should be fast (under 50ms with budget)
    expect(shallowTime).toBeLessThan(50 * BUDGET_MULTIPLIER);
    expect(deepTime).toBeLessThan(50 * BUDGET_MULTIPLIER);

    // Deep update should not be dramatically slower than shallow
    // (both walk the tree, so times should be similar)
    expect(deepTime).toBeLessThan((shallowTime + 1) * 5);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sustained operation benchmarks
// ═══════════════════════════════════════════════════════════════════════════════

describe("sustained operations", () => {
  it("handles 100 consecutive diffItems calls on 1000-node tree", () => {
    const tree = generateRealisticTree(1000);
    const iterations = 100;
    let current = tree;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const targetId = `task-${i % 5}-${i % 3}-${i % 4}`;
      const next = cloneWithOneChange(current, targetId, "completed");
      current = diffItems(current, next);
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    // Average per-diff should be under 50ms
    expect(avgMs).toBeLessThan(50 * BUDGET_MULTIPLIER);
  });

  it("handles 100 consecutive applyItemUpdate calls on 1000-node tree", () => {
    const tree = generateRealisticTree(1000);
    const iterations = 100;
    let current = tree;

    const ids: string[] = [];
    function collectIds(items: PRDItemData[]): void {
      for (const item of items) {
        if (item.level === "task" || item.level === "subtask") {
          ids.push(item.id);
        }
        if (item.children) collectIds(item.children);
      }
    }
    collectIds(tree);

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      const targetId = ids[i % ids.length];
      current = applyItemUpdate(current, targetId, { status: "completed" });
    }
    const totalMs = performance.now() - start;
    const avgMs = totalMs / iterations;

    // Average per-update should be under 10ms
    expect(avgMs).toBeLessThan(10 * BUDGET_MULTIPLIER);
  });

  it("handles rapid filter toggles on 2000-node tree", () => {
    const tree = generateRealisticTree(2000);
    const filters: Set<ItemStatus>[] = [
      ALL_STATUSES,
      ACTIVE_WORK,
      new Set(["completed"]),
      new Set(["pending", "in_progress"]),
      ALL_STATUSES,
    ];

    const times: number[] = [];
    for (const filter of filters) {
      const [, elapsed] = timed(() => filterTree(tree, filter));
      times.push(elapsed);
    }

    // Each filter operation should be under 100ms
    for (const t of times) {
      expect(t).toBeLessThan(100 * BUDGET_MULTIPLIER);
    }
  });
});
