import { describe, it, expect } from "vitest";
import {
  computeHealthScore,
  formatHealthScore,
} from "../../../src/core/health.js";
import type { PRDItem } from "../../../src/schema/index.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<PRDItem> & { id: string; level: string }): PRDItem {
  return {
    title: `Item ${overrides.id}`,
    status: "pending",
    ...overrides,
  } as PRDItem;
}

function makeEpic(id: string, children: PRDItem[] = [], overrides?: Partial<PRDItem>): PRDItem {
  return makeItem({ id, level: "epic", title: `Epic ${id}`, children, ...overrides });
}

function makeFeature(id: string, children: PRDItem[] = [], overrides?: Partial<PRDItem>): PRDItem {
  return makeItem({ id, level: "feature", title: `Feature ${id}`, children, ...overrides });
}

function makeTask(id: string, overrides?: Partial<PRDItem>): PRDItem {
  return makeItem({ id, level: "task", title: `Task ${id}`, ...overrides });
}

function makeRichTask(id: string, overrides?: Partial<PRDItem>): PRDItem {
  return makeTask(id, {
    title: `Implement feature component ${id}`,
    description: `Description for task ${id}`,
    acceptanceCriteria: [`Criterion for ${id}`],
    priority: "medium",
    ...overrides,
  });
}

// ── Overall score ────────────────────────────────────────────────────────────

describe("computeHealthScore", () => {
  it("returns 100 for empty tree", () => {
    const health = computeHealthScore([]);
    expect(health.overall).toBe(100);
    expect(health.suggestions).toHaveLength(0);
  });

  it("returns high score for well-structured tree", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeRichTask("t1"),
          makeRichTask("t2"),
        ], { description: "Feature description" }),
        makeFeature("f2", [
          makeRichTask("t3"),
          makeRichTask("t4"),
        ], { description: "Feature description" }),
      ]),
      makeEpic("e2", [
        makeFeature("f3", [
          makeRichTask("t5"),
          makeRichTask("t6"),
        ], { description: "Feature description" }),
        makeFeature("f4", [
          makeRichTask("t7"),
          makeRichTask("t8"),
        ], { description: "Feature description" }),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.overall).toBeGreaterThanOrEqual(80);
  });

  it("returns low score for poorly structured tree", () => {
    // All tasks at root level, no descriptions, no criteria
    const items: PRDItem[] = [
      makeTask("t1"),
      makeTask("t2"),
      makeTask("t3"),
    ];

    const health = computeHealthScore(items);
    expect(health.overall).toBeLessThan(50);
  });
});

// ── Depth dimension ──────────────────────────────────────────────────────────

describe("depth dimension", () => {
  it("scores 100 when all items are at correct depth", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [makeTask("t1")]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.depth).toBe(100);
  });

  it("penalizes features at root level", () => {
    const items: PRDItem[] = [
      makeFeature("f1", [makeTask("t1")]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.depth).toBeLessThan(100);
  });

  it("heavily penalizes work items at root level", () => {
    const items: PRDItem[] = [
      makeTask("t1"),
      makeTask("t2"),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.depth).toBeLessThan(50);
  });
});

// ── Balance dimension ────────────────────────────────────────────────────────

describe("balance dimension", () => {
  it("scores 100 for evenly balanced containers", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [makeTask("t1"), makeTask("t2")]),
        makeFeature("f2", [makeTask("t3"), makeTask("t4")]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.balance).toBe(100);
  });

  it("penalizes severely imbalanced containers", () => {
    const manyTasks = Array.from({ length: 20 }, (_, i) => makeTask(`t${i}`));
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", manyTasks),
        makeFeature("f2", [makeTask("t-single")]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.balance).toBeLessThan(80);
  });
});

// ── Granularity dimension ────────────────────────────────────────────────────

describe("granularity dimension", () => {
  it("scores 100 for tasks with full metadata", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeRichTask("t1"),
          makeRichTask("t2"),
        ]),
        makeFeature("f2", [
          makeRichTask("t3"),
          makeRichTask("t4"),
        ]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.granularity).toBe(100);
  });

  it("penalizes tasks missing descriptions", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1"),
          makeTask("t2"),
        ]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.granularity).toBeLessThan(100);
  });

  it("penalizes very short task titles", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Fix" }),
          makeTask("t2", { title: "Add" }),
        ]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.granularity).toBeLessThan(80);
  });
});

// ── Completeness dimension ───────────────────────────────────────────────────

describe("completeness dimension", () => {
  it("scores 100 for fully annotated items", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeRichTask("t1"),
          makeRichTask("t2"),
        ], { description: "Feature desc" }),
      ], { description: "Epic desc" }),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.completeness).toBeGreaterThanOrEqual(80);
  });

  it("penalizes missing descriptions and criteria", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1"),
          makeTask("t2"),
        ]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.completeness).toBeLessThan(70);
  });
});

// ── Staleness dimension ──────────────────────────────────────────────────────

describe("staleness dimension", () => {
  it("scores 100 when no items are stale", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1"),
          makeTask("t2"),
        ]),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.dimensions.staleness).toBe(100);
  });

  it("penalizes items in_progress for too long", () => {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();

    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { status: "in_progress", startedAt: threeDaysAgo }),
          makeTask("t2"),
        ]),
      ]),
    ];

    const health = computeHealthScore(items, { now });
    expect(health.dimensions.staleness).toBeLessThan(100);
  });

  it("does not penalize recently started tasks", () => {
    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { status: "in_progress", startedAt: oneHourAgo }),
        ]),
      ]),
    ];

    const health = computeHealthScore(items, { now });
    expect(health.dimensions.staleness).toBe(100);
  });
});

// ── Suggestions ──────────────────────────────────────────────────────────────

describe("suggestions", () => {
  it("generates suggestions for weak dimensions", () => {
    const items: PRDItem[] = [
      makeTask("t1"),
      makeTask("t2"),
    ];

    const health = computeHealthScore(items);
    expect(health.suggestions.length).toBeGreaterThan(0);
  });

  it("generates at most 3 suggestions", () => {
    // Create a tree with many issues
    const items: PRDItem[] = [
      makeTask("t1", { title: "Fix" }),
      makeTask("t2", { title: "Add" }),
      makeFeature("f1"),
    ];

    const health = computeHealthScore(items);
    expect(health.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("generates no suggestions for perfect tree", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeRichTask("t1"),
          makeRichTask("t2"),
        ], { description: "Feature desc" }),
        makeFeature("f2", [
          makeRichTask("t3"),
          makeRichTask("t4"),
        ], { description: "Feature desc" }),
      ]),
      makeEpic("e2", [
        makeFeature("f3", [
          makeRichTask("t5"),
          makeRichTask("t6"),
        ], { description: "Feature desc" }),
        makeFeature("f4", [
          makeRichTask("t7"),
          makeRichTask("t8"),
        ], { description: "Feature desc" }),
      ]),
    ];

    const health = computeHealthScore(items);
    expect(health.suggestions).toHaveLength(0);
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe("formatHealthScore", () => {
  it("formats score with all dimensions", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [makeTask("t1")]),
      ]),
    ];

    const health = computeHealthScore(items);
    const output = formatHealthScore(health);

    expect(output).toContain("Structure Health Score");
    expect(output).toContain("Overall:");
    expect(output).toContain("Depth");
    expect(output).toContain("Balance");
    expect(output).toContain("Granularity");
    expect(output).toContain("Completeness");
    expect(output).toContain("Freshness");
  });

  it("includes suggestions when present", () => {
    const items: PRDItem[] = [
      makeTask("t1"),
      makeTask("t2"),
    ];

    const health = computeHealthScore(items);
    const output = formatHealthScore(health);

    expect(output).toContain("Suggestions:");
  });
});
