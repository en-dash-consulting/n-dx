import { describe, expect, it } from "vitest";
import { changeLayerFromItems, changeLayerItems, productLayerItems } from "../../../src/core/layer-projection.js";
import { draftProductReshape } from "../../../src/core/product-reshape.js";
import { nodeSpecHash } from "../../../src/core/apply-amendments.js";
import type { RuleNode } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ slug: String(fields.id), title: String(fields.id), ...fields }) as unknown as RuleNode;

const changes = (): RuleNode[] => [
  node({
    id: "ch1",
    type: "change",
    intent: "Why",
    status: "in_progress",
    amends: [{ target: "cap1", delta: "modified", summary: "s", proposed: "p" }],
    children: [node({ id: "t1", type: "task", description: "Do it", children: [node({ id: "s1", type: "subtask" })] })],
  }),
  node({ id: "ch2", type: "change", status: "deleted" }),
];

describe("change layer projection", () => {
  it("reads a change's intent as description, levels by nesting, tombstones included", () => {
    const [ch1, ch2] = changeLayerItems(changes());
    expect(ch1).toMatchObject({ id: "ch1", level: "epic", description: "Why" });
    expect(ch1).not.toHaveProperty("intent");
    expect(ch1.children?.[0]).toMatchObject({ level: "task", description: "Do it" });
    expect(ch1.children?.[0].children?.[0].level).toBe("subtask");
    expect(ch2.status).toBe("deleted");
  });

  it("maps unedited items back to the same nodes, removing nothing", () => {
    const before = changes();
    const { changes: after, removed } = changeLayerFromItems(changeLayerItems(before), before);
    expect(removed.size).toBe(0);
    expect(after).toEqual(before);
  });

  it("types and slugs a created item from its level and reports dropped ids", () => {
    const before = changes();
    const items = changeLayerItems(before);
    items[0].children = [{ id: "t2", title: "Wire it", level: "task", status: "pending", description: "New" }];
    const { changes: after, removed } = changeLayerFromItems(items, before);
    expect(after[0].children?.[0]).toMatchObject({ id: "t2", type: "task", slug: "wire-it", description: "New" });
    expect(after[0].children?.[0]).not.toHaveProperty("level");
    expect([...removed].sort()).toEqual(["s1", "t1"]);
  });
});

const capability = (id: string, extra: Record<string, unknown> = {}) =>
  node({ id, type: "capability", statement: `${id} works`, criteria: [{ id: "c1", text: `${id} c1` }], ...extra });

const product = (): RuleNode[] => [
  node({ id: "area1", type: "area", children: [capability("cap1"), capability("cap2"), capability("cap3", { status: "deleted" })] }),
  node({ id: "area2", type: "area" }),
];

describe("product layer projection", () => {
  it("projects live nodes with statement and capability criteria, read only", () => {
    const [area1] = productLayerItems(product());
    expect(area1.level).toBe("epic");
    expect(area1.children?.map((c) => c.id)).toEqual(["cap1", "cap2"]);
    expect(area1.children?.[0]).toMatchObject({ level: "feature", description: "cap1 works", acceptanceCriteria: ["cap1 c1"] });
  });
});

describe("draftProductReshape", () => {
  const ids = () => {
    let n = 0;
    return () => `new-${++n}`;
  };

  it("drafts a merge as removed for the merged node and modified for the survivor's capability criteria", () => {
    const tree = product();
    const draft = draftProductReshape(tree, [{ id: "p", action: { action: "merge", survivorId: "cap1", mergedIds: ["cap2"], reason: "Same" } }]);
    expect(draft.amends).toEqual([
      { target: "cap2", delta: "removed", summary: "Same", base: nodeSpecHash(tree[0].children![1]) },
      { target: "cap1", delta: "modified", summary: "Same", criteria: { add: [{ id: "c2", text: "cap2 c1" }] }, base: nodeSpecHash(tree[0].children![0]) },
    ]);
  });

  it("drafts a split as removed plus one added per piece under the same parent", () => {
    const draft = draftProductReshape(
      product(),
      [{ id: "p", action: { action: "split", sourceId: "cap1", reason: "Two things", children: [{ title: "A", description: "a", acceptanceCriteria: ["x"], level: "feature" }, { title: "B", level: "feature" }] } }],
      { newId: ids() },
    );
    expect(draft.amends.map((a) => [a.delta, a.target, a.under, a.title])).toEqual([
      ["removed", "cap1", undefined, undefined],
      ["added", "new-1", "area1", "A"],
      ["added", "new-2", "area1", "B"],
    ]);
    expect(draft.amends[1]).toMatchObject({ proposed: "a", criteria: { add: [{ id: "c1", text: "x" }] } });
  });

  it("drafts an update of capability criteria as an upsert delta, and skips a title-only update", () => {
    const draft = draftProductReshape(product(), [
      { id: "p1", action: { action: "update", itemId: "cap1", updates: { acceptanceCriteria: ["first", "second"] }, reason: "r" } },
      { id: "p2", action: { action: "update", itemId: "cap2", updates: { title: "Renamed" }, reason: "r" } },
    ]);
    expect(draft.amends[0].criteria).toEqual({ add: [{ id: "c2", text: "second" }], replace: [{ id: "c1", text: "first" }] });
    expect(draft.skipped).toEqual([{ proposalId: "p2", reason: expect.stringMatching(/not an amendment; use rex product edit/) }]);
  });

  it("skips proposals on retired or change-layer nodes, and a second amendment of one node", () => {
    const draft = draftProductReshape(product(), [
      { id: "p1", action: { action: "obsolete", itemId: "cap3", reason: "r" } },
      { id: "p2", action: { action: "obsolete", itemId: "cap1", reason: "r" } },
      { id: "p3", action: { action: "reparent", itemId: "cap1", newParentId: "area2", reason: "r" } },
    ]);
    expect(draft.drafted).toEqual(["p2"]);
    expect(draft.skipped.map((s) => s.proposalId)).toEqual(["p1", "p3"]);
    expect(draft.skipped[1].reason).toMatch(/already amends cap1/);
  });
});
