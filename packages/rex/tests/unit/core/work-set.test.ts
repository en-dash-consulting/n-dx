import { describe, it, expect } from "vitest";
import type { V2Tree } from "../../../src/schema/v2-rules.js";
import { effectiveDelivery, planAssignToBranch, planUnassignFromBranch, readWorkSet, WorkSetError } from "../../../src/core/work-set.js";

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

describe("planAssignToBranch: units selection cannot pick", () => {
  const withInbox = (product: unknown[]): V2Tree => {
    const tree = fixture();
    (tree as unknown as { product: unknown[] }).product = product;
    (tree.changes as unknown[]).push(node("loose", { type: "change", status: "pending", needsPlacement: true, children: [task("t-loose")] }));
    return tree;
  };

  it("refuses a change awaiting placement in the Inbox, and a task inside one, saying to place it first", () => {
    for (const ref of ["loose", "t-loose"]) {
      expect(() => planAssignToBranch(withInbox(fixture().product), [ref], "feat/x")).toThrow(
        `Change "loose" (loose) is in the Inbox awaiting placement, and selection never picks it: place it first ('rex change place loose' or MCP place_change), then assign it`,
      );
    }
  });

  it("accepts an Inbox change on a product layer with nothing to place it on", () => {
    expect(planAssignToBranch(withInbox([]), ["loose"], "feat/x").report.assigned).toEqual(["t-loose"]);
  });

  it("warns, without refusing, when a unit waits on an unfinished item outside the set", () => {
    const tree = fixture();
    const pay = tree.changes[0] as unknown as { children: Record<string, unknown>[] };
    pay.children[0].blockedBy = ["t-outer", "t-done", "t-progress", "gone"];
    const plan = planAssignToBranch(tree, ["t-pending", "t-progress"], "feat/x");
    expect(plan.report.assigned).toEqual(["t-pending", "t-progress"]);
    expect(plan.report.warnings).toEqual([
      `"t-pending" (t-pending) is blocked by "t-outer" (t-outer) (pending), which is not in this branch's work set: it cannot be picked until that is done or assigned here`,
      `"t-pending" (t-pending) is blocked by "gone", which names nothing in the PRD: it cannot be picked until that ref is removed`,
    ]);
  });
});

describe("planAssignToBranch", () => {
  it("assigning a change writes every open task under it, never completed, deferred or deleted ones, nor the change", () => {
    const tree = fixture();
    const before = structuredClone(tree);
    const plan = planAssignToBranch(tree, ["pay"], "feat/pay");

    expect(plan.report).toEqual({ branch: "feat/pay", assigned: ["t-pending", "t-progress", "t-failing"], moved: [], unchanged: [], warnings: [] });
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
    expect(plan.report).toEqual({ branch: "feat/pay", assigned: [], moved: [], unchanged: ["t-pending", "t-progress", "t-failing"], warnings: [] });
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
    expect(readWorkSet(tree, "feat/pay")).toEqual({ branch: "feat/pay", ids: ["t-pending", "t-progress", "t-failing", "solo"], hasAssignments: true, earlier: [] });
    expect(readWorkSet(tree, "feat/none")).toEqual({ branch: "feat/none", ids: [], hasAssignments: false, earlier: [] });
  });

  it("still reports assignments when every unit on the branch is finished", () => {
    const tree = planAssignToBranch(fixture(), ["solo"], "feat/solo").tree;
    (tree.changes[1] as { status: string }).status = "completed";
    expect(readWorkSet(tree, "feat/solo")).toEqual({ branch: "feat/solo", ids: [], hasAssignments: true, earlier: [] });
  });

  it("leaves rows from an earlier use of the name, and the units inheriting from them, out of the set", () => {
    const tree = splitSolo(task("s1"), task("s2", { delivery: { branch: "feat/solo" } }));
    // `solo` already named feat/solo where the branch left the default branch; s2 is this branch's own.
    expect(readWorkSet(tree, "feat/solo", new Set(["solo"]))).toEqual({ branch: "feat/solo", ids: ["s2"], hasAssignments: true, earlier: ["s1"] });
    expect(readWorkSet(tree, "feat/solo", new Set(["solo", "s2"]))).toEqual({ branch: "feat/solo", ids: [], hasAssignments: false, earlier: ["s1", "s2"] });
  });
});

describe("planAssignToBranch: units an earlier branch of the name left", () => {
  const earlier = (...ids: string[]) => ({ ids: new Set(ids), since: "fork1" });

  it("adopts a unit whose own row is earlier, writing since, instead of reporting it already on the branch", () => {
    const tree = fixture();
    (tree.changes[0].children![0] as { delivery?: unknown }).delivery = { branch: "feat/x" };
    const plan = planAssignToBranch(tree, ["t-pending"], "feat/x", { earlier: earlier("t-pending") });
    expect(plan.report).toMatchObject({ assigned: ["t-pending"], moved: [], unchanged: [] });
    expect(plan.changed).toBe(true);
    expect(deliveries(plan.tree)).toEqual({ "t-pending": { branch: "feat/x", since: "fork1" } });
    // Without the earlier rows, the same row is this branch's own.
    expect(planAssignToBranch(tree, ["t-pending"], "feat/x").report.unchanged).toEqual(["t-pending"]);
  });

  it("gives a task inheriting from an earlier change its own delivery", () => {
    const tree = splitSolo(task("s1"), task("s2"));
    const plan = planAssignToBranch(tree, ["s1"], "feat/solo", { earlier: earlier("solo") });
    expect(deliveries(plan.tree)).toEqual({ solo: { branch: "feat/solo" }, s1: { branch: "feat/solo", since: "fork1" } });
    expect(readWorkSet(plan.tree, "feat/solo", new Set(["solo"]))).toMatchObject({ ids: ["s1"], hasAssignments: true, earlier: ["s2"] });
  });

  it("adopting a change takes its own delivery too, so a task added later follows it", () => {
    const plan = planAssignToBranch(splitSolo(task("s1")), ["solo"], "feat/solo", { earlier: earlier("solo") });
    expect(plan.report.assigned).toEqual(["s1", "solo"]);
    expect(deliveries(plan.tree)).toMatchObject({ solo: { branch: "feat/solo", since: "fork1" } });
  });

  it("writes since for a unit whose own fork-point row named the branch, even after it was taken off or moved", () => {
    // Removed since: no delivery now, but its fork-point row is earlier.
    expect(deliveries(planAssignToBranch(fixture(), ["t-pending"], "feat/x", { earlier: earlier("t-pending") }).tree)).toEqual({
      "t-pending": { branch: "feat/x", since: "fork1" },
    });
    // Moved to another branch and back.
    const tree = fixture();
    (tree.changes[0].children![0] as { delivery?: unknown }).delivery = { branch: "feat/other" };
    expect(deliveries(planAssignToBranch(tree, ["t-pending"], "feat/x", { move: true, earlier: earlier("t-pending") }).tree)).toEqual({
      "t-pending": { branch: "feat/x", since: "fork1" },
    });
  });

  it("a move drops a since left from an earlier adoption", () => {
    const tree = fixture();
    (tree.changes[1] as { delivery?: unknown }).delivery = { branch: "feat/old", since: "fork0" };
    expect(deliveries(planAssignToBranch(tree, ["solo"], "feat/x", { move: true }).tree)).toEqual({ solo: { branch: "feat/x" } });
  });
});

/** `solo` assigned to feat/solo while task-less, then split into tasks. */
function splitSolo(...tasks: ReturnType<typeof task>[]): V2Tree {
  const tree = planAssignToBranch(fixture(), ["solo"], "feat/solo").tree;
  (tree.changes[1] as { children?: unknown[] }).children = tasks;
  return tree;
}

describe("inherited delivery", () => {
  it("a task-less change's branch covers the open tasks it is split into", () => {
    const tree = splitSolo(task("s1"), task("s2", { status: "failing" }), task("s-done", { status: "completed" }));
    expect(readWorkSet(tree, "feat/solo")).toEqual({ branch: "feat/solo", ids: ["s1", "s2"], hasAssignments: true, earlier: [] });
    expect(effectiveDelivery(tree, "s1")).toMatchObject({ branch: "feat/solo", owner: { id: "solo" } });
  });

  it("a task's own delivery overrides its change's", () => {
    const tree = splitSolo(task("s1"), task("s2", { delivery: { branch: "feat/other" } }));
    expect(readWorkSet(tree, "feat/solo").ids).toEqual(["s1"]);
    expect(readWorkSet(tree, "feat/other")).toEqual({ branch: "feat/other", ids: ["s2"], hasAssignments: true, earlier: [] });
    expect(effectiveDelivery(tree, "s2")).toMatchObject({ branch: "feat/other", owner: { id: "s2" } });
  });

  it("inherits from the nearest enclosing change", () => {
    const tree = fixture();
    const outer = tree.changes[2] as unknown as { delivery: unknown; children: Array<{ delivery?: unknown }> };
    outer.delivery = { branch: "feat/outer" };
    outer.children[1].delivery = { branch: "feat/inner" };
    expect(readWorkSet(tree, "feat/outer").ids).toEqual(["t-outer"]);
    expect(readWorkSet(tree, "feat/inner").ids).toEqual(["t-inner"]);
  });

  it("treats an inherited task as already on the branch, and refuses another branch naming the change", () => {
    const tree = splitSolo(task("s1"));
    expect(planAssignToBranch(tree, ["s1"], "feat/solo").report.unchanged).toEqual(["s1"]);
    expect(planAssignToBranch(tree, ["solo"], "feat/solo").changed).toBe(false);
    expect(() => planAssignToBranch(tree, ["s1"], "feat/x")).toThrow(/"s1".*on branch "feat\/solo" through change "solo" \(solo\); pass move/);
  });

  it("move gives the inherited task its own delivery", () => {
    const plan = planAssignToBranch(splitSolo(task("s1"), task("s2")), ["s1"], "feat/x", { move: true });
    expect(plan.report.moved).toEqual([{ id: "s1", from: "feat/solo" }]);
    expect(deliveries(plan.tree)).toEqual({ solo: { branch: "feat/solo" }, s1: { branch: "feat/x" } });
    expect(readWorkSet(plan.tree, "feat/solo").ids).toEqual(["s2"]);
    expect(readWorkSet(plan.tree, "feat/x").ids).toEqual(["s1"]);
  });

  it("moving the change moves its own delivery, so a task added later follows it", () => {
    const plan = planAssignToBranch(splitSolo(task("s1")), ["solo"], "feat/x", { move: true });
    expect(plan.report.moved).toEqual([{ id: "s1", from: "feat/solo" }, { id: "solo", from: "feat/solo" }]);
    expect(deliveries(plan.tree)).toEqual({ solo: { branch: "feat/x" }, s1: { branch: "feat/x" } });
    (plan.tree.changes[1] as { children: unknown[] }).children.push(task("s-later"));
    expect(readWorkSet(plan.tree, "feat/x").ids).toEqual(["s1", "s-later"]);
    expect(readWorkSet(plan.tree, "feat/solo")).toEqual({ branch: "feat/solo", ids: [], hasAssignments: false, earlier: [] });
  });

  it("removing the change drops the inherited tasks and every task delivery equal to it", () => {
    const tree = splitSolo(task("s1"), task("s2", { delivery: { branch: "feat/solo" } }), task("s3", { delivery: { branch: "feat/other" } }));
    const plan = planUnassignFromBranch(tree, ["solo"], "feat/solo");
    expect(plan.report).toEqual({ removed: [{ id: "solo", from: "feat/solo" }, { id: "s2", from: "feat/solo" }], inherited: [] });
    expect(readWorkSet(plan.tree, "feat/solo")).toEqual({ branch: "feat/solo", ids: [], hasAssignments: false, earlier: [] });
    expect(readWorkSet(plan.tree, "feat/other").ids).toEqual(["s3"]);
  });

  it("removing a task that only inherits writes nothing and names the change", () => {
    const tree = splitSolo(task("s1"));
    const plan = planUnassignFromBranch(tree, ["s1"], "feat/solo");
    expect(plan.changed).toBe(false);
    expect(plan.tree).toEqual(tree);
    expect(plan.report).toEqual({ removed: [], inherited: [{ id: "s1", from: "feat/solo", change: "solo" }] });
    // Inheriting another branch is not this branch's to report; named beside its change, it drops out.
    expect(planUnassignFromBranch(tree, ["s1"], "feat/x").report.inherited).toEqual([]);
    expect(planUnassignFromBranch(tree, ["s1", "solo"], "feat/solo").report.inherited).toEqual([]);
  });
});
