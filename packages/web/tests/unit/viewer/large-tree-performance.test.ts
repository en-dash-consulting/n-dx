// @vitest-environment jsdom
/**
 * Performance benchmarks for large PRD trees.
 *
 * Validates that core tree operations (rendering, diffing, filtering,
 * statistics computation, progressive slicing) stay linear in tree size at
 * scale: 500, 1000, 2000 and 4000 item trees.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE NO LONGER USES A CLOCK
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Every assertion here used to compare `performance.now()` elapsed time against
 * an absolute millisecond budget scaled by a hardcoded `BUDGET_MULTIPLIER = 10`
 * — 24 such assertions. The file's own header described the budgets as
 * "intentionally generous (2–5x expected) to avoid flaky CI while still catching
 * genuine regressions", which is a complexity claim written as a wall-clock
 * number. Under full-suite load three of these tests failed on unchanged code
 * and passed on a serial rerun. A generous absolute budget does not stop being
 * machine-dependent; it just fails less often.
 *
 * TESTING.md, Family 2, ranks the alternatives and puts "count work, not time"
 * first. Every claim in this file turned out to be countable, so there is now no
 * clock in it at all.
 *
 * Growth-ratio timing (technique 2) was tried here first and rejected on
 * measurement, not on taste: a min-of-7-batches timing of `diffItems` across an
 * 8x size step read 7.7x on an idle machine and 46.5x on a loaded one, because
 * the small-size batch is short enough to fit inside a clean scheduler slice and
 * the large-size batch is not. A ratio only cancels load when both readings face
 * the same preemption risk, and these operations are far too cheap for that.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * WHAT IS COUNTED
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * Two counters, both from `tests/helpers/tree-work-count.ts`:
 *
 *  - `countTreeReads` — reads of the fixture's `children` arrays. For these
 *    functions the tree is the input and walking it is the algorithm, so this is
 *    the traversal step count.
 *  - `countRenderWork` — vnodes Preact diffed and DOM records observed, via
 *    Preact's `options.diffed` addon hook and a MutationObserver.
 *
 * MEASURED, `children` reads per node (identical on repeat runs, and identical
 * again with every core saturated — these are counts, not timings):
 *
 *   operation              n=502    n=1000   n=2003   n=4002   growth over 7.97x
 *   computeBranchStats     1.177    1.170    1.170    1.169        7.92x
 *   countVisibleNodes      1.177    1.170    1.170    1.169        7.92x
 *   sliceVisibleTree       1.297    1.230    1.200    1.184        7.28x
 *   filterTree             1.082    1.073    1.074    1.074        7.92x
 *   diffItems              0.392    0.390    0.390    0.390        7.92x
 *   diffDocument           0.392    0.390    0.390    0.390        7.92x
 *   applyItemUpdate        1.576    1.562    1.561    1.560        7.89x
 *   findItemById (miss)    0.785    0.780    0.780    0.780        7.92x
 *   getAncestorIds         0.402    0.396    0.392    0.390        7.73x
 *   countDescendants       1.177    1.170    1.170    1.169        7.92x
 *   collectSubtreeIds          8        8        8        8 (absolute — one epic)
 *   ── injected O(n²) ──   197.8    390.8    781.8   1560.8       62.91x
 *
 * MEASURED, render work by tree size (`defaultExpandDepth: 1`):
 *
 *   size    rows    DOM nodes   vnode diffs   DOM/row   diffs/row
 *      0       0            9            10         —           —
 *    500      65        1 410         2 257     21.69       34.72
 *   1000     127        2 710         4 353     21.34       34.28
 *   2000     254        5 378         8 537     21.17       33.61
 *   4000     507       10 690        16 921     21.08       33.37
 *
 * The last two columns are the point: per-row cost is flat, so render work is
 * linear in the number of *visible* rows rather than in total tree size.
 *
 * The empty-tree row also retires a wrong constant. The DOM-per-item test used
 * to subtract a hardcoded `overheadEstimate = 200` for "header, toolbar,
 * filters, summary bar, spacers". The real chrome is 9 nodes. Subtracting 200
 * from 1 410 across 65 rows reported 18.6 nodes per row when the true figure is
 * 21.7 — the assertion passed, but not for the reason it stated. It now measures
 * the chrome in the same process instead of guessing at it.
 *
 * @see ./progressive-loader.test.ts — unit tests for progressive loading
 * @see ./tree-differ.test.ts — unit tests for structural sharing
 * @see ./prd-tree-compute.test.ts — unit tests for stats computation
 * @see ../../helpers/tree-work-count.ts — the counters, and their blind spots
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
import { countTreeReads, countRenderWork, instrumentTreeReads } from "../../helpers/tree-work-count.js";
import type {
  PRDItemData,
  PRDDocumentData,
  ItemStatus,
  Priority,
} from "../../../src/viewer/components/prd-tree/types.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Tree sizes under test. */
const TREE_SIZES = [500, 1000, 2000] as const;

/**
 * The pair of sizes the growth assertions use: ~502 and ~4002 nodes, a 7.97x
 * step.
 *
 * Widest span the fixtures offer, and the span matters. Linear scaling lands at
 * 7.97x and quadratic at 63.5x, so there is a factor of 8 to place a bound in.
 * The adjacent 500→2000 pair only offers 4x vs 16x, which is not enough room to
 * put meaningful headroom on.
 */
const GROWTH_SIZES = [500, 4000] as const;

/**
 * How far above linear a traversal may grow between the two growth sizes.
 *
 * Derived in both directions per TESTING.md rule 3, on counts rather than
 * timings, so the "clean" column has no spread at all:
 *
 *   worst clean growth      7.92x  (every linear operation; linear is 7.97x)
 *   injected O(n²) growth  62.91x  (re-walk the whole tree once per node)
 *
 * A bound of 2x linear (15.94x) sits 2.01x above the worst clean reading and
 * 3.95x below the injected regression. The injection was run, not assumed.
 */
const SCALING_HEADROOM = 2;

/**
 * Ceiling on `children` reads per node for a single-pass operation.
 *
 * The heaviest linear operation measured is `applyItemUpdate` at 1.576 reads per
 * node, so 4 leaves a 2.5x constant-factor margin. What it catches: any
 * operation that starts re-traversing the tree per node, which reads 197.8 times
 * per node at the smallest gated size — a 49x overshoot, not a marginal one.
 *
 * What it deliberately does not catch is a constant-factor increase inside that
 * 2.5x margin (one extra full pass over the tree, say). That is the growth
 * assertions' job: they bound each operation to 2x linear across an 8x span,
 * which is far tighter per operation than this shared ceiling can be.
 */
const MAX_READS_PER_NODE = 4;

/** All statuses — matches everything. */
const ALL_STATUSES: Set<ItemStatus> = new Set([
  "pending", "in_progress", "completed", "failing", "deferred", "blocked", "deleted",
]);

/** Active work filter (most common dashboard filter). */
const ACTIVE_WORK: Set<ItemStatus> = new Set(["pending", "in_progress", "blocked"]);

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

/**
 * A tree whose `children` reads are counted.
 *
 * Always build measured fixtures through this, never through
 * `generateRealisticTree` directly, or `countTreeReads` silently returns 0 and
 * the assertion becomes vacuous. The `expect(reads).toBeGreaterThan(0)` guard in
 * `readsPerNode` exists to catch exactly that mistake.
 */
function generateMeasuredTree(targetCount: number): PRDItemData[] {
  return instrumentTreeReads(generateRealisticTree(targetCount));
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

// ── Work-count helpers ────────────────────────────────────────────────────────

/**
 * Traversal steps per node for one operation on one fixture size.
 *
 * Returns reads/nodeCount so the figure is comparable across sizes: a linear
 * operation holds it constant, and one that re-traverses grows it with n.
 */
function readsPerNode(items: PRDItemData[], op: () => void): number {
  const reads = countTreeReads(op);
  // A fixture built without `instrumentTreeReads` reads zero, which would make
  // every bound below trivially true.
  expect(reads, "operation read no children arrays — is the fixture instrumented?").toBeGreaterThan(0);
  return reads / countAllNodes(items);
}

/**
 * Assert an operation's traversal grows no faster than ~linearly between the
 * two `GROWTH_SIZES`.
 *
 * `build` receives a fresh instrumented tree of the requested size and returns
 * the closure to measure, so each size gets its own fixture — a shared fixture
 * would let the first size's traversal warm structures the second reuses, which
 * is the confound that made the `add-auto-reshape` gate unusable before it was
 * given one store per size.
 */
function expectLinearTraversalGrowth(
  label: string,
  build: (tree: PRDItemData[]) => () => void,
): void {
  const [smallSize, largeSize] = GROWTH_SIZES;
  const small = generateMeasuredTree(smallSize);
  const large = generateMeasuredTree(largeSize);

  const smallNodes = countAllNodes(small);
  const largeNodes = countAllNodes(large);
  const sizeRatio = largeNodes / smallNodes;
  const bound = sizeRatio * SCALING_HEADROOM;

  const smallReads = countTreeReads(build(small));
  const largeReads = countTreeReads(build(large));
  expect(smallReads, `${label} read no children arrays — is the fixture instrumented?`).toBeGreaterThan(0);

  const growth = largeReads / smallReads;
  expect(
    growth,
    `${label} traversal grew ${growth.toFixed(2)}x for a ${sizeRatio.toFixed(2)}x size increase ` +
    `(${smallNodes} nodes: ${smallReads} reads, ${largeNodes} nodes: ${largeReads} reads). ` +
    `Linear is ~${sizeRatio.toFixed(0)}x and quadratic ~${(sizeRatio ** 2).toFixed(0)}x, so this ` +
    `indicates the operation started re-traversing the tree rather than walking it once. ` +
    `Counts are exact and machine-independent: a change here is a change in the code.`,
  ).toBeLessThan(bound);
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

// (A `performance.memory` mock lived here and was never called by any test —
// the memory section uses `process.memoryUsage()`. Removed rather than left to
// suggest coverage that does not exist.)

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

  it("instrumented fixtures do not change what the code under test sees", () => {
    // The instrument replaces `children` with a getter. If it did that on leaves
    // too, `"children" in item` would become newly true for every leaf and the
    // fixture would stop resembling real PRD data. Guard the shape it relies on.
    const plain = generateRealisticTree(500);
    const measured = generateMeasuredTree(500);

    expect(countAllNodes(measured)).toBe(countAllNodes(plain));
    expect(computeBranchStats(measured)).toEqual(computeBranchStats(plain));
    expect(countVisibleNodes(measured, ALL_STATUSES)).toBe(countVisibleNodes(plain, ALL_STATUSES));

    const leaves: PRDItemData[] = [];
    (function collect(items: PRDItemData[]) {
      for (const item of items) {
        if (item.children) collect(item.children);
        else leaves.push(item);
      }
    })(measured);
    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves.slice(0, 20)) {
      expect(Object.getOwnPropertyDescriptor(leaf, "children")?.get).toBeUndefined();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// computeBranchStats
// ═══════════════════════════════════════════════════════════════════════════════

describe("computeBranchStats work", () => {
  for (const size of TREE_SIZES) {
    it(`computes stats for a ${size}-node tree in a single traversal`, () => {
      const tree = generateMeasuredTree(size);

      let stats!: ReturnType<typeof computeBranchStats>;
      const perNode = readsPerNode(tree, () => { stats = computeBranchStats(tree); });

      // Catches: a stats pass that re-walks the tree per node (197.8 reads per
      // node when injected). Measures 1.17 clean at every size.
      expect(perNode, `computeBranchStats read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);

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
// countVisibleNodes & sliceVisibleTree
// ═══════════════════════════════════════════════════════════════════════════════

describe("countVisibleNodes work", () => {
  for (const size of TREE_SIZES) {
    it(`counts a ${size}-node tree in a single traversal`, () => {
      const tree = generateMeasuredTree(size);

      let count = 0;
      const perNode = readsPerNode(tree, () => { count = countVisibleNodes(tree, ALL_STATUSES); });

      // Catches: a per-node visibility check that re-descends the subtree it is
      // already inside. Measures 1.17 clean at every size.
      expect(perNode, `countVisibleNodes read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);
      expect(count).toBeGreaterThan(0);
    });

    it(`counts ${size}-node tree with active-work filter`, () => {
      const tree = generateRealisticTree(size);

      const allCount = countVisibleNodes(tree, ALL_STATUSES);
      const filteredCount = countVisibleNodes(tree, ACTIVE_WORK);

      // Filtered count should be less than or equal to all
      expect(filteredCount).toBeLessThanOrEqual(allCount);
      // But should still have some results (varied statuses)
      expect(filteredCount).toBeGreaterThan(0);
    });
  }
});

describe("sliceVisibleTree work", () => {
  for (const size of TREE_SIZES) {
    it(`slices a ${size}-node tree into the first chunk in a single traversal`, () => {
      const tree = generateMeasuredTree(size);

      let slice!: ReturnType<typeof sliceVisibleTree>;
      const perNode = readsPerNode(tree, () => {
        slice = sliceVisibleTree(tree, ALL_STATUSES, PROGRESSIVE_THRESHOLD);
      });

      // Catches: a slice that counts the remaining tree afresh at every node it
      // emits. Measures 1.18–1.30 clean, falling slightly as size grows because
      // the traversal stops early once the chunk is full.
      expect(perNode, `sliceVisibleTree read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);

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
    const tree = generateMeasuredTree(2000);
    const chunkSize = 50;
    const chunks = Math.ceil(2000 / chunkSize);

    // Simulate loading chunks progressively, counting the traversal each one costs.
    const chunkReads: number[] = [];
    for (let i = 1; i <= Math.min(chunks, 10); i++) {
      const limit = i * chunkSize;
      chunkReads.push(countTreeReads(() => {
        sliceVisibleTree(tree, ALL_STATUSES, limit);
      }));
    }

    const nodeCount = countAllNodes(tree);
    const lastChunk = chunkReads[chunkReads.length - 1];

    // Catches: a chunk loader whose per-chunk cost is proportional to the chunks
    // already loaded (the O(n²) shape you get by re-slicing from the root and
    // re-counting what was emitted). Slicing to a larger limit legitimately walks
    // further, so the bound is one traversal of the tree, not the previous
    // chunk's reading — a comparison between two chunk costs was the old
    // formulation and it needed a `Math.max(firstChunk, 10)` clamp plus a "+10"
    // fudge precisely because the first chunk's cost is near zero.
    expect(
      lastChunk,
      `slicing to ${chunks > 10 ? 10 * chunkSize : chunks * chunkSize} items read ${lastChunk} ` +
      `children arrays on a ${nodeCount}-node tree; chunk costs were ${chunkReads.join(", ")}`,
    ).toBeLessThan(nodeCount * MAX_READS_PER_NODE);

    // Each chunk is bounded the same way, so no single chunk can hide a blow-up.
    for (const reads of chunkReads) {
      expect(reads).toBeLessThan(nodeCount * MAX_READS_PER_NODE);
    }

    // Costs must be non-decreasing in the limit and never exceed the full walk:
    // a chunk that costs *less* as the limit grows would mean the slice stopped
    // honouring the limit.
    expect(chunkReads[chunkReads.length - 1]).toBeGreaterThanOrEqual(chunkReads[0]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// filterTree
// ═══════════════════════════════════════════════════════════════════════════════

describe("filterTree work", () => {
  for (const size of TREE_SIZES) {
    it(`filters a ${size}-node tree in a single traversal`, () => {
      const tree = generateMeasuredTree(size);

      let filtered!: PRDItemData[];
      const perNode = readsPerNode(tree, () => { filtered = filterTree(tree, ACTIVE_WORK); });

      // Catches: a filter that decides each node's fate by re-scanning its
      // subtree from the root. Measures 1.07–1.08 clean at every size.
      expect(perNode, `filterTree read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);

      // Filtered tree should be smaller
      const filteredCount = countAllNodes(filtered);
      const totalCount = countAllNodes(tree);
      expect(filteredCount).toBeLessThan(totalCount);
      expect(filteredCount).toBeGreaterThan(0);
    });
  }

  it("single-status filter is efficient at 2000 nodes", () => {
    const tree = generateMeasuredTree(2000);
    const singleStatus: Set<ItemStatus> = new Set(["completed"]);

    let filtered!: PRDItemData[];
    const perNode = readsPerNode(tree, () => { filtered = filterTree(tree, singleStatus); });

    // Catches: a narrow filter costing more per node than a wide one, which
    // would mean the rejection path re-walks rather than short-circuits.
    expect(perNode).toBeLessThan(MAX_READS_PER_NODE);

    const filteredCount = countAllNodes(filtered);
    expect(filteredCount).toBeGreaterThan(0);
    expect(filteredCount).toBeLessThan(countAllNodes(tree));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// diffItems / structural sharing
// ═══════════════════════════════════════════════════════════════════════════════

describe("diffItems work", () => {
  for (const size of TREE_SIZES) {
    it(`diffs identical ${size}-node trees (fast path) in a single traversal`, () => {
      const tree = generateMeasuredTree(size);
      // Create a "new" tree with identical content but fresh objects
      const next = cloneWithOneChange(tree, "__nonexistent__", "completed");

      let result!: PRDItemData[];
      const perNode = readsPerNode(tree, () => { result = diffItems(tree, next); });

      // Catches: an equality check that compares each node against the whole
      // other tree instead of its positional counterpart. Measures 0.39 clean.
      expect(perNode, `diffItems (identical) read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);

      // Should return the original reference (nothing changed)
      expect(result).toBe(tree);
    });

    it(`diffs a ${size}-node tree with a single change in a single traversal`, () => {
      const tree = generateMeasuredTree(size);
      const targetId = findMiddleLeafId(tree);
      const next = cloneWithOneChange(tree, targetId, "completed");

      let result!: PRDItemData[];
      const perNode = readsPerNode(tree, () => { result = diffItems(tree, next); });

      // Catches: the same regression on the changed path — a single edit must not
      // cost more traversal than a no-op diff. Measures 0.39 clean, identical to
      // the fast path above, which is the property worth holding.
      expect(perNode, `diffItems (one change) read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);

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

describe("diffDocument work", () => {
  it("diffs 2000-node documents in a single traversal", () => {
    const tree = generateMeasuredTree(2000);
    const prev: PRDDocumentData = { schema: "rex/v1", title: "Test", items: tree };
    const nextItems = cloneWithOneChange(tree, findMiddleLeafId(tree), "completed");
    const next: PRDDocumentData = { schema: "rex/v1", title: "Test", items: nextItems };

    let result!: PRDDocumentData;
    const perNode = readsPerNode(tree, () => { result = diffDocument(prev, next); });

    // Catches: a document-level diff that walks the item tree more than once —
    // for instance recomputing document stats after diffing. Measures 0.39 clean.
    expect(perNode).toBeLessThan(MAX_READS_PER_NODE);

    expect(result).not.toBe(prev);
    expect(result.title).toBe("Test");
  });
});

describe("applyItemUpdate work", () => {
  for (const size of TREE_SIZES) {
    it(`applies a single update in a ${size}-node tree in a bounded traversal`, () => {
      const tree = generateMeasuredTree(size);
      const targetId = findDeepNestedId(tree);

      let result!: PRDItemData[];
      const perNode = readsPerNode(tree, () => {
        result = applyItemUpdate(tree, targetId, { status: "completed" });
      });

      // Catches: an update that searches for the target once and then rebuilds by
      // searching again per level. Measures 1.56 clean at every size — the
      // heaviest linear operation in this file, which is why MAX_READS_PER_NODE
      // is 4 rather than 2.
      expect(perNode, `applyItemUpdate read ${perNode.toFixed(3)} children arrays per node`)
        .toBeLessThan(MAX_READS_PER_NODE);

      expect(result).not.toBe(tree);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tree utility functions at scale
// ═══════════════════════════════════════════════════════════════════════════════

describe("tree-utils work", () => {
  it("findItemById walks a 2000-node tree once for a deep hit", () => {
    const tree = generateMeasuredTree(2000);
    const deepId = findDeepNestedId(tree);

    let found: PRDItemData | null = null;
    const perNode = readsPerNode(tree, () => { found = findItemById(tree, deepId); });

    // Catches: a search that restarts from the root at each level. A hit stops
    // early, so this reads less than a full walk.
    expect(perNode).toBeLessThan(MAX_READS_PER_NODE);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(deepId);
  });

  it("findItemById walks a 2000-node tree once for a missing ID", () => {
    const tree = generateMeasuredTree(2000);

    let found: PRDItemData | null = null;
    const perNode = readsPerNode(tree, () => { found = findItemById(tree, "nonexistent-id"); });

    // The exhaustive case — no early exit — so this is the tightest read on
    // `findItemById`. Measures 0.78 clean at every size.
    expect(perNode, `findItemById (miss) read ${perNode.toFixed(3)} children arrays per node`)
      .toBeLessThan(MAX_READS_PER_NODE);
    expect(found).toBeNull();
  });

  it("getAncestorIds finds path in 2000-node tree", () => {
    const tree = generateMeasuredTree(2000);
    const deepId = findDeepNestedId(tree);

    let ancestors: string[] = [];
    const perNode = readsPerNode(tree, () => { ancestors = getAncestorIds(tree, deepId); });

    // Catches: a path lookup that re-walks from the root once per ancestor
    // returned. Measures 0.39–0.40 clean.
    expect(perNode).toBeLessThan(MAX_READS_PER_NODE);
    expect(ancestors.length).toBeGreaterThanOrEqual(2); // At least epic → feature
  });

  it("collectSubtreeIds cost follows the subtree, not the whole tree", () => {
    const small = generateMeasuredTree(500);
    const large = generateMeasuredTree(4000);

    const smallReads = countTreeReads(() => { collectSubtreeIds(small[0]); });
    const largeReads = countTreeReads(() => { collectSubtreeIds(large[0]); });
    const ids = collectSubtreeIds(large[0]);

    // The first epic is the same shape in both fixtures, so this reads 8 either
    // way. Catches: a subtree walk that touches nodes outside the subtree — the
    // reading would then grow with total tree size. This is the one operation
    // here whose cost must NOT scale with n, so it gets an equality check rather
    // than a growth bound.
    expect(largeReads, `collectSubtreeIds read ${largeReads} on a 4000-node tree vs ${smallReads} on a 500-node one`)
      .toBe(smallReads);
    expect(ids.size).toBe(1 + countDescendants(large[0]));
  });

  it("countDescendants handles deep trees", () => {
    const tree = generateMeasuredTree(2000);

    let count = 0;
    const perNode = readsPerNode(tree, () => {
      count = 0;
      for (const epic of tree) count += countDescendants(epic);
    });

    // Catches: a descendant count that re-descends per node. Measures 1.17 clean.
    expect(perNode).toBeLessThan(MAX_READS_PER_NODE);
    // Total descendants should be close to 2000 minus top-level items
    expect(count).toBeGreaterThan(tree.length);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DOM rendering
// ═══════════════════════════════════════════════════════════════════════════════

describe("DOM rendering work", () => {
  beforeEach(() => {
    installMockIntersectionObserver();
  });

  afterEach(() => {
    mockObserverInstances = [];
    delete (globalThis as any).IntersectionObserver;
  });

  interface RenderMeasurement {
    domNodeCount: number;
    treeItemCount: number;
    vnodeDiffs: number;
    domMutations: number;
  }

  /**
   * Render a tree, measure DOM and render-work metrics, then unmount.
   *
   * Unmounting is not tidiness. `useLiveTick` starts a real 1s `setInterval` as
   * soon as an in-progress row is visible, and these fixtures always contain
   * in-progress items. Before this, every render in this file left a live
   * interval re-rendering a 500–2000 row tree for the remainder of the run, so a
   * later test could be interrupted mid-measurement by an earlier test's tree.
   * That is the most likely reason the two *non-timing* assertions here — the
   * DOM-per-item bound and the unmount check — were also seen failing under load
   * and passing on a serial rerun.
   *
   * In jsdom (containerHeight=0), virtual scrolling renders all visible items.
   * Visible items are bounded by defaultExpandDepth (1), not by the total tree
   * size.
   */
  function renderAndMeasure(tree: PRDItemData[]): RenderMeasurement {
    const doc: PRDDocumentData = {
      schema: "rex/v1",
      title: "Benchmark PRD",
      items: tree,
    };

    const root = document.createElement("div");

    const work = countRenderWork(root, () => {
      act(() => {
        render(h(PRDTree, { document: doc, defaultExpandDepth: 1 }), root);
      });
    });

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

    act(() => {
      render(null, root);
    });

    return { domNodeCount, treeItemCount, vnodeDiffs: work.vnodeDiffs, domMutations: work.domMutations };
  }

  /**
   * DOM nodes the tree's own chrome contributes, measured in this process.
   *
   * Rendering an empty document exercises header, toolbar, filters and summary
   * bar with no rows, so whatever it produces is exactly the fixed overhead. It
   * measures 9. The previous version of this file guessed 200.
   */
  function measureChromeNodes(): number {
    return renderAndMeasure([]).domNodeCount;
  }

  for (const size of TREE_SIZES) {
    describe(`${size}-node tree`, () => {
      it("render work is proportional to visible rows, not tree size", () => {
        const tree = generateRealisticTree(size);

        const { vnodeDiffs, treeItemCount } = renderAndMeasure(tree);

        expect(treeItemCount).toBeGreaterThan(0);
        const diffsPerRow = vnodeDiffs / treeItemCount;

        // Catches: a render whose per-row cost grows with the size of the tree —
        // the thing the old `renderTimeMs < 300..900 * 10` budget was standing in
        // for, minus the machine. Measures 33.4–34.7 diffs per row flat from 500
        // to 4000 nodes; a render that stopped culling collapsed subtrees would
        // multiply this by the average subtree size.
        expect(
          diffsPerRow,
          `rendering ${countAllNodes(tree)} nodes diffed ${vnodeDiffs} vnodes across ` +
          `${treeItemCount} visible rows (${diffsPerRow.toFixed(2)} per row); ` +
          `a clean tree measures 33.4–34.7 per row at every size`,
        ).toBeLessThan(60);
      });

      it("virtual scroll limits visible items by expand depth", () => {
        const tree = generateRealisticTree(size);

        const { treeItemCount } = renderAndMeasure(tree);

        // With defaultExpandDepth=1, only epics + their direct features are
        // visible in the flattened tree. Tasks and subtasks are hidden behind
        // collapsed feature nodes.
        // In jsdom (containerHeight=0), virtual scrolling renders all visible
        // nodes. Visible count is bounded by expansion depth, not tree size.
        // Allow generous upper bound since the tree generates ~5 epics × ~3
        // features per 500 nodes, scaling proportionally.
        // Visible items ≈ epics + features (roughly size / 7), well under total.
        const maxExpectedTreeItems = Math.ceil(size / 4);
        expect(treeItemCount).toBeLessThan(maxExpectedTreeItems);
      });

      it("DOM per visible item is bounded (no CulledNode/LazyChildren wrappers)", () => {
        // Virtual scrolling renders flat NodeRow elements without the
        // recursive CulledNode and LazyChildren wrapper divs, keeping
        // the DOM nodes per item bounded to a small constant.
        const chromeNodes = measureChromeNodes();
        const tree = generateRealisticTree(size);
        const { domNodeCount, treeItemCount } = renderAndMeasure(tree);

        expect(treeItemCount).toBeGreaterThan(0);
        // Measured chrome, not an estimate — see measureChromeNodes.
        const perItemNodes = (domNodeCount - chromeNodes) / treeItemCount;
        // Each NodeRow produces ~15-25 DOM nodes (spans, divs, text nodes).
        // Without CulledNode/LazyChildren wrappers, this should be < 30.
        // Measures 21.1–21.7 at every size.
        expect(
          perItemNodes,
          `${domNodeCount} DOM nodes minus ${chromeNodes} of chrome across ` +
          `${treeItemCount} rows = ${perItemNodes.toFixed(2)} per row`,
        ).toBeLessThan(30);
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
// Memory usage
// ═══════════════════════════════════════════════════════════════════════════════

describe("memory usage at scale", () => {
  it("tree data structures have a memory footprint linear in node count", () => {
    // `heapUsed` deltas depend on when GC happens to run, so an absolute "under
    // 10 MB" bound is machine-state dependent in the same way an elapsed-time
    // budget is. Comparing per-node cost at two sizes measured back-to-back keeps
    // the GC conditions shared between the two readings, so the claim being
    // asserted — memory is linear in node count, not quadratic — survives.
    function bytesPerNode(size: number): { bytes: number; nodes: number } {
      const before = process.memoryUsage().heapUsed;
      const tree = generateRealisticTree(size);
      const after = process.memoryUsage().heapUsed;
      const nodes = countAllNodes(tree);
      // Keep `tree` reachable across the measurement so it cannot be collected
      // before `after` is read.
      expect(nodes).toBeGreaterThan(size * 0.9);
      return { bytes: after - before, nodes };
    }

    const small = bytesPerNode(500);
    const large = bytesPerNode(2000);

    // A GC landing inside either window can make a delta small or even negative;
    // that is a measurement artifact, not a regression, so only a growing
    // per-node cost is treated as a failure.
    if (small.bytes > 0 && large.bytes > 0) {
      const smallPerNode = small.bytes / small.nodes;
      const largePerNode = large.bytes / large.nodes;
      expect(
        largePerNode / smallPerNode,
        `per-node heap grew from ${smallPerNode.toFixed(0)} to ${largePerNode.toFixed(0)} bytes ` +
        `between ${small.nodes} and ${large.nodes} nodes; a quadratic structure ` +
        `(a per-node copy of the tree, say) would grow this with n`,
      ).toBeLessThan(4);
    }

    // Independent of GC: the node count itself.
    expect(large.nodes).toBeGreaterThan(1800);
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
// Complexity regression detection
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * The per-operation sensitivity layer.
 *
 * The per-size tests above bound each operation against a shared ceiling of
 * MAX_READS_PER_NODE, which is deliberately loose enough to survive a
 * constant-factor change. These bound each operation's growth across a 7.97x
 * size step to 2x linear, which is tight per operation and is what actually
 * separates linear from quadratic. Both layers are counts, so neither can flake.
 */
describe("complexity regression detection", () => {
  it("computeBranchStats traversal scales linearly (not quadratically)", () => {
    expectLinearTraversalGrowth("computeBranchStats", (tree) => () => { computeBranchStats(tree); });
  });

  it("diffItems traversal scales linearly with tree size", () => {
    expectLinearTraversalGrowth("diffItems", (tree) => {
      const next = cloneWithOneChange(tree, findMiddleLeafId(tree), "completed");
      return () => { diffItems(tree, next); };
    });
  });

  it("filterTree traversal scales linearly with tree size", () => {
    expectLinearTraversalGrowth("filterTree", (tree) => () => { filterTree(tree, ACTIVE_WORK); });
  });

  it("countVisibleNodes traversal scales linearly with tree size", () => {
    expectLinearTraversalGrowth("countVisibleNodes", (tree) => () => { countVisibleNodes(tree, ALL_STATUSES); });
  });

  it("sliceVisibleTree traversal scales linearly with tree size", () => {
    expectLinearTraversalGrowth("sliceVisibleTree", (tree) => () => {
      sliceVisibleTree(tree, ALL_STATUSES, PROGRESSIVE_THRESHOLD);
    });
  });

  it("applyItemUpdate traversal scales linearly with tree size", () => {
    expectLinearTraversalGrowth("applyItemUpdate", (tree) => {
      const id = findDeepNestedId(tree);
      return () => { applyItemUpdate(tree, id, { status: "completed" }); };
    });
  });

  it("findItemById traversal scales linearly with tree size", () => {
    expectLinearTraversalGrowth("findItemById", (tree) => () => { findItemById(tree, "nonexistent-id"); });
  });

  it("applyItemUpdate costs the same traversal at any depth", () => {
    const tree = generateMeasuredTree(2000);

    // Update a shallow item (first epic's first feature)
    const shallowId = tree[0].children![0].id;
    const shallowReads = countTreeReads(() => {
      applyItemUpdate(tree, shallowId, { status: "completed" });
    });

    // Update a deep item (nested subtask)
    const deepId = findDeepNestedId(tree);
    const deepReads = countTreeReads(() => {
      applyItemUpdate(tree, deepId, { status: "completed" });
    });

    expect(shallowReads).toBeGreaterThan(0);

    // Catches: an update whose cost depends on where the target sits — for
    // instance one that rebuilds ancestors by re-searching from the root per
    // level, which would make the deep case cost multiples of the shallow one.
    // Both walk the tree once, so the readings should be close. This replaces
    // `deepTime < (shallowTime + 1) * 5`, whose `+1` existed only to stop a
    // sub-millisecond shallow reading producing a near-zero ceiling.
    expect(
      deepReads / shallowReads,
      `updating a deep item read ${deepReads} children arrays vs ${shallowReads} for a shallow one`,
    ).toBeLessThan(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Sustained operations
// ═══════════════════════════════════════════════════════════════════════════════

describe("sustained operations", () => {
  it("handles 100 consecutive diffItems calls on 1000-node tree", () => {
    const tree = generateMeasuredTree(1000);
    const iterations = 100;
    let current = tree;

    // Catches: per-call cost that grows as the tree accumulates edits — a diff
    // that retains and re-scans previous versions, say. The old form averaged
    // wall-clock across the loop, which measured the machine; the per-iteration
    // traversal count does not.
    const totalReads = countTreeReads(() => {
      for (let i = 0; i < iterations; i++) {
        const targetId = `task-${i % 5}-${i % 3}-${i % 4}`;
        const next = cloneWithOneChange(current, targetId, "completed");
        current = diffItems(current, next);
      }
    });

    const nodeCount = countAllNodes(tree);
    // Only the original instrumented fixture is counted; each diff result is a
    // fresh clone with plain properties. So this bounds the fixture reads across
    // the whole loop, which is the reading that would blow up if a diff held on
    // to the original and re-walked it per call.
    expect(
      totalReads,
      `${iterations} successive diffs read the original ${nodeCount}-node fixture ` +
      `${totalReads} times in total`,
    ).toBeLessThan(nodeCount * MAX_READS_PER_NODE * iterations);
  });

  it("handles 100 consecutive applyItemUpdate calls on 1000-node tree", () => {
    const tree = generateMeasuredTree(1000);
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

    const firstReads = countTreeReads(() => {
      current = applyItemUpdate(current, ids[0], { status: "completed" });
    });
    const restReads = countTreeReads(() => {
      for (let i = 1; i < iterations; i++) {
        current = applyItemUpdate(current, ids[i % ids.length], { status: "completed" });
      }
    });

    expect(firstReads).toBeGreaterThan(0);
    // After the first update, `current` is a partially rebuilt tree whose changed
    // spine no longer carries the instrument, so the fixture reads fall away.
    // Catches: an update that keeps reaching back into the original tree on every
    // call — the reading would then stay at firstReads × 99 instead of dropping.
    expect(
      restReads,
      `updates 2..${iterations} read the original fixture ${restReads} times; ` +
      `the first update alone read it ${firstReads} times`,
    ).toBeLessThan(firstReads * (iterations - 1));
  });

  it("handles rapid filter toggles on 2000-node tree", () => {
    const tree = generateMeasuredTree(2000);
    const filters: Set<ItemStatus>[] = [
      ALL_STATUSES,
      ACTIVE_WORK,
      new Set(["completed"]),
      new Set(["pending", "in_progress"]),
      ALL_STATUSES,
    ];

    const reads = filters.map((filter) => countTreeReads(() => { filterTree(tree, filter); }));
    const nodeCount = countAllNodes(tree);

    // Catches: a filter that caches per-status results and rebuilds the cache by
    // re-walking on every toggle, or one whose cost depends on the previous
    // filter. Each toggle costs one traversal regardless of order or selectivity.
    for (const r of reads) {
      expect(r, `filter toggles read ${reads.join(", ")} on a ${nodeCount}-node tree`)
        .toBeLessThan(nodeCount * MAX_READS_PER_NODE);
    }

    // Toggling back to ALL_STATUSES must cost what it did the first time — an
    // exact check, since the same filter on the same tree is the same traversal.
    expect(reads[reads.length - 1]).toBe(reads[0]);
  });
});
