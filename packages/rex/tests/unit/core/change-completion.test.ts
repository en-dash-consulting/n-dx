import { describe, it, expect } from "vitest";
import { addTask, ChangeCompletionError, completeChange, completeTask } from "../../../src/core/change-completion.js";
import type { ApplyOn } from "../../../src/core/apply-policy.js";
import { isOpenChange, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const OLD = "A shopper can pay by card.";
const NEW = "A shopper can pay by card or wallet.";
const opts = (applyOn: ApplyOn = "complete") => ({ applyOn, appliedAt: NOW.toISOString(), now: NOW });

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const task = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "task", ...extra });
const change = (extra: Record<string, unknown> = {}) =>
  node({ id: "ch", type: "change", amends: [{ delta: "modified", target: "cap", proposed: NEW, summary: "Add wallets" }], ...extra });
const tree = (...changes: RuleNode[]): V2Tree => ({
  product: [node({ id: "area", type: "area", children: [node({ id: "cap", type: "capability", statement: OLD })] })],
  changes,
});
const statement = (t: V2Tree) => t.product[0].children?.[0].statement;
const theChange = (t: V2Tree) => t.changes.find((c) => c.id === "ch")!;

describe("completeTask", () => {
  it("completes the change and applies it when the last task completes under applyOn complete", () => {
    const input = tree(change({ children: [task("t1", { status: "completed" }), task("t2", { status: "in_progress" })] }));
    const result = completeTask(input, "t2", opts());
    expect(result.completed).toEqual(["t2", "ch"]);
    expect(result.apply?.applied).toBe(true);
    expect(theChange(result.tree)).toMatchObject({ status: "completed", appliedAt: NOW.toISOString() });
    expect(statement(result.tree)).toBe(NEW);
    expect(theChange(input).status).toBeUndefined();
  });

  it("completes but leaves the change open and unapplied under review and release", () => {
    for (const applyOn of ["review", "release"] as const) {
      const result = completeTask(tree(change({ children: [task("t")] })), "t", opts(applyOn));
      expect(result.completed).toEqual(["t", "ch"]);
      expect(result.apply?.applied).toBe(false);
      expect(theChange(result.tree).status).toBe("completed");
      expect(isOpenChange(theChange(result.tree))).toBe(true);
      expect(statement(result.tree)).toBe(OLD);
    }
  });

  it("applies nothing to the product layer for a touches-only change", () => {
    const result = completeTask(tree(change({ amends: undefined, touches: ["cap"], children: [task("t")] })), "t", opts());
    expect(result.apply).toMatchObject({ applied: true, result: { applied: [] } });
    expect(result.tree.product).toEqual(tree().product);
  });

  it("waits for every live task; a cancelled task blocks, a deleted one does not", () => {
    expect(completeTask(tree(change({ children: [task("t"), task("u")] })), "t", opts()).completed).toEqual(["t"]);
    expect(completeTask(tree(change({ children: [task("t"), task("u", { status: "cancelled" })] })), "t", opts()).completed).toEqual(["t"]);
    expect(completeTask(tree(change({ children: [task("t"), task("u", { status: "deleted" })] })), "t", opts()).completed).toEqual(["t", "ch"]);
  });

  it("never sweeps an in_progress change (#368)", () => {
    const result = completeTask(tree(change({ status: "in_progress", children: [task("t")] })), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.apply).toBeNull();
    expect(theChange(result.tree).status).toBe("in_progress");
  });

  it("checks only the task's own change", () => {
    const other = node({ id: "other", type: "change", touches: ["cap"], children: [task("o", { status: "completed" })] });
    const result = completeTask(tree(change({ children: [task("t"), task("u")] }), other), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.tree.changes[1].status).toBeUndefined();
  });

  it("holds a change that still needs placement", () => {
    const result = completeTask(tree(change({ needsPlacement: true, children: [task("t")] })), "t", opts());
    expect(result.completed).toEqual(["t"]);
    expect(result.held).toMatchObject({ changeId: "ch" });
    expect(theChange(result.tree).status).toBeUndefined();
  });

  it("reports a refused apply and keeps the change completed and unapplied", () => {
    const stale = change({ amends: [{ delta: "modified", target: "cap", base: "stale", proposed: NEW, summary: "Add wallets" }], children: [task("t")] });
    const result = completeTask(tree(stale), "t", opts());
    expect(result.apply).toMatchObject({ applied: false, error: { name: "ApplyAmendmentsError" } });
    expect(theChange(result.tree).status).toBe("completed");
    expect(theChange(result.tree).appliedAt).toBeUndefined();
  });

  it("refuses a ref that names no live task", () => {
    expect(() => completeTask(tree(change()), "ch", opts())).toThrow(ChangeCompletionError);
  });
});

describe("completeChange", () => {
  it("completes and applies a task-less change on its own, in_progress included", () => {
    const result = completeChange(tree(change({ status: "in_progress" })), "ch", opts());
    expect(result.completed).toEqual(["ch"]);
    expect(statement(result.tree)).toBe(NEW);
  });

  it("refuses while a live task is not completed", () => {
    expect(() => completeChange(tree(change({ children: [task("t", { status: "cancelled" })] })), "ch", opts())).toThrow(/task t is not completed/);
  });
});

describe("addTask split rule", () => {
  const inFlight = (extra: Record<string, unknown> = {}) =>
    change({ status: "in_progress", startedAt: "2026-10-07T09:00:00.000Z", acceptanceCriteria: ["Wallets pay"], requirements: [{ id: "r" }], touches: ["cap"], ...extra });

  it("moves the criteria to the new first task, which takes over the in-flight work", () => {
    const result = addTask(tree(inFlight()), "ch", task("t", { acceptanceCriteria: ["Own"] }));
    expect(result.split).toEqual({ changeId: "ch", taskId: "t", movedCriteria: ["Wallets pay"] });
    const c = theChange(result.tree);
    expect(c.status).toBe("pending");
    expect(c).not.toHaveProperty("acceptanceCriteria");
    expect(c).toMatchObject({ requirements: [{ id: "r" }], touches: ["cap"], amends: [{ target: "cap" }] });
    expect(c.children?.[0]).toMatchObject({ status: "in_progress", startedAt: "2026-10-07T09:00:00.000Z", acceptanceCriteria: ["Own", "Wallets pay"] });
  });

  it("splits without criteria when the change has none", () => {
    const result = addTask(tree(inFlight({ acceptanceCriteria: undefined })), "ch", task("t"));
    expect(result.split?.movedCriteria).toEqual([]);
    expect(theChange(result.tree).children?.[0]).not.toHaveProperty("acceptanceCriteria");
  });

  it("keeps criteria that are not a list on the change rather than dropping them", () => {
    const result = addTask(tree(inFlight({ acceptanceCriteria: "Wallets pay" })), "ch", task("t"));
    expect(result.split?.movedCriteria).toEqual([]);
    expect(theChange(result.tree).acceptanceCriteria).toBe("Wallets pay");
  });

  it("treats a change whose only tasks are deleted as task-less", () => {
    expect(addTask(tree(inFlight({ children: [task("gone", { status: "deleted" })] })), "ch", task("t")).split).not.toBeNull();
  });

  it("does not split a pending change or one that already has a task", () => {
    for (const c of [inFlight({ status: "pending" }), inFlight({ children: [task("u")] })]) {
      const result = addTask(tree(c), "ch", task("t"));
      expect(result.split).toBeNull();
      expect(theChange(result.tree).acceptanceCriteria).toEqual(["Wallets pay"]);
      expect(theChange(result.tree).children?.at(-1)).toMatchObject({ id: "t" });
      expect(theChange(result.tree).children?.at(-1)?.status).toBeUndefined();
    }
  });
});
