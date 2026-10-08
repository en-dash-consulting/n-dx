import { describe, it, expect } from "vitest";
import { compareReleases, findActionableWork, findNextWork, resolveWorkById } from "../../../src/core/change-selection.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const change = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "change", touches: ["cap"], ...extra });
const task = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "task", ...extra });
const tree = (...changes: RuleNode[]): V2Tree => ({ product: [node({ id: "cap", type: "capability" })], changes });
const ids = (t: V2Tree, options = {}) => findActionableWork(t, options).map((u) => u.node.id);

describe("findNextWork", () => {
  it("selects a task-less change as the unit of work", () => {
    const next = findNextWork(tree(change("solo")));
    expect(next).toMatchObject({ kind: "change", node: { id: "solo" }, change: { id: "solo" } });
  });

  it("selects a change's tasks, never the change while it has any", () => {
    expect(ids(tree(change("c", { children: [task("t1"), task("t2", { status: "completed" })] })))).toEqual(["t1"]);
    expect(ids(tree(change("c", { children: [task("t", { status: "completed" })] })))).toEqual([]);
  });

  it("treats a change whose only tasks are deleted as task-less", () => {
    expect(ids(tree(change("c", { children: [task("t", { status: "deleted" })] })))).toEqual(["c"]);
  });

  it("returns null when nothing is actionable", () => {
    expect(findNextWork(tree())).toBeNull();
  });
});

describe("needsPlacement", () => {
  const inbox = tree(change("inbox", { needsPlacement: true, children: [task("inbox-task")] }), change("inbox-solo", { needsPlacement: true }));

  it("blocks autonomous selection of the change and its tasks", () => {
    expect(ids(inbox)).toEqual([]);
  });

  it("is runnable by id", () => {
    expect(resolveWorkById(inbox, "inbox-task")).toMatchObject({ kind: "task", node: { id: "inbox-task" }, change: { id: "inbox" } });
    expect(resolveWorkById(inbox, "inbox-solo")).toMatchObject({ kind: "change", node: { id: "inbox-solo" } });
  });
});

describe("resolveWorkById", () => {
  it("resolves aliases and display ids, and refuses non-work refs", () => {
    const t = tree(change("c", { displayId: "CH-1", children: [task("t", { aliases: ["old-t"], children: [node({ id: "s", type: "subtask" })] })] }));
    expect(resolveWorkById(t, "CH-1")?.node.id).toBe("c");
    expect(resolveWorkById(t, "old-t")?.node.id).toBe("t");
    expect(resolveWorkById(t, "s")).toBeNull();
    expect(resolveWorkById(t, "cap")).toBeNull();
    expect(resolveWorkById(t, "missing")).toBeNull();
  });
});

describe("gates", () => {
  it("skips closed, applied and blocked work", () => {
    const t = tree(
      change("done", { status: "completed" }),
      change("deferred", { status: "deferred" }),
      change("cancelled", { status: "cancelled" }),
      change("applied", { appliedAt: "2026-10-01T00:00:00.000Z" }),
      change("waits", { blockedBy: ["open"] }),
      change("open", { priority: "low" }),
      change("deferred-parent", { status: "deferred", children: [task("orphan")] }),
      change("c", { children: [task("blocked", { status: "blocked" }), task("waits-task", { blockedBy: ["open"] })] }),
    );
    expect(ids(t)).toEqual(["open"]);
  });

  it("treats a blocker as resolved once it completes, by any ref", () => {
    const t = tree(change("dep", { status: "completed", displayId: "CH-9" }), change("waits", { blockedBy: ["CH-9"] }));
    expect(ids(t)).toEqual(["waits"]);
  });

  it("keeps an unresolvable blocker open", () => {
    expect(ids(tree(change("waits", { blockedBy: ["nowhere"] })))).toEqual([]);
  });
});

describe("ordering", () => {
  it("follows priority, then nearest plannedRelease", () => {
    const t = tree(
      change("later-high", { priority: "high", plannedRelease: "1.2.0" }),
      change("unplanned-high", { priority: "high" }),
      change("sooner-high", { priority: "high", plannedRelease: "1.1.0-rc.1" }),
      change("sooner-low", { priority: "low", plannedRelease: "0.9.0" }),
      change("critical", { priority: "critical", plannedRelease: "9.0.0" }),
    );
    expect(ids(t)).toEqual(["critical", "sooner-high", "later-high", "unplanned-high", "sooner-low"]);
  });

  it("gives a task its change's priority and release unless it sets its own priority", () => {
    const t = tree(
      change("late", { priority: "high", plannedRelease: "2.0.0", children: [task("inherits"), task("own-low", { priority: "low" })] }),
      change("soon", { priority: "high", plannedRelease: "1.0.0", children: [task("soon-task")] }),
    );
    expect(ids(t)).toEqual(["soon-task", "inherits", "own-low"]);
  });

  it("then puts work others wait on first, then tree order", () => {
    const t = tree(change("c", { children: [task("a"), task("b"), task("c2", { blockedBy: ["b"] })] }));
    expect(ids(t)).toEqual(["b", "a"]);
  });

  it("finishes started work first", () => {
    const t = tree(change("new", { priority: "critical" }), change("started", { status: "in_progress", priority: "low" }), change("retry", { status: "failing", priority: "low" }));
    expect(ids(t)).toEqual(["retry", "started", "new"]);
  });
});

describe("opt-in filters", () => {
  const t = tree(
    change("c", { ready: true, assignee: "Ann <a@x>", children: [task("inherits"), task("not-ready", { ready: false, assignee: "Bob <b@x>" })] }),
    change("unready", {}),
  );

  it("ignores ready and assignee unless asked", () => {
    expect(ids(t)).toEqual(["inherits", "not-ready", "unready"]);
  });

  it("readyOnly keeps ready units, a task inheriting its change's flag", () => {
    expect(ids(t, { readyOnly: true })).toEqual(["inherits"]);
  });

  it("assignee matches the unit or its change", () => {
    expect(ids(t, { assignee: "Ann <a@x>" })).toEqual(["inherits", "not-ready"]);
    expect(ids(t, { assignee: "Bob <b@x>" })).toEqual(["not-ready"]);
  });

  it("excludeIds passes over claimed units", () => {
    expect(ids(t, { excludeIds: new Set(["inherits"]) })).toEqual(["not-ready", "unready"]);
  });
});

describe("compareReleases", () => {
  it("orders numerically, prerelease first, absent last", () => {
    const sorted = ["1.10.0", undefined, "v1.2.0", "1.2.0-rc.1", "@n-dx/core@0.9.0", "1.2"].sort(compareReleases);
    expect(sorted).toEqual(["@n-dx/core@0.9.0", "1.2", "1.2.0-rc.1", "v1.2.0", "1.10.0", undefined]);
  });
});
