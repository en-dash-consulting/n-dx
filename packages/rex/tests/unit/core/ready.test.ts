import { describe, it, expect } from "vitest";
import type { PRDItem, Requirement } from "../../../src/schema/v1.js";
import { evaluateReady, applyReadyMarking } from "../../../src/core/ready.js";

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
