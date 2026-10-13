import { describe, it, expect } from "vitest";
import { completedWorkIds, findNextWorkTask } from "../../../src/core/change-next-task.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const change = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "change", touches: ["cap"], ...extra });
const task = (id: string, extra: Record<string, unknown> = {}) => node({ id, type: "task", ...extra });
const tree = (...changes: RuleNode[]): V2Tree => ({ product: [node({ id: "cap", type: "capability" })], changes });

describe("findNextWorkTask", () => {
  it("answers in get_next_task's v1 shape: the projected item, its enclosing changes, an explanation", () => {
    const t = tree(change("outer", { children: [change("inner", { priority: "high", children: [task("t", { acceptanceCriteria: ["works"] })] })] }));
    const next = findNextWorkTask(t);
    expect(next?.unit).toMatchObject({ kind: "task", node: { id: "t" }, change: { id: "inner" } });
    expect(next?.item).toMatchObject({ id: "t", level: "task", status: "pending", type: "task", acceptanceCriteria: ["works"] });
    expect(next?.parents.map((p) => [p.id, p.level])).toEqual([["outer", "epic"], ["inner", "feature"]]);
    expect(next?.explanation).toMatchObject({
      reason: "priority",
      summary: '"t" selected at high priority via outer → inner',
      priority: { itemPriority: "high", higherPriorityBlocked: 0 },
      traversalPath: ["outer", "inner"],
    });
  });

  it("counts the other units the way v1 counts leaves", () => {
    const t = tree(
      change("c", {
        priority: "medium",
        children: [
          task("picked", { status: "in_progress", blockedBy: ["done"] }),
          task("done", { status: "completed" }),
          task("later", { status: "deferred" }),
          task("stuck", { status: "blocked", priority: "critical" }),
          task("waits", { blockedBy: ["nowhere"] }),
          task("other"),
        ],
      }),
    );
    const next = findNextWorkTask(t);
    expect(next?.item.id).toBe("picked");
    expect(next?.explanation).toMatchObject({
      reason: "in_progress",
      dependencies: { status: "resolved", resolvedBlockers: ["done"] },
      priority: { itemPriority: "medium", higherPriorityBlocked: 1 },
      skipped: { completed: 1, deferred: 1, blocked: 1, unresolvedDeps: 1, inProgress: 0, actionable: 1, total: 5 },
    });
  });

  it("passes over excluded ids and filters by the unit's own tags", () => {
    const t = tree(change("a", { tags: ["x"] }), change("b"));
    expect(findNextWorkTask(t, { excludeIds: new Set(["a"]) })?.item.id).toBe("b");
    expect(findNextWorkTask(t, { tags: ["x"] })?.item.id).toBe("a");
    expect(findNextWorkTask(t, { tags: ["y"] })).toBeNull();
  });
});

describe("completedWorkIds", () => {
  it("lists completed change-layer nodes only", () => {
    const t = tree(change("c", { children: [task("done", { status: "completed" }), task("open")] }));
    t.product.push(node({ id: "cap-done", type: "capability", status: "completed" }));
    expect([...completedWorkIds(t)]).toEqual(["done"]);
  });
});
