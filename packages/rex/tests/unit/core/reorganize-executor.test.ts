import { describe, it, expect } from "vitest";
import {
  applyProposals,
  formatApplyResult,
} from "../../../src/core/reorganize-executor.js";
import type { ReorganizationProposal } from "../../../src/core/reorganize.js";
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

function makeProposal(
  id: number,
  type: string,
  detail: ReorganizationProposal["detail"],
  items: string[] = [],
): ReorganizationProposal {
  return {
    id,
    type: type as ReorganizationProposal["type"],
    description: `Test proposal #${id}`,
    reason: "Testing",
    confidence: 0.8,
    risk: "low",
    items,
    detail,
  };
}

// ── Apply: delete ────────────────────────────────────────────────────────────

describe("applyProposals — delete", () => {
  it("removes an item from the tree", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [makeFeature("f1", [makeTask("t1")])]),
      makeEpic("e-empty"),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "delete", {
        kind: "delete",
        itemId: "e-empty",
        subtreeCount: 1,
      }, ["e-empty"]),
    ]);

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e1");
  });

  it("reports error for missing item", () => {
    const items: PRDItem[] = [makeEpic("e1")];

    const result = applyProposals(items, [
      makeProposal(1, "delete", {
        kind: "delete",
        itemId: "nonexistent",
        subtreeCount: 1,
      }),
    ]);

    expect(result.applied).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain("not found");
  });
});

// ── Apply: move ──────────────────────────────────────────────────────────────

describe("applyProposals — move", () => {
  it("moves a feature under an epic", () => {
    const items: PRDItem[] = [
      makeEpic("e1"),
      makeFeature("f-orphan", [makeTask("t1")]),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "move", {
        kind: "move",
        itemId: "f-orphan",
        fromParentId: null,
        toParentId: "e1",
      }, ["f-orphan", "e1"]),
    ]);

    expect(result.applied).toBe(1);
    // Feature should now be under e1
    expect(items).toHaveLength(1);
    expect(items[0].children).toHaveLength(1);
    expect(items[0].children![0].id).toBe("f-orphan");
  });
});

// ── Apply: prune ─────────────────────────────────────────────────────────────

describe("applyProposals — prune", () => {
  it("removes fully completed subtrees", () => {
    const items: PRDItem[] = [
      makeEpic("e-done", [
        makeFeature("f-done", [
          makeTask("t-done", { status: "completed" }),
        ], { status: "completed" }),
      ], { status: "completed" }),
      makeEpic("e2", [makeFeature("f2", [makeTask("t2")])]),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "prune", {
        kind: "prune",
        itemIds: ["e-done"],
        totalCount: 3,
      }),
    ]);

    expect(result.applied).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e2");
  });
});

// ── Apply: merge ─────────────────────────────────────────────────────────────

describe("applyProposals — merge", () => {
  it("merges sibling items", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1", { title: "Implement user auth" }),
          makeTask("t2", { title: "Implement user authentication" }),
          makeTask("t3", { title: "Set up database" }),
        ]),
      ]),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "merge", {
        kind: "merge",
        sourceIds: ["t1", "t2"],
        targetId: "t1",
      }, ["t1", "t2"]),
    ]);

    expect(result.applied).toBe(1);
    const feature = items[0].children![0];
    expect(feature.children).toHaveLength(2);
    expect(feature.children!.map((c) => c.id)).toContain("t1");
    expect(feature.children!.map((c) => c.id)).toContain("t3");
    expect(feature.children!.map((c) => c.id)).not.toContain("t2");
  });
});

// ── Apply: collapse ──────────────────────────────────────────────────────────

describe("applyProposals — collapse", () => {
  it("collapses single-child container", () => {
    const items: PRDItem[] = [
      makeEpic("e1", [
        makeFeature("f1", [
          makeTask("t1"),
          makeTask("t2"),
        ]),
      ]),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "collapse", {
        kind: "collapse",
        parentId: "e1",
        childId: "f1",
      }, ["e1", "f1"]),
    ]);

    expect(result.applied).toBe(1);
    // f1 should be replaced by its children directly under e1
    const epic = items[0];
    expect(epic.children).toHaveLength(2);
    expect(epic.children![0].id).toBe("t1");
    expect(epic.children![1].id).toBe("t2");
  });

  it("reports error when parent not found", () => {
    const items: PRDItem[] = [makeEpic("e1")];

    const result = applyProposals(items, [
      makeProposal(1, "collapse", {
        kind: "collapse",
        parentId: "nonexistent",
        childId: "f1",
      }),
    ]);

    expect(result.failed).toBe(1);
  });
});

// ── Apply: split ─────────────────────────────────────────────────────────────

describe("applyProposals — split", () => {
  it("fails with informative message", () => {
    const items: PRDItem[] = [makeEpic("e1")];

    const result = applyProposals(items, [
      makeProposal(1, "split", {
        kind: "split",
        containerId: "e1",
        groups: [],
        suggestedTitles: [],
      }),
    ]);

    expect(result.failed).toBe(1);
    expect(result.results[0].error).toContain("manual grouping");
  });
});

// ── Multiple proposals ───────────────────────────────────────────────────────

describe("applyProposals — multiple proposals", () => {
  it("applies multiple proposals in order", () => {
    const items: PRDItem[] = [
      makeEpic("e-empty"),
      makeEpic("e-done", [
        makeFeature("f-done", [
          makeTask("t-done", { status: "completed" }),
        ], { status: "completed" }),
      ], { status: "completed" }),
      makeEpic("e-keep", [
        makeFeature("f-keep", [makeTask("t-keep")]),
      ]),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "delete", { kind: "delete", itemId: "e-empty", subtreeCount: 1 }),
      makeProposal(2, "prune", { kind: "prune", itemIds: ["e-done"], totalCount: 3 }),
    ]);

    expect(result.applied).toBe(2);
    expect(result.failed).toBe(0);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e-keep");
  });

  it("continues after a failure", () => {
    const items: PRDItem[] = [
      makeEpic("e-empty"),
      makeEpic("e-keep", [makeFeature("f1", [makeTask("t1")])]),
    ];

    const result = applyProposals(items, [
      makeProposal(1, "delete", { kind: "delete", itemId: "nonexistent", subtreeCount: 1 }),
      makeProposal(2, "delete", { kind: "delete", itemId: "e-empty", subtreeCount: 1 }),
    ]);

    expect(result.applied).toBe(1);
    expect(result.failed).toBe(1);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("e-keep");
  });
});

// ── Formatting ───────────────────────────────────────────────────────────────

describe("formatApplyResult", () => {
  it("formats success result", () => {
    const output = formatApplyResult({
      applied: 3,
      failed: 0,
      results: [
        { proposalId: 1, success: true },
        { proposalId: 2, success: true },
        { proposalId: 3, success: true },
      ],
    });
    expect(output).toContain("Applied 3 proposals");
  });

  it("formats failure result", () => {
    const output = formatApplyResult({
      applied: 1,
      failed: 1,
      results: [
        { proposalId: 1, success: true },
        { proposalId: 2, success: false, error: "Item not found" },
      ],
    });
    expect(output).toContain("Applied 1 proposal");
    expect(output).toContain("1 proposal failed");
    expect(output).toContain("#2: Item not found");
  });

  it("formats empty result", () => {
    const output = formatApplyResult({
      applied: 0,
      failed: 0,
      results: [],
    });
    expect(output).toContain("No proposals");
  });
});
