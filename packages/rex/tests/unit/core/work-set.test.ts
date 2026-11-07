import { describe, it, expect } from "vitest";
import type { V2Tree } from "../../../src/schema/v2-rules.js";
import { planAssignToBranch, planUnassignFromBranch, readWorkSet, WorkSetError } from "../../../src/core/work-set.js";

const node = (id: string, fields: Record<string, unknown>) => ({ id, title: id, slug: id, ...fields });
const task = (id: string, fields: Record<string, unknown> = {}) => node(id, { type: "task", status: "pending", ...fields });

/** A change with one task in every status, a task-less change, a container and a product node. */
function fixture(): V2Tree {
  return {
    product: [node("cap", { type: "capability", status: "pending" })],
    changes: [
      node("pay", {
        type: "change",
        status: "in_progress",
        children: [
          task("t-pending"),
          task("t-progress", { status: "in_progress" }),
          task("t-failing", { status: "failing" }),
          task("t-done", { status: "completed" }),
          task("t-deleted", { status: "deleted" }),
          task("t-deferred", { status: "deferred" }),
        ],
      }),
      node("solo", { type: "change", status: "pending" }),
      node("outer", {
        type: "change",
        status: "pending",
        children: [task("t-outer"), node("inner", { type: "change", status: "pending", children: [task("t-inner")] })],
      }),
    ],
  } as unknown as V2Tree;
}

/** `delivery` of every node that has one, by id. */
function deliveries(tree: V2Tree): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (nodes: readonly Record<string, unknown>[]): void => {
    for (const n of nodes) {
      if (n.delivery !== undefined) out[n.id as string] = n.delivery;
      walk((n.children as Record<string, unknown>[] | undefined) ?? []);
    }
  };
  walk([...tree.product, ...tree.changes] as unknown as Record<string, unknown>[]);
  return out;
}

describe("planAssignToBranch", () => {
  it("assigning a change writes every open task under it, never completed, deferred or deleted ones, nor the change", () => {
    const tree = fixture();
    const before = structuredClone(tree);
    const plan = planAssignToBranch(tree, ["pay"], "feat/pay");

    expect(plan.report).toEqual({ branch: "feat/pay", assigned: ["t-pending", "t-progress", "t-failing"], moved: [], unchanged: [] });
    expect(plan.changed).toBe(true);
    const on = { branch: "feat/pay" };
    expect(deliveries(plan.tree)).toEqual({ "t-pending": on, "t-progress": on, "t-failing": on });
    expect(tree).toEqual(before);
  });

  it("gives a task-less change the field on its own row", () => {
    const plan = planAssignToBranch(fixture(), ["solo"], "feat/solo");
    expect(plan.report.assigned).toEqual(["solo"]);
    expect(deliveries(plan.tree)).toEqual({ solo: { branch: "feat/solo" } });
  });

  it("assigns through nested changes and accepts a task by id", () => {
    const plan = planAssignToBranch(fixture(), ["outer", "t-pending"], "feat/x");
    expect(plan.report.assigned.sort()).toEqual(["t-inner", "t-outer", "t-pending"]);
  });

  it("refuses a unit on another branch, naming it, and changes nothing", () => {
    const tree = planAssignToBranch(fixture(), ["t-progress"], "feat/other").tree;
    let error: unknown;
    try {
      planAssignToBranch(tree, ["pay"], "feat/pay");
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(WorkSetError);
    expect((error as WorkSetError).message).toMatch(/"t-progress".*on branch "feat\/other"; pass move/);
    expect((error as WorkSetError).problems).toHaveLength(1);
    expect(deliveries(tree)).toEqual({ "t-progress": { branch: "feat/other" } });
  });

  it("moves a unit from another branch when move is passed", () => {
    const tree = planAssignToBranch(fixture(), ["t-progress"], "feat/other").tree;
    const plan = planAssignToBranch(tree, ["pay"], "feat/pay", { move: true });
    expect(plan.report.moved).toEqual([{ id: "t-progress", from: "feat/other" }]);
    expect(plan.report.assigned).toContain("t-progress");
    expect(deliveries(plan.tree)["t-progress"]).toEqual({ branch: "feat/pay" });
  });

  it("is a no-op for units already on the branch", () => {
    const tree = planAssignToBranch(fixture(), ["pay"], "feat/pay").tree;
    const plan = planAssignToBranch(tree, ["pay"], "feat/pay");
    expect(plan.changed).toBe(false);
    expect(plan.report).toEqual({ branch: "feat/pay", assigned: [], moved: [], unchanged: ["t-pending", "t-progress", "t-failing"] });
    expect(plan.tree).toEqual(tree);
  });

  it("refuses unknown refs, closed tasks, product nodes, changes with nothing open and bad branch names", () => {
    const refuse = (refs: string[], branch = "feat/x") => () => planAssignToBranch(fixture(), refs, branch);
    expect(refuse(["nope"])).toThrow(/No change or task "nope"/);
    expect(refuse(["t-done"])).toThrow(/is completed: only open tasks/);
    expect(refuse(["t-deleted"])).toThrow(/No change or task "t-deleted"/);
    expect(refuse(["cap"])).toThrow(/is a capability/);
    const closed = fixture();
    (closed.changes[1] as { status: string }).status = "completed";
    expect(() => planAssignToBranch(closed, ["solo"], "feat/x")).toThrow(/has no open task/);
    for (const bad of ["", " feat/x", "feat/x\n"]) expect(refuse(["solo"], bad), JSON.stringify(bad)).toThrow(/Invalid branch name/);
  });
});

describe("planUnassignFromBranch", () => {
  it("removes the field from a task, and from a change and everything under it in any status", () => {
    let tree = planAssignToBranch(fixture(), ["pay", "solo"], "feat/pay").tree;
    // A completed task keeps the delivery it was finished under.
    (tree.changes[0].children![3] as { delivery?: unknown }).delivery = { branch: "feat/pay" };

    const one = planUnassignFromBranch(tree, ["t-pending"]);
    expect(one.report.removed).toEqual([{ id: "t-pending", from: "feat/pay" }]);
    tree = one.tree;

    const all = planUnassignFromBranch(tree, ["pay", "solo"]);
    expect(all.report.removed.map((r) => r.id).sort()).toEqual(["solo", "t-done", "t-failing", "t-progress"]);
    expect(deliveries(all.tree)).toEqual({});
    expect(planUnassignFromBranch(all.tree, ["pay"]).changed).toBe(false);
  });

  it("refuses unknown refs and product nodes", () => {
    expect(() => planUnassignFromBranch(fixture(), ["nope"])).toThrow(WorkSetError);
    expect(() => planUnassignFromBranch(fixture(), ["cap"])).toThrow(/is a capability/);
  });
});

describe("readWorkSet", () => {
  it("returns the open units on the branch and whether it has any assignment at all", () => {
    const tree = planAssignToBranch(fixture(), ["pay", "solo"], "feat/pay").tree;
    expect(readWorkSet(tree, "feat/pay")).toEqual({ branch: "feat/pay", ids: ["t-pending", "t-progress", "t-failing", "solo"], hasAssignments: true });
    expect(readWorkSet(tree, "feat/none")).toEqual({ branch: "feat/none", ids: [], hasAssignments: false });
  });

  it("still reports assignments when every unit on the branch is finished", () => {
    const tree = planAssignToBranch(fixture(), ["solo"], "feat/solo").tree;
    (tree.changes[1] as { status: string }).status = "completed";
    expect(readWorkSet(tree, "feat/solo")).toEqual({ branch: "feat/solo", ids: [], hasAssignments: true });
  });
});
