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

  it("skips a merge of a capability whose requirements, dependsOn, tags or body the survivor would not carry", () => {
    const requirement = { id: "r1", title: "Suite passes", category: "quality", validationType: "automated", acceptanceCriteria: ["green"] };
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ requirements: [requirement] }, /cap2 has requirements, which a merge would drop/],
      [{ dependsOn: ["cap3"] }, /cap2 has dependsOn, which a merge would drop/],
      [{ tags: ["checkout"] }, /cap2 has tags, which a merge would drop/],
      [{ body: "Raised by support.\n\n## History\n\n- 2026-10-01 CH1 added: s" }, /cap2 has notes outside History in its body, which a merge would drop/],
    ];
    for (const [extra, reason] of cases) {
      const tree: RuleNode[] = [node({ id: "area1", type: "area", children: [capability("cap1"), capability("cap2", extra), capability("cap3")] })];
      const draft = draftProductReshape(tree, [{ id: "p", action: { action: "merge", survivorId: "cap1", mergedIds: ["cap2"], reason: "r" } }]);
      expect(draft.amends).toEqual([]);
      expect(draft.skipped).toEqual([{ proposalId: "p", reason: expect.stringMatching(reason) }]);
      expect(draft.skipped[0].reason).toMatch(/no amendment carries it to the survivor yet$/);
    }
  });

  it("skips a merge of a node another live node names in dependsOn or appliesTo, the survivor included", () => {
    const tree: RuleNode[] = [
      node({
        id: "area1",
        type: "area",
        children: [
          capability("cap1", { dependsOn: ["cap4"] }),
          capability("cap2", { displayId: "A1.2" }),
          capability("cap3", { dependsOn: ["A1.2"] }),
          capability("cap4"),
          capability("cap5"),
          node({ id: "con1", type: "constraint", statement: "s", appliesTo: ["cap5"] }),
        ],
      }),
    ];
    const merge = (id: string, mergedId: string) => ({ id, action: { action: "merge" as const, survivorId: "cap1", mergedIds: [mergedId], reason: "r" } });
    const draft = draftProductReshape(tree, [merge("p1", "cap2"), merge("p2", "cap4"), merge("p3", "cap5")]);
    expect(draft.amends).toEqual([]);
    expect(draft.skipped).toEqual([
      { proposalId: "p1", reason: expect.stringMatching(/cap3 names A1\.2, which a merge would leave pointing at a retired node/) },
      { proposalId: "p2", reason: expect.stringMatching(/cap1 names cap4/) },
      { proposalId: "p3", reason: expect.stringMatching(/con1 names cap5/) },
    ]);
  });

  it("skips a merge of a constraint whose requirements or appliesTo the survivor would not carry", () => {
    const requirement = { id: "r1", title: "Suite passes", category: "quality", validationType: "automated", acceptanceCriteria: ["green"] };
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ requirements: [requirement] }, /con2 has requirements, which a merge would drop/],
      [{ appliesTo: "all" }, /con2 has appliesTo, which a merge would drop/],
    ];
    for (const [extra, reason] of cases) {
      const constraint = (id: string, fields: Record<string, unknown> = {}) => node({ id, type: "constraint", statement: `${id} holds`, ...fields });
      const tree: RuleNode[] = [node({ id: "area1", type: "area", children: [constraint("con1"), constraint("con2", extra)] })];
      const draft = draftProductReshape(tree, [{ id: "p", action: { action: "merge", survivorId: "con1", mergedIds: ["con2"], reason: "r" } }]);
      expect(draft.amends).toEqual([]);
      expect(draft.skipped).toEqual([{ proposalId: "p", reason: expect.stringMatching(reason) }]);
    }
  });

  it("drafts a merge of a capability whose body is only History", () => {
    const tree: RuleNode[] = [node({ id: "area1", type: "area", children: [capability("cap1"), capability("cap2", { body: "## History\n\n- 2026-10-01 CH1 added: s" })] })];
    const draft = draftProductReshape(tree, [{ id: "p", action: { action: "merge", survivorId: "cap1", mergedIds: ["cap2"], reason: "r" } }]);
    expect(draft.skipped).toEqual([]);
    expect(draft.amends.map((a) => [a.delta, a.target])).toEqual([["removed", "cap2"], ["modified", "cap1"]]);
  });

  it("skips a merge across types, which would drop the merged node's capability criteria", () => {
    const draft = draftProductReshape(product(), [
      { id: "p1", action: { action: "merge", survivorId: "area2", mergedIds: ["cap1"], reason: "r" } },
      { id: "p2", action: { action: "merge", survivorId: "cap1", mergedIds: ["cap1"], reason: "r" } },
    ]);
    expect(draft.amends).toEqual([]);
    expect(draft.skipped.map((s) => s.reason)).toEqual([expect.stringMatching(/a merge keeps one type/), expect.stringMatching(/into itself/)]);
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

  it("skips a move or split of a capability whose requirements, dependsOn, tags or body an added copy would drop", () => {
    const requirement = { id: "r1", title: "Suite passes", category: "quality", validationType: "automated", acceptanceCriteria: ["green"] };
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ requirements: [requirement] }, /has requirements, which an added copy would drop/],
      [{ dependsOn: ["cap2"] }, /has dependsOn, which an added copy would drop/],
      [{ tags: ["checkout"] }, /has tags, which an added copy would drop/],
      [{ body: "Raised by support.\n\n## History\n\n- 2026-10-01 CH1 added: s" }, /has notes outside History in its body, which an added copy would drop/],
      [{ body: "## History\n\n- 2026-10-01 CH1 added: s\n\n## Notes\n\nKept." }, /has notes outside History in its body/],
    ];
    for (const [extra, reason] of cases) {
      const tree: RuleNode[] = [
        node({ id: "area1", type: "area", children: [capability("cap1", extra), capability("cap2")] }),
        node({ id: "area2", type: "area" }),
      ];
      const draft = draftProductReshape(tree, [
        { id: "move", action: { action: "reparent", itemId: "cap1", newParentId: "area2", reason: "r" } },
        { id: "split", action: { action: "split", sourceId: "cap1", reason: "r", children: [{ title: "A", level: "feature" }] } },
      ]);
      expect(draft.amends).toEqual([]);
      expect(draft.skipped).toEqual([
        { proposalId: "move", reason: expect.stringMatching(reason) },
        { proposalId: "split", reason: expect.stringMatching(reason) },
      ]);
      // A hand-written change would use the same added amendment, so the reason must not send the user there.
      expect(draft.skipped[0].reason).toMatch(/no amendment moves it whole yet$/);
    }
  });

  it("drafts a move or split of a capability whose body is only the History apply wrote, naming the original in the copy's summary", () => {
    const tree: RuleNode[] = [
      node({ id: "area1", type: "area", children: [capability("cap1", { body: "## History\n\n- 2026-10-01 CH1 added: s\n- 2026-10-02 CH2 modified: t" })] }),
      node({ id: "area2", type: "area" }),
    ];
    const move = draftProductReshape(tree, [{ id: "move", action: { action: "reparent", itemId: "cap1", newParentId: "area2", reason: "r" } }], { newId: ids() });
    expect(move.skipped).toEqual([]);
    expect(move.amends.map((a) => [a.delta, a.target, a.under, a.summary])).toEqual([
      ["removed", "cap1", undefined, "r"],
      ["added", "new-1", "area2", "r (moved from cap1)"],
    ]);
    const split = draftProductReshape(tree, [{ id: "split", action: { action: "split", sourceId: "cap1", reason: "r", children: [{ title: "A", level: "feature" }] } }], { newId: ids() });
    expect(split.skipped).toEqual([]);
    expect(split.amends[1]).toMatchObject({ delta: "added", summary: "r (split from cap1)" });
  });

  it("skips a move of a node another live node names in dependsOn or appliesTo", () => {
    const tree: RuleNode[] = [
      node({
        id: "area1",
        type: "area",
        children: [
          capability("cap1", { displayId: "A1.1" }),
          capability("cap2", { dependsOn: ["A1.1"] }),
          capability("cap3"),
          node({ id: "con1", type: "constraint", statement: "s", appliesTo: ["cap3"] }),
          capability("cap4", { status: "deleted", dependsOn: ["cap5"] }),
          capability("cap5"),
        ],
      }),
      node({ id: "area2", type: "area" }),
    ];
    const draft = draftProductReshape(tree, [
      { id: "p1", action: { action: "reparent", itemId: "cap1", newParentId: "area2", reason: "r" } },
      { id: "p2", action: { action: "reparent", itemId: "cap3", newParentId: "area2", reason: "r" } },
      { id: "p3", action: { action: "reparent", itemId: "cap5", newParentId: "area2", reason: "r" } },
    ]);
    expect(draft.skipped).toEqual([
      { proposalId: "p1", reason: expect.stringMatching(/cap2 names A1\.1, which a copy with a new id would leave pointing at a retired node/) },
      { proposalId: "p2", reason: expect.stringMatching(/con1 names cap3/) },
    ]);
    // A retired node's dependsOn does not hold a live node in place.
    expect(draft.drafted).toEqual(["p3"]);
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
