import { describe, it, expect } from "vitest";
import { addChangeNode, AddChangeNodeError } from "../../../src/core/change-add.js";
import { ClosedChangeError } from "../../../src/core/change-completion.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const tree = (...changes: RuleNode[]): V2Tree => ({
  product: [node({ id: "area", type: "area", children: [node({ id: "cap", type: "capability", statement: "Pay." })] })],
  changes,
});
const open = (extra: Record<string, unknown> = {}) => node({ id: "ch", type: "change", touches: ["cap"], ...extra });
const opts = { now: NOW, newId: () => "new" };

describe("addChangeNode", () => {
  it("puts an untargeted change in the Inbox at the change-layer root", () => {
    const input = tree();
    const { tree: next, node: added } = addChangeNode(input, { type: "change", title: "Fix it", description: "Why", acceptanceCriteria: ["Done"] }, opts);
    expect(added).toMatchObject({ id: "new", type: "change", slug: "fix-it", intent: "Why", acceptanceCriteria: ["Done"], needsPlacement: true });
    expect(next.changes.map((c) => c.id)).toEqual(["new"]);
    expect(input.changes).toEqual([]);
  });

  it("places a change that amends or touches a product node", () => {
    const touched = addChangeNode(tree(), { type: "change", title: "T", touches: ["cap"] }, opts).node;
    expect(touched.needsPlacement).toBeUndefined();
    const amends = [{ target: "cap", delta: "modified" as const, summary: "s", proposed: "Pay more." }];
    expect(addChangeNode(tree(), { type: "change", title: "A", amends }, opts).node).toMatchObject({ amends });
  });

  it("refuses a change whose target does not resolve", () => {
    expect(() => addChangeNode(tree(), { type: "change", title: "T", touches: ["nope"] }, opts)).toThrow(/nope/);
  });

  it("adds a task through addTask, refusing a closed change", () => {
    const { node: added } = addChangeNode(tree(open()), { type: "task", title: "Do", parentId: "ch", priority: "high" }, opts);
    expect(added).toMatchObject({ type: "task", priority: "high" });
    expect(() => addChangeNode(tree(open({ status: "completed" })), { type: "task", title: "Do", parentId: "ch" }, opts)).toThrow(ClosedChangeError);
  });

  it("adds a subtask under a task only", () => {
    const withTask = tree(open({ children: [node({ id: "t", type: "task" })] }));
    expect(addChangeNode(withTask, { type: "subtask", title: "Sub", parentId: "t" }, opts).tree.changes[0].children?.[0].children?.[0]).toMatchObject({ id: "new", type: "subtask" });
    expect(() => addChangeNode(withTask, { type: "subtask", title: "Sub", parentId: "ch" }, opts)).toThrow(/No live task "ch"/);
  });

  it("refuses fields the type does not carry, and a missing parent", () => {
    expect(() => addChangeNode(tree(open()), { type: "task", title: "T", parentId: "ch", touches: ["cap"] }, opts)).toThrow(/does not carry touches/);
    expect(() => addChangeNode(tree(), { type: "task", title: "T" }, opts)).toThrow(AddChangeNodeError);
  });

  it("refuses an unresolved blockedBy", () => {
    expect(() => addChangeNode(tree(), { type: "change", title: "T", blockedBy: ["ghost"] }, opts)).toThrow(/ghost/);
  });
});
