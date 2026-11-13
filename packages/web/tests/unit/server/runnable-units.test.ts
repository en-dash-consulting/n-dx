import { describe, expect, it } from "vitest";
import type { PRDItem, RuleNode } from "../../../src/server/rex-gateway.js";
import { markRunnableUnits, unitRefusal } from "../../../src/server/runnable-units.js";

const change = (extra: Record<string, unknown> = {}) => ({
  id: "change", type: "change", title: "Change", status: "pending", ...extra,
});
const task = (extra: Record<string, unknown> = {}) => ({
  id: "task", type: "task", title: "Task", status: "pending", ...extra,
});
const product = [{ id: "cap", type: "capability", title: "Capability" }] as RuleNode[];
type Marked = PRDItem & { executionEligible?: boolean; executionRefusal?: string; runsAsOneTask?: boolean };

function mark(root: Record<string, unknown>, targets = product): Marked {
  const items = [root] as unknown as PRDItem[];
  markRunnableUnits(items, targets);
  return items[0] as Marked;
}

describe("indexed runnable units", () => {
  it.each([
    ["held Inbox", { needsPlacement: true }, /placement/i, true],
    ["applied", { appliedAt: "2026-11-12T00:00:00Z" }, /applied/i, false],
    ["completed", { status: "completed" }, /closed/i, true],
    ["cancelled", { status: "cancelled" }, /closed/i, true],
    ["deleted", { status: "deleted" }, /deleted/i, false],
    ["container", { children: [change({ id: "inner" })] }, /nested changes/i, false],
    ["with tasks", { children: [task()] }, /save.*tasks/i, false],
  ] as const)("does not advertise a %s change", (_name, fields, reason, showInDetail) => {
    const item = mark(change(fields));
    expect(item.executionEligible).toBe(false);
    const refusal = unitRefusal([item], product)(item);
    expect(refusal).toMatch(reason);
    expect(item.executionRefusal).toBe(showInDetail ? refusal : undefined);
    expect(item.runsAsOneTask).not.toBe(true);
  });

  it("clears a stale detail hint when a held change is applied", () => {
    const item = mark(change({ needsPlacement: true }));
    expect(item.executionRefusal).toMatch(/placement/i);
    Object.assign(item, { appliedAt: "2026-11-12T00:00:00Z" });
    markRunnableUnits([item], product);
    expect(item.executionEligible).toBe(false);
    expect(item.executionRefusal).toBeUndefined();
    expect(unitRefusal([item], product)(item)).toMatch(/applied/i);
  });

  it.each([
    { needsPlacement: true }, { appliedAt: "2026-11-12T00:00:00Z" }, { status: "completed" },
  ])("carries an enclosing change's refusal to its tasks: %j", (fields) => {
    const item = mark(change({ ...fields, children: [task()] }));
    expect((item.children![0] as Marked).executionEligible).toBe(false);
  });

  it("directs a v2 subtask to its parent task", () => {
    const item = mark(change({ children: [task({ children: [task({ id: "sub", type: "subtask" })] })] }));
    const sub = item.children![0].children![0] as Marked;
    expect(sub.executionEligible).toBe(false);
    expect(sub.executionRefusal).toMatch(/parent task.*task/i);
  });

  it("preserves the empty-product Inbox exception and placed units", () => {
    for (const item of [mark(change({ needsPlacement: true }), []), mark(change())]) {
      expect(item.executionEligible).toBe(true);
      expect(item.runsAsOneTask).toBe(true);
    }
  });

  it("does not apply autonomous status or dependency gates to explicit tasks", () => {
    const item = mark(change({ status: "deferred", blockedBy: ["missing"], children: [task({ status: "deferred", blockedBy: ["missing"] })] }));
    expect((item.children![0] as Marked).executionEligible).toBe(true);
  });

  it.each(["task", "subtask"])("preserves v1 %s", (level) => {
    const items = [{ id: level, level, title: level, status: "pending" }] as PRDItem[];
    markRunnableUnits(items);
    expect((items[0] as Marked).executionEligible).toBe(true);
  });
});
