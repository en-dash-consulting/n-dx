import { describe, it, expect } from "vitest";
import { addChangeNode, AddChangeNodeError } from "../../../src/core/change-add.js";
import { ClosedChangeError } from "../../../src/core/change-completion.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";
import type { Amendment } from "../../../src/schema/v2.js";

const NOW = new Date("2026-10-08T12:00:00.000Z");
const node = (fields: Record<string, unknown>): RuleNode => ({ title: fields.id as string, slug: fields.id as string, ...fields }) as RuleNode;
const tree = (...changes: RuleNode[]): V2Tree => ({
  product: [node({ id: "area", type: "area", children: [node({ id: "cap", type: "capability", statement: "Pay." })] })],
  changes,
});
const withConstraint = (): V2Tree => {
  const t = tree();
  t.product[0].children!.push(node({ id: "rule", type: "constraint", statement: "Keep it safe." }));
  return t;
};
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

  it("refuses an amendment whose criteria delta does not fit the capability", () => {
    const withCriteria = tree();
    withCriteria.product[0].children![0].criteria = [{ id: "c1", text: "Pays" }];
    const add = (criteria: Record<string, unknown>) =>
      addChangeNode(withCriteria, { type: "change", title: "A", amends: [{ target: "cap", delta: "modified", summary: "s", criteria }] }, opts);
    expect(() => add({ remove: ["c7"] })).toThrow(/criterion c7 to remove does not exist/);
    expect(() => add({ add: [{ id: "c1", text: "x" }] })).toThrow(/criterion c1 to add already exists/);
    expect(add({ add: [{ id: "c2", text: "x" }] }).node.id).toBe("new");
  });

  it("judges amendments of one capability in order, as apply does", () => {
    const withCriteria = tree();
    withCriteria.product[0].children![0].criteria = [{ id: "c1", text: "Pays" }];
    const add = (...deltas: Record<string, unknown>[]) =>
      addChangeNode(withCriteria, { type: "change", title: "A", amends: deltas.map((criteria) => ({ target: "cap", delta: "modified" as const, summary: "s", criteria })) }, opts);
    const c2 = { add: [{ id: "c2", text: "x" }] };
    expect(() => add(c2, c2)).toThrow(/criterion c2 to add already exists/);
    expect(add(c2, { remove: ["c2"] }).node.id).toBe("new");
  });

  const applyRefusals: [string, Amendment[], RegExp][] = [
    ["a criteria delta on a constraint", [{ target: "rule", delta: "modified", summary: "s", criteria: { add: [{ id: "c1", text: "x" }] } }], /amendment 1 \(modified rule\): a constraint has no criteria/],
    ["replace on a capability the change adds", [{ target: "new-cap", delta: "added", summary: "s", under: "area", title: "New", proposed: "P.", criteria: { replace: [{ id: "c1", text: "x" }] } }], /amendment 1 \(added new-cap\): a new capability has no criteria to replace or remove/],
    ["remove on a capability the change adds", [{ target: "new-cap", delta: "added", summary: "s", under: "area", title: "New", proposed: "P.", criteria: { remove: ["c1"] } }], /a new capability has no criteria to replace or remove/],
    ["criteria on a constraint the change adds", [{ target: "new-rule", delta: "added", type: "constraint", summary: "s", under: "area", title: "Rule", proposed: "P.", criteria: { add: [{ id: "c1", text: "x" }] } }], /amendment 1 \(added new-rule\): a constraint has no criteria; state it in proposed/],
  ];

  it.each(applyRefusals)("refuses %s with apply's problem, writing nothing", (_label, amends, message) => {
    const input = withConstraint();
    const before = structuredClone(input);
    expect(() => addChangeNode(input, { type: "change", title: "A", amends }, opts)).toThrow(AddChangeNodeError);
    expect(() => addChangeNode(input, { type: "change", title: "A", amends }, opts)).toThrow(message);
    expect(input).toEqual(before);
  });

  it("accepts what apply accepts, and never stamps the tree", () => {
    const input = withConstraint();
    const before = structuredClone(input);
    const amends: Amendment[] = [
      { target: "new-cap", delta: "added", summary: "s", under: "area", title: "New", proposed: "P.", criteria: { add: [{ id: "c1", text: "x" }] } },
      { target: "rule", delta: "modified", summary: "s", proposed: "Stricter." },
    ];
    const { tree: next, node: added } = addChangeNode(input, { type: "change", title: "A", amends }, opts);
    expect(added).not.toHaveProperty("appliedAt");
    expect(next.product).toEqual(before.product);
    expect(input).toEqual(before);
  });

  it("does not refuse a stale base: that is apply's to judge, with force available", () => {
    const amends = [{ target: "cap", delta: "modified" as const, summary: "s", proposed: "Pay more.", base: "stale" }];
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

  it("nests a change under an open change", () => {
    const { tree: next } = addChangeNode(tree(open()), { type: "change", title: "Child", parentId: "ch" }, opts);
    expect(next.changes[0].children?.[0]).toMatchObject({ id: "new", type: "change" });
  });

  it.each([
    ["completed", { status: "completed" }],
    ["applied", { status: "completed", appliedAt: "2026-10-01T00:00:00.000Z" }],
    ["cancelled", { status: "cancelled" }],
    ["deleted", { status: "deleted" }],
  ])("refuses a change under a %s change, suggesting a follow-up", (state, extra) => {
    let error: unknown;
    try {
      addChangeNode(tree(open(extra)), { type: "change", title: "Late", parentId: "ch" }, opts);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ClosedChangeError);
    expect((error as ClosedChangeError).state).toBe(state);
    expect((error as Error).message).toMatch(/follow-up change.*discoveredFrom/);
  });

  it("refuses a subtask under a task of a closed change, but not of an open one", () => {
    const task = node({ id: "t", type: "task" });
    expect(() => addChangeNode(tree(open({ status: "completed", children: [task] })), { type: "subtask", title: "S", parentId: "t" }, opts)).toThrow(ClosedChangeError);
    const inner = node({ id: "in", type: "change", touches: ["cap"], status: "cancelled", children: [node({ id: "t2", type: "task" })] });
    expect(() => addChangeNode(tree(open({ children: [inner] })), { type: "subtask", title: "S", parentId: "t2" }, opts)).toThrow(ClosedChangeError);
  });
});
