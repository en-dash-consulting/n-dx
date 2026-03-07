import { describe, it, expect } from "vitest";
import {
  detectReorganizations,
  formatReorganizationPlan,
} from "../../../src/core/reorganize.js";
import type {
  ReorganizationPlan,
  MergeDetail,
  MoveDetail,
  CollapseDetail,
} from "../../../src/core/reorganize.js";
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

function makeSubtask(id: string, overrides?: Partial<PRDItem>): PRDItem {
  return makeItem({ id, level: "subtask", title: `Subtask ${id}`, ...overrides });
}

function findProposal(plan: ReorganizationPlan, type: string) {
  return plan.proposals.find((p) => p.type === type);
}

function findAllProposals(plan: ReorganizationPlan, type: string) {
  return plan.proposals.filter((p) => p.type === type);
}

// ── Stage 1: Structural checks ──────────────────────────────────────────────

describe("detectReorganizations — structural checks", () => {
  describe("orphaned features", () => {
    it("detects features at root level", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [makeFeature("f1", [makeTask("t1")])], { title: "Authentication" }),
        makeFeature("f-orphan", [makeTask("t-orphan")], { title: "Auth Helpers" }),
      ];

      const plan = detectReorganizations(items);
      const move = findProposal(plan, "move");

      expect(move).toBeDefined();
      expect(move!.items).toContain("f-orphan");
      expect((move!.detail as MoveDetail).fromParentId).toBeNull();
      // Should suggest moving under the matching epic based on title similarity
      expect((move!.detail as MoveDetail).toParentId).toBe("e1");
    });

    it("produces no move proposals when tree is well-structured", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [makeTask("t1")]),
          makeFeature("f2", [makeTask("t2")]),
        ]),
      ];

      const plan = detectReorganizations(items);
      const moves = findAllProposals(plan, "move");
      expect(moves).toHaveLength(0);
    });

    it("suggests null parent when no epics exist", () => {
      const items: PRDItem[] = [
        makeFeature("f-orphan", [makeTask("t1")]),
      ];

      const plan = detectReorganizations(items);
      const move = findProposal(plan, "move");

      expect(move).toBeDefined();
      expect((move!.detail as MoveDetail).toParentId).toBeNull();
    });
  });

  describe("living document philosophy — no destructive proposals", () => {
    it("does not propose deleting empty containers", () => {
      const items: PRDItem[] = [
        makeEpic("e-empty"),
        makeEpic("e1", [makeFeature("f1", [makeTask("t1")])]),
      ];

      const plan = detectReorganizations(items);
      const deletes = findAllProposals(plan, "delete");
      expect(deletes).toHaveLength(0);
    });

    it("does not propose pruning completed subtrees", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [
            makeTask("t1", { status: "completed" }),
            makeTask("t2", { status: "completed" }),
          ], { status: "completed" }),
        ], { status: "completed" }),
        makeEpic("e2", [
          makeFeature("f2", [makeTask("t3")]),
        ]),
      ];

      const plan = detectReorganizations(items);
      const prunes = findAllProposals(plan, "prune");
      expect(prunes).toHaveLength(0);
    });
  });
});

// ── Stage 2: Similarity checks ──────────────────────────────────────────────

describe("detectReorganizations — similarity checks", () => {
  it("detects near-duplicate sibling tasks", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user authentication flow" }),
          makeTask("t2", { title: "Implement user authentication" }),
          makeTask("t3", { title: "Set up database schema" }),
        ]),
      ]),
    ];

    const plan = detectReorganizations(items);
    const merge = findProposal(plan, "merge");

    expect(merge).toBeDefined();
    expect(merge!.items).toContain("t1");
    expect(merge!.items).toContain("t2");
  });

  it("does not merge unrelated siblings", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user authentication" }),
          makeTask("t2", { title: "Set up database schema" }),
          makeTask("t3", { title: "Add logging middleware" }),
        ]),
      ]),
    ];

    const plan = detectReorganizations(items);
    const merges = findAllProposals(plan, "merge");
    expect(merges).toHaveLength(0);
  });

  it("does not detect similarity across different parents", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user auth" }),
          makeTask("t1b", { title: "Set up database" }),
        ], { title: "Authentication System" }),
        makeFeature("f2", [
          makeTask("t2", { title: "Implement user auth" }),
          makeTask("t2b", { title: "Configure logging" }),
        ], { title: "Observability Layer" }),
      ]),
    ];

    const plan = detectReorganizations(items);
    // t1 and t2 are in different features, so no similarity merge on tasks
    const taskSimilarityMerges = findAllProposals(plan, "merge").filter(
      (p) => p.reason.includes("similarity") && p.items.includes("t1"),
    );
    expect(taskSimilarityMerges).toHaveLength(0);
  });

  it("skips completed items by default", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user authentication flow", status: "completed" }),
          makeTask("t2", { title: "Implement user authentication" }),
          makeTask("t3", { title: "Set up database schema" }),
        ]),
      ]),
    ];

    const plan = detectReorganizations(items);
    // t1 is completed, so similarity with t2 is skipped by default
    const similarityMerges = findAllProposals(plan, "merge").filter(
      (p) => p.reason.includes("similarity"),
    );
    expect(similarityMerges).toHaveLength(0);
  });

  it("includes completed items when option is set", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user authentication flow", status: "completed" }),
          makeTask("t2", { title: "Implement user authentication" }),
          makeTask("t3", { title: "Set up database schema" }),
        ]),
      ]),
    ];

    const plan = detectReorganizations(items, { includeCompleted: true });
    const merge = findAllProposals(plan, "merge").find(
      (p) => p.reason.includes("similarity"),
    );
    expect(merge).toBeDefined();
  });

  it("respects custom similarity threshold", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user auth flow" }),
          makeTask("t2", { title: "Implement user authentication" }),
          makeTask("t3", { title: "Set up database schema" }),
        ]),
      ]),
    ];

    // Very high threshold should find no similarity duplicates
    const plan = detectReorganizations(items, { similarityThreshold: 0.99 });
    const similarityMerges = findAllProposals(plan, "merge").filter(
      (p) => p.reason.includes("similarity"),
    );
    expect(similarityMerges).toHaveLength(0);
  });
});

// ── Stage 3: Balance checks ─────────────────────────────────────────────────

describe("detectReorganizations — balance checks", () => {
  describe("oversized containers", () => {
    it("detects containers exceeding max size", () => {
      const tasks = Array.from({ length: 20 }, (_, i) => makeTask(`t${i}`));
      const items: PRDItem[] = [
        makeEpic("e1", [makeFeature("f1", tasks)]),
      ];

      const plan = detectReorganizations(items, { maxContainerSize: 10 });
      const split = findProposal(plan, "split");

      expect(split).toBeDefined();
      expect(split!.items).toContain("f1");
    });

    it("ignores containers within size limit", () => {
      const tasks = Array.from({ length: 5 }, (_, i) => makeTask(`t${i}`));
      const items: PRDItem[] = [
        makeEpic("e1", [makeFeature("f1", tasks)]),
      ];

      const plan = detectReorganizations(items, { maxContainerSize: 10 });
      const splits = findAllProposals(plan, "split");
      expect(splits).toHaveLength(0);
    });
  });

  describe("undersized containers", () => {
    it("detects containers with too few children", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [makeTask("t1")]),
          makeFeature("f2", [makeTask("t2"), makeTask("t3"), makeTask("t4")]),
        ]),
      ];

      const plan = detectReorganizations(items, { minContainerSize: 2 });
      // f1 has 1 child, below minimum of 2
      const merge = findAllProposals(plan, "merge").find(
        (p) => p.items.includes("f1"),
      );
      expect(merge).toBeDefined();
    });

    it("ignores containers meeting minimum size", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [makeTask("t1"), makeTask("t2")]),
          makeFeature("f2", [makeTask("t3"), makeTask("t4")]),
        ]),
      ];

      const plan = detectReorganizations(items, { minContainerSize: 2 });
      // Both features meet minimum, no undersized proposals
      const undersizedMerges = findAllProposals(plan, "merge").filter(
        (p) => p.reason.includes("below the recommended minimum"),
      );
      expect(undersizedMerges).toHaveLength(0);
    });
  });

  describe("single-child containers", () => {
    it("detects container-within-container with single child", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [makeTask("t1"), makeTask("t2")]),
        ]),
      ];

      const plan = detectReorganizations(items);
      const collapse = findProposal(plan, "collapse");

      expect(collapse).toBeDefined();
      expect((collapse!.detail as CollapseDetail).parentId).toBe("e1");
      expect((collapse!.detail as CollapseDetail).childId).toBe("f1");
    });

    it("does not collapse when single child is a work item", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [makeTask("t1")]),
          makeFeature("f2", [makeTask("t2")]),
        ]),
      ];

      const plan = detectReorganizations(items);
      // Features with single tasks should NOT be collapsed (task is a work item, not a container)
      const collapses = findAllProposals(plan, "collapse");
      expect(collapses).toHaveLength(0);
    });

    it("does not collapse when container has multiple children", () => {
      const items: PRDItem[] = [
        makeEpic("e1", [
          makeFeature("f1", [makeTask("t1")]),
          makeFeature("f2", [makeTask("t2")]),
        ]),
      ];

      const plan = detectReorganizations(items);
      const collapses = findAllProposals(plan, "collapse").filter(
        (p) => (p.detail as CollapseDetail).parentId === "e1",
      );
      expect(collapses).toHaveLength(0);
    });
  });
});

// ── Stats ────────────────────────────────────────────────────────────────────

describe("detectReorganizations — stats", () => {
  it("produces correct stats summary", () => {
    const items: PRDItem[] = [
      makeEpic("e-empty"),
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement auth flow" }),
          makeTask("t2", { title: "Implement auth" }),
        ]),
      ]),
    ];

    const plan = detectReorganizations(items);

    expect(plan.stats.totalProposals).toBe(plan.proposals.length);
    expect(plan.stats.totalProposals).toBeGreaterThan(0);
    expect(plan.stats.affectedItems).toBeGreaterThan(0);

    // All proposals should have sequential IDs
    const ids = plan.proposals.map((p) => p.id);
    expect(ids).toEqual(ids.map((_, i) => i + 1));
  });

  it("returns empty plan for perfect tree", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user authentication" }),
          makeTask("t2", { title: "Set up database schema" }),
        ], { title: "Backend Infrastructure" }),
        makeFeature("f2", [
          makeTask("t4", { title: "Create API endpoints" }),
          makeTask("t5", { title: "Write integration tests" }),
        ], { title: "API Layer" }),
      ], { title: "Server Architecture" }),
      makeEpic("e2", [
        makeFeature("f3", [
          makeTask("t7", { title: "Design landing page" }),
          makeTask("t8", { title: "Implement responsive layout" }),
        ], { title: "Visual Design" }),
        makeFeature("f4", [
          makeTask("t10", { title: "Set up monitoring dashboard" }),
          makeTask("t11", { title: "Configure alerting rules" }),
        ], { title: "Observability" }),
      ], { title: "Frontend Experience" }),
    ];

    const plan = detectReorganizations(items);
    expect(plan.stats.totalProposals).toBe(0);
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe("formatReorganizationPlan", () => {
  it("formats empty plan", () => {
    const plan: ReorganizationPlan = {
      proposals: [],
      stats: {
        totalProposals: 0,
        byType: { merge: 0, move: 0, split: 0, delete: 0, prune: 0, collapse: 0 },
        byRisk: { low: 0, medium: 0, high: 0 },
        affectedItems: 0,
      },
    };

    const output = formatReorganizationPlan(plan);
    expect(output).toContain("No reorganization proposals");
  });

  it("formats plan with proposals", () => {
    const items: PRDItem[] = [
      makeEpic("e-empty"),
      makeEpic("e1", [makeFeature("f1", [makeTask("t1")])]),
    ];

    const plan = detectReorganizations(items);
    const output = formatReorganizationPlan(plan);

    expect(output).toContain("Reorganization Proposals");
    expect(output).toContain("#1");
    expect(output).toContain("Confidence:");
    expect(output).toContain("Risk:");
  });
});
