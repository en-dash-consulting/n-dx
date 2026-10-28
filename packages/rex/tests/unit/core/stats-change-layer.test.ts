import { describe, expect, it } from "vitest";
import { computeStats } from "../../../src/core/stats.js";
import { computeEpicStats } from "../../../src/core/analytics.js";
import { changeLayerItems } from "../../../src/core/layer-projection.js";
import type { PRDItem } from "../../../src/schema/index.js";
import type { RuleNode } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode =>
  ({ slug: String(fields.id), title: String(fields.id), ...fields }) as unknown as RuleNode;

/** A pending task-less change, a change with tasks, and a completed task-less change. */
const v2Items = (): PRDItem[] =>
  changeLayerItems([
    node({ id: "bare", type: "change", status: "pending" }),
    node({
      id: "withTasks",
      type: "change",
      status: "in_progress",
      children: [
        node({ id: "t1", type: "task", status: "completed" }),
        node({ id: "t2", type: "task", status: "pending" }),
      ],
    }),
    node({ id: "done", type: "change", status: "completed" }),
    node({ id: "gone", type: "change", status: "pending", children: [node({ id: "t3", type: "task", status: "deleted" })] }),
  ]);

describe("stats over a projected v2 change layer", () => {
  it("counts a change with no live tasks as one unit of work, and a change with tasks by its tasks", () => {
    const stats = computeStats(v2Items());
    expect(stats).toMatchObject({ total: 5, completed: 2, pending: 3, inProgress: 0, deleted: 1 });
  });

  it("gives a task-less change its own status rather than 0/0", () => {
    const byId = Object.fromEntries(computeEpicStats(v2Items()).map((e) => [e.id, e]));
    expect(byId.bare).toMatchObject({ type: "change", selfCounted: true, percentComplete: 0 });
    expect(byId.bare.stats).toMatchObject({ total: 1, pending: 1 });
    expect(byId.done).toMatchObject({ selfCounted: true, percentComplete: 100 });
    expect(byId.done.stats).toMatchObject({ total: 1, completed: 1 });
    expect(byId.withTasks).toMatchObject({ type: "change", percentComplete: 50 });
    expect(byId.withTasks.selfCounted).toBeUndefined();
    expect(byId.withTasks.stats).toMatchObject({ total: 2, completed: 1 });
  });

  it("leaves v1 epics as pure groupings", () => {
    const v1: PRDItem[] = [
      { id: "e1", title: "E", level: "epic", status: "pending" } as PRDItem,
      { id: "e2", title: "E2", level: "epic", status: "pending", children: [
        { id: "f1", title: "F", level: "feature", status: "completed" } as PRDItem,
      ] } as PRDItem,
    ];
    expect(computeStats(v1)).toMatchObject({ total: 1, completed: 1 });
    const [e1] = computeEpicStats(v1);
    expect(e1.stats.total).toBe(0);
    expect(e1).not.toHaveProperty("type");
    expect(e1).not.toHaveProperty("selfCounted");
    expect(e1).not.toHaveProperty("tags");
    expect(e1).not.toHaveProperty("assignees");
  });

  it("carries the item's tags and every assignee under it, its own first", () => {
    const v1 = [{
      id: "e1", title: "E", level: "epic", status: "pending", tags: ["web"], assignee: "Ada <a@x>",
      children: [
        { id: "t1", title: "T1", level: "task", status: "pending", assignee: "Bo <b@x>" },
        { id: "t2", title: "T2", level: "task", status: "pending", assignee: "Ada <a@x>",
          children: [{ id: "s1", title: "S1", level: "subtask", status: "pending", assignee: "Cy <c@x>" }] },
      ],
    }] as PRDItem[];
    const [e1] = computeEpicStats(v1);
    expect(e1.tags).toEqual(["web"]);
    expect(e1.assignees).toEqual(["Ada <a@x>", "Bo <b@x>", "Cy <c@x>"]);
  });
});
