/**
 * Tests for per-PRD-item token rollup.
 *
 * Verifies the pure aggregator that walks a PRD tree, sums run tokens
 * per item, and rolls them up to parents and ancestors.
 */

import { describe, it, expect } from "vitest";
import {
  aggregateItemTokenUsage,
  type ItemRunTokens,
  type ItemTokenTotals,
} from "../../../src/core/item-token-rollup.js";
import type { PRDItem } from "../../../src/schema/v1.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function item(id: string, children: PRDItem[] = []): PRDItem {
  return {
    id,
    title: id,
    status: "pending",
    level: children.length ? "feature" : "task",
    children: children.length ? children : undefined,
  };
}

function run(itemId: string, input: number, output: number, cached = 0): ItemRunTokens {
  return {
    itemId,
    tokens: { input, output, cached, total: input + output + cached },
  };
}

function zeroTuple() {
  return { input: 0, output: 0, cached: 0, total: 0 };
}

function get(
  totals: Map<string, ItemTokenTotals>,
  id: string,
): ItemTokenTotals {
  const t = totals.get(id);
  if (!t) throw new Error(`missing totals for ${id}`);
  return t;
}

// ---------------------------------------------------------------------------
// Basic rollup
// ---------------------------------------------------------------------------

describe("aggregateItemTokenUsage", () => {
  it("returns a totals entry for every item in the PRD", () => {
    const prd: PRDItem[] = [
      item("epic1", [
        item("feat1", [item("task1"), item("task2")]),
      ]),
    ];
    const { totals } = aggregateItemTokenUsage(prd, []);
    expect(new Set(totals.keys())).toEqual(
      new Set(["epic1", "feat1", "task1", "task2"]),
    );
  });

  it("zeroes all counts for items with no runs", () => {
    const prd: PRDItem[] = [item("epic1", [item("task1")])];
    const { totals, orphans } = aggregateItemTokenUsage(prd, []);
    expect(orphans).toEqual([]);
    for (const id of ["epic1", "task1"]) {
      const t = get(totals, id);
      expect(t.self).toEqual(zeroTuple());
      expect(t.descendants).toEqual(zeroTuple());
      expect(t.total).toEqual(zeroTuple());
    }
  });

  it("attributes a run's tokens to its exact item as self usage", () => {
    const prd: PRDItem[] = [item("epic1", [item("task1")])];
    const { totals } = aggregateItemTokenUsage(prd, [run("task1", 100, 50, 10)]);
    const task = get(totals, "task1");
    expect(task.self).toEqual({ input: 100, output: 50, cached: 10, total: 160 });
    expect(task.descendants).toEqual(zeroTuple());
    expect(task.total).toEqual(task.self);
  });

  it("rolls up child totals into parent descendants and total", () => {
    const prd: PRDItem[] = [
      item("epic1", [
        item("feat1", [
          item("task1"),
          item("task2"),
        ]),
      ]),
    ];
    const runs: ItemRunTokens[] = [
      run("task1", 10, 20),
      run("task2", 3, 7),
      run("feat1", 1, 1), // self usage on the feature
    ];
    const { totals } = aggregateItemTokenUsage(prd, runs);

    const task1 = get(totals, "task1");
    expect(task1.self.total).toBe(30);
    expect(task1.total.total).toBe(30);

    const feat1 = get(totals, "feat1");
    expect(feat1.self.total).toBe(2);
    expect(feat1.descendants.total).toBe(30 + 10);
    expect(feat1.total.total).toBe(2 + 30 + 10);

    const epic1 = get(totals, "epic1");
    expect(epic1.self.total).toBe(0);
    expect(epic1.descendants.total).toBe(feat1.total.total);
    expect(epic1.total.total).toBe(feat1.total.total);
  });

  it("sums multiple runs against the same item", () => {
    const prd: PRDItem[] = [item("task1")];
    const { totals } = aggregateItemTokenUsage(prd, [
      run("task1", 1, 2),
      run("task1", 3, 4),
      run("task1", 5, 6),
    ]);
    const t = get(totals, "task1");
    expect(t.self).toEqual({ input: 9, output: 12, cached: 0, total: 21 });
    expect(t.runCount).toBe(3);
  });

  it("tracks run count per item including descendants", () => {
    const prd: PRDItem[] = [
      item("epic1", [item("task1"), item("task2")]),
    ];
    const { totals } = aggregateItemTokenUsage(prd, [
      run("task1", 1, 0),
      run("task1", 1, 0),
      run("task2", 1, 0),
    ]);
    expect(get(totals, "task1").runCount).toBe(2);
    expect(get(totals, "task2").runCount).toBe(1);
    expect(get(totals, "epic1").runCount).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Orphan handling
  // -------------------------------------------------------------------------

  it("reports runs whose itemId is not in the PRD as orphans", () => {
    const prd: PRDItem[] = [item("task1")];
    const stray = run("ghost-item", 5, 10, 2);
    const { totals, orphans } = aggregateItemTokenUsage(prd, [
      run("task1", 1, 1),
      stray,
    ]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]).toEqual(stray);
    // Orphan tokens MUST NOT leak into any item's totals
    const task = get(totals, "task1");
    expect(task.total).toEqual({ input: 1, output: 1, cached: 0, total: 2 });
  });

  it("treats archived/pruned items (not in tree) as orphan attribution targets", () => {
    const prd: PRDItem[] = [item("task1")];
    // task2 was archived out of the tree. Its historical run should surface
    // as an orphan rather than silently vanishing.
    const { orphans } = aggregateItemTokenUsage(prd, [run("task2", 5, 5)]);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].itemId).toBe("task2");
  });

  // -------------------------------------------------------------------------
  // Property-style: for every subtree, total === self + sum(children.total)
  // -------------------------------------------------------------------------

  it("invariant: for every item, total = self + sum(children.total)", () => {
    // Deterministic pseudo-random tree + run set (seeded mulberry32).
    let seed = 0xabc123;
    const rand = (): number => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = seed;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    let nextId = 0;
    function mkTree(depth: number, breadth: number): PRDItem {
      const id = `n${nextId++}`;
      if (depth === 0) return item(id);
      const children: PRDItem[] = [];
      const count = 1 + Math.floor(rand() * breadth);
      for (let i = 0; i < count; i++) {
        children.push(mkTree(depth - 1, breadth));
      }
      return item(id, children);
    }

    const roots: PRDItem[] = [mkTree(4, 3), mkTree(3, 2), mkTree(2, 4)];

    // Collect all ids
    const allIds: string[] = [];
    const stack: PRDItem[] = [...roots];
    while (stack.length) {
      const n = stack.pop()!;
      allIds.push(n.id);
      if (n.children) stack.push(...n.children);
    }

    // Generate runs: mostly on known ids, some orphans
    const runs: ItemRunTokens[] = [];
    for (let i = 0; i < 200; i++) {
      const useOrphan = rand() < 0.05;
      const id = useOrphan
        ? `missing${Math.floor(rand() * 50)}`
        : allIds[Math.floor(rand() * allIds.length)];
      runs.push(
        run(id, Math.floor(rand() * 500), Math.floor(rand() * 200), Math.floor(rand() * 50)),
      );
    }

    const { totals } = aggregateItemTokenUsage(roots, runs);

    // Walk and verify invariant
    function check(node: PRDItem): void {
      const t = get(totals, node.id);
      const kids = node.children ?? [];
      const childSum = kids.reduce(
        (acc, c) => {
          const ct = get(totals, c.id);
          return {
            input: acc.input + ct.total.input,
            output: acc.output + ct.total.output,
            cached: acc.cached + ct.total.cached,
            total: acc.total + ct.total.total,
          };
        },
        { input: 0, output: 0, cached: 0, total: 0 },
      );
      expect(t.descendants).toEqual(childSum);
      expect(t.total.input).toBe(t.self.input + childSum.input);
      expect(t.total.output).toBe(t.self.output + childSum.output);
      expect(t.total.cached).toBe(t.self.cached + childSum.cached);
      expect(t.total.total).toBe(t.self.total + childSum.total);
      kids.forEach(check);
    }
    roots.forEach(check);
  });

  // -------------------------------------------------------------------------
  // Performance: 500 items, 5000 runs, under 50ms
  // -------------------------------------------------------------------------

  it("aggregates 500 items × 5000 runs in under 50ms", () => {
    // Build a reasonable tree: 5 epics × 10 features × 10 tasks = 500 items.
    const prd: PRDItem[] = [];
    const ids: string[] = [];
    for (let e = 0; e < 5; e++) {
      const features: PRDItem[] = [];
      for (let f = 0; f < 10; f++) {
        const tasks: PRDItem[] = [];
        for (let t = 0; t < 10; t++) {
          const id = `e${e}-f${f}-t${t}`;
          ids.push(id);
          tasks.push(item(id));
        }
        features.push(item(`e${e}-f${f}`, tasks));
      }
      prd.push(item(`e${e}`, features));
    }

    // 5000 runs randomly distributed across the 500 items, with ~1% orphans.
    const runs: ItemRunTokens[] = [];
    let rng = 1;
    const next = (): number => {
      rng = (rng * 1664525 + 1013904223) >>> 0;
      return rng / 4294967296;
    };
    for (let i = 0; i < 5000; i++) {
      const orphan = next() < 0.01;
      const id = orphan ? `missing-${i}` : ids[Math.floor(next() * ids.length)];
      runs.push(run(id, Math.floor(next() * 1000), Math.floor(next() * 200)));
    }

    // Warm-up (avoid JIT noise on the measured call)
    aggregateItemTokenUsage(prd, runs);

    const start = performance.now();
    const { totals, orphans } = aggregateItemTokenUsage(prd, runs);
    const elapsed = performance.now() - start;

    expect(totals.size).toBeGreaterThanOrEqual(500);
    expect(orphans.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(50);
  });
});
