import { describe, it, expect } from "vitest";
import type { PRDItem, Requirement } from "../../../src/schema/v1.js";
import { evaluateReady, applyReadyMarking } from "../../../src/core/ready.js";
import { findNextTask, collectCompletedIds } from "../../../src/core/next-task.js";

// ── Helpers ──────────────────────────────────────────────────────

function makeReq(overrides: Partial<Requirement> & { id: string; title: string }): Requirement {
  return {
    category: "technical",
    validationType: "automated",
    acceptanceCriteria: ["Must pass"],
    ...overrides,
  };
}

function makeItem(overrides: Partial<PRDItem> & { id: string; title: string }): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("evaluateReady", () => {
  it("returns null for an unknown item", () => {
    expect(evaluateReady([makeItem({ id: "a", title: "A" })], "missing")).toBeNull();
  });

  it("does not qualify with zero requirements", () => {
    const items = [makeItem({ id: "a", title: "A" })];
    const result = evaluateReady(items, "a")!;
    expect(result.qualifies).toBe(false);
    expect(result.qualifyingRequirementCount).toBe(0);
    expect(result.reason).toMatch(/no automated or metric requirement/);
  });

  it("does not qualify with only a manual requirement", () => {
    const items = [
      makeItem({
        id: "a",
        title: "A",
        requirements: [makeReq({ id: "r1", title: "Manual review", validationType: "manual" })],
      }),
    ];
    const result = evaluateReady(items, "a")!;
    expect(result.qualifies).toBe(false);
    expect(result.qualifyingRequirementCount).toBe(0);
  });

  it("qualifies with an automated requirement and no blocker", () => {
    const items = [
      makeItem({
        id: "a",
        title: "A",
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];
    const result = evaluateReady(items, "a")!;
    expect(result.qualifies).toBe(true);
    expect(result.qualifyingRequirementCount).toBe(1);
    expect(result.reason).toMatch(/no open blocker/);
  });

  it("qualifies with a metric requirement", () => {
    const items = [
      makeItem({
        id: "a",
        title: "A",
        requirements: [makeReq({ id: "r1", title: "Coverage", validationType: "metric", threshold: 80 })],
      }),
    ];
    expect(evaluateReady(items, "a")!.qualifies).toBe(true);
  });

  it("inherits a qualifying requirement from an ancestor", () => {
    const items = [
      makeItem({
        id: "epic-1",
        title: "Epic",
        level: "epic",
        requirements: [makeReq({ id: "r1", title: "Security", validationType: "automated" })],
        children: [makeItem({ id: "task-1", title: "Task" })],
      }),
    ];
    const result = evaluateReady(items, "task-1")!;
    expect(result.qualifies).toBe(true);
    expect(result.qualifyingRequirementCount).toBe(1);
  });

  it("does not qualify when blockedBy has an unresolved dependency", () => {
    const items = [
      makeItem({ id: "blocker", title: "Blocker", status: "pending" }),
      makeItem({
        id: "a",
        title: "A",
        blockedBy: ["blocker"],
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];
    const result = evaluateReady(items, "a")!;
    expect(result.qualifies).toBe(false);
    expect(result.openBlockerIds).toEqual(["blocker"]);
    expect(result.reason).toMatch(/open blocker\(s\): blocker/);
  });

  it("qualifies once the blocking dependency is completed", () => {
    const items = [
      makeItem({ id: "blocker", title: "Blocker", status: "completed" }),
      makeItem({
        id: "a",
        title: "A",
        blockedBy: ["blocker"],
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];
    expect(evaluateReady(items, "a")!.qualifies).toBe(true);
  });

  it("does not qualify when status is blocked, even with no blockedBy ids", () => {
    const items = [
      makeItem({
        id: "a",
        title: "A",
        status: "blocked",
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];
    const result = evaluateReady(items, "a")!;
    expect(result.qualifies).toBe(false);
    expect(result.statusBlocked).toBe(true);
    expect(result.reason).toMatch(/status is blocked/);
  });

  it.each(["completed", "deferred", "cancelled", "deleted"] as const)(
    "never qualifies a %s item even with a qualifying requirement",
    (status) => {
      const items = [
        makeItem({
          id: "a",
          title: "A",
          status,
          requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
        }),
      ];
      const result = evaluateReady(items, "a")!;
      expect(result.qualifies).toBe(false);
      expect(result.reason).toBe(`Item is already ${status}.`);
    },
  );
});

describe("applyReadyMarking", () => {
  it("marks qualifying items and leaves non-candidates untouched", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "a",
        title: "Qualifies",
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
      makeItem({ id: "b", title: "No requirement" }),
    ];

    const outcome = applyReadyMarking(items);

    expect(items[0].ready).toBe(true);
    expect(items[1].ready).toBeUndefined();
    expect(outcome.markedReadyCount).toBe(1);
    expect(outcome.unmarkedCount).toBe(0);
    expect(outcome.skippedNoRequirementCount).toBe(1);
    // Only the qualifying item is reported — the no-requirement item is folded
    // into the skipped count, not listed.
    expect(outcome.evaluations.map((e) => e.itemId)).toEqual(["a"]);
  });

  it("reports a blocked item that has a qualifying requirement", () => {
    const items: PRDItem[] = [
      makeItem({ id: "blocker", title: "Blocker" }),
      makeItem({
        id: "a",
        title: "Blocked",
        blockedBy: ["blocker"],
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];

    const outcome = applyReadyMarking(items);

    expect(items[1].ready).toBeUndefined();
    expect(outcome.markedReadyCount).toBe(0);
    const reported = outcome.evaluations.find((e) => e.itemId === "a");
    expect(reported?.qualifies).toBe(false);
  });

  it("unmarks a previously-ready item that no longer qualifies", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "a",
        title: "Was ready",
        ready: true,
        status: "blocked",
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];

    const outcome = applyReadyMarking(items);

    expect(items[0].ready).toBeUndefined();
    expect(outcome.unmarkedCount).toBe(1);
    expect(outcome.markedReadyCount).toBe(0);
  });

  it("is idempotent: a second run makes no further changes", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "a",
        title: "Qualifies",
        requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
      }),
    ];

    applyReadyMarking(items);
    const second = applyReadyMarking(items);

    expect(items[0].ready).toBe(true);
    expect(second.markedReadyCount).toBe(0);
    expect(second.unmarkedCount).toBe(0);
  });
});

/**
 * Readiness inherits blockers the way it already inherits requirements.
 *
 * `collectActionable` stops descending at a blocked, cancelled or deleted
 * ancestor, and at one with an unresolved `blockedBy` — so a task under any of
 * those can never be selected. Marking it `ready` claimed the opposite, and the
 * two answers came from two separate pieces of code. They now come from
 * `traversalBlock`, the predicate selection itself uses.
 */
describe("ancestor blockers", () => {
  function nest(ancestor: Partial<PRDItem>, child: Partial<PRDItem> = {}): PRDItem[] {
    return [
      makeItem({
        id: "epic",
        title: "The Epic",
        level: "epic",
        ...ancestor,
        children: [
          makeItem({
            id: "task",
            title: "The Task",
            requirements: [makeReq({ id: "r1", title: "CI check", validationType: "automated" })],
            ...child,
          }),
        ],
      }),
    ];
  }

  it("qualifies when the ancestor chain is clear", () => {
    const result = evaluateReady(nest({}), "task")!;
    expect(result.qualifies).toBe(true);
    expect(result.blockedAncestor).toBeUndefined();
  });

  for (const status of ["blocked", "cancelled", "deleted"] as const) {
    it(`does not qualify under a ${status} ancestor, and names it`, () => {
      const result = evaluateReady(nest({ status }), "task")!;
      expect(result.qualifies).toBe(false);
      expect(result.blockedAncestor).toMatchObject({ id: "epic", title: "The Epic", status });
      expect(result.reason).toContain("The Epic");
      expect(result.reason).toContain(status);
    });
  }

  it("does not qualify under an ancestor with an open blockedBy, and names it", () => {
    const result = evaluateReady(nest({ blockedBy: ["nope"] }), "task")!;
    expect(result.qualifies).toBe(false);
    expect(result.blockedAncestor).toMatchObject({ id: "epic", openBlockerIds: ["nope"] });
    expect(result.reason).toContain("The Epic");
    expect(result.reason).toContain("nope");
  });

  it("qualifies when the ancestor's blockedBy is satisfied", () => {
    const items = nest({ blockedBy: ["done"] });
    items.push(makeItem({ id: "done", title: "Done", status: "completed" }));
    expect(evaluateReady(items, "task")!.qualifies).toBe(true);
  });

  it("a completed or deferred ancestor does not block — selection still descends", () => {
    // `traversalBlock` deliberately omits these: a child under a finished
    // parent may be failing and need retrying.
    expect(evaluateReady(nest({ status: "completed" }), "task")!.qualifies).toBe(true);
    expect(evaluateReady(nest({ status: "deferred" }), "task")!.qualifies).toBe(true);
  });

  it("names the nearest blocked ancestor when more than one blocks", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "epic",
        title: "Outer",
        level: "epic",
        status: "blocked",
        children: [
          makeItem({
            id: "feature",
            title: "Inner",
            level: "feature",
            status: "cancelled",
            children: [
              makeItem({
                id: "task",
                title: "The Task",
                requirements: [makeReq({ id: "r1", title: "CI", validationType: "automated" })],
              }),
            ],
          }),
        ],
      }),
    ];
    expect(evaluateReady(items, "task")!.blockedAncestor).toMatchObject({
      id: "feature",
      status: "cancelled",
    });
  });

  it("applyReadyMarking does not mark a task under a blocked epic", () => {
    const items = nest({ status: "blocked" });
    const outcome = applyReadyMarking(items);
    expect(items[0].children![0].ready).toBeUndefined();
    expect(outcome.markedReadyCount).toBe(0);
    expect(outcome.evaluations.find((e) => e.itemId === "task")?.qualifies).toBe(false);
  });

  it("applyReadyMarking unmarks a task that a newly-blocked ancestor took out", () => {
    const items = nest({ status: "blocked" }, { ready: true });
    const outcome = applyReadyMarking(items);
    expect(items[0].children![0].ready).toBeUndefined();
    expect(outcome.unmarkedCount).toBe(1);
  });

  it("ready never disagrees with selection about the same task", () => {
    // The point of sharing the predicate: anything marked ready must be a task
    // findNextTask would actually be willing to hand out.
    const items = nest({ status: "blocked" });
    applyReadyMarking(items);
    expect(findNextTask(items, collectCompletedIds(items))).toBeNull();
    expect(items[0].children![0].ready).toBeUndefined();
  });
});
