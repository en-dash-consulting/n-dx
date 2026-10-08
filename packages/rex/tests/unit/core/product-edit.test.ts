/**
 * Direct edits to the product layer: an editorial edit re-stamps metAt, any
 * other spec edit leaves the node revised and drafts one change in the Inbox.
 */

import { describe, it, expect } from "vitest";
import { applyAmendments } from "../../../src/core/apply-amendments.js";
import { ProductEditError, handleProductEdit, type ProductEditOptions } from "../../../src/core/product-edit.js";
import { specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Criterion } from "../../../src/schema/v2.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const OPTS: ProductEditOptions = { now: NOW, newId: () => "draft-1" };

const CAP = "cap-1";
const CON = "con-1";
const STATEMENT = "A shopper can pay by card.";
const CRITERIA: Criterion[] = [
  { id: "c1", text: "Charged once" },
  { id: "c2", text: "Declines show why" },
];
const BEFORE = { statement: STATEMENT, criteria: CRITERIA };
const MET = specHash(BEFORE);

/** A tree whose capability `cap-1` was met at {@link BEFORE} and now holds `edit`. */
function tree(edit: Partial<RuleNode> = {}): V2Tree {
  return {
    product: [
      {
        id: "area-1",
        type: "area",
        title: "Checkout",
        slug: "checkout",
        displayId: "A1",
        status: "pending",
        children: [
          {
            id: CAP,
            type: "capability",
            title: "Pay by card",
            slug: "pay-by-card",
            displayId: "A1.1",
            statement: STATEMENT,
            criteria: CRITERIA.map((c) => ({ ...c })),
            body: "Card payments.",
            status: "pending",
            metAt: MET,
            ...edit,
          },
          {
            id: CON,
            type: "constraint",
            title: "PCI",
            slug: "pci",
            statement: "Card data never touches our servers.",
            metAt: specHash({ statement: "Card data never touches our servers." }),
            status: "pending",
          },
        ],
      } as RuleNode,
    ],
    changes: [],
  };
}

function cap(t: V2Tree): RuleNode {
  return t.product[0].children![0];
}

function refusal(fn: () => unknown): ProductEditError {
  try {
    fn();
  } catch (err) {
    if (err instanceof ProductEditError) return err;
    throw err;
  }
  throw new Error("expected ProductEditError");
}

describe("handleProductEdit: editorial", () => {
  const edited = { statement: "A shopper can pay with a card." };

  it("re-stamps metAt so the node stays met, and records a History line", () => {
    const { tree: out, outcome, drafts, stale } = handleProductEdit(tree(edited), "A1.1", BEFORE, { ...OPTS, editorial: true, summary: "Wording" });
    const node = cap(out);
    expect(outcome).toBe("editorial");
    expect(drafts).toEqual([]);
    expect(stale).toEqual([]);
    expect(node.metAt).toBe(specHash(node));
    expect(node.revisedAt).toBeUndefined();
    expect(node.body).toBe("Card payments.\n\n## History\n\n- 2026-10-07 editorial: Wording");
    expect(out.changes).toEqual([]);
  });

  it("derives the History summary from the diff when none is given", () => {
    const { tree: out } = handleProductEdit(tree(edited), CAP, BEFORE, { ...OPTS, editorial: true });
    expect(cap(out).body).toMatch(/- 2026-10-07 editorial: statement edited$/);
  });
});

describe("handleProductEdit: substantive", () => {
  const edited = {
    statement: "A shopper can pay by card or wallet.",
    criteria: [
      { id: "c1", text: "Charged exactly once" },
      { id: "c3", text: "Receipt sent" },
    ],
  };

  it("leaves the node revised and drafts one Inbox change with source product-edit", () => {
    const { tree: out, outcome, drafts: [change], stale } = handleProductEdit(tree(edited), "A1.1", BEFORE, OPTS);
    expect(stale).toEqual([]);
    const node = cap(out);
    expect(outcome).toBe("revised");
    expect(node.metAt).toBe(MET);
    expect(specHash(node)).not.toBe(node.metAt);
    expect(node.revisedAt).toBe(NOW.toISOString());
    expect(node.body).toBe("Card payments.");

    expect(out.changes).toHaveLength(1);
    expect(change).toBe(out.changes[0]);
    expect(change).toMatchObject({
      id: "draft-1",
      type: "change",
      title: "Build the revised Pay by card",
      slug: "build-the-revised-pay-by-card",
      source: "product-edit",
      status: "pending",
      needsPlacement: true,
      amends: [
        {
          target: "A1.1",
          delta: "modified",
          summary: "statement edited; criteria c3 added, c1 replaced, c2 removed",
          proposed: "A shopper can pay by card or wallet.",
        },
      ],
    });
    expect(change?.intent).toBe(
      [
        "Pay by card (A1.1) was edited in the product layer. Build it.",
        "",
        "- Statement: “A shopper can pay by card.” → “A shopper can pay by card or wallet.”",
        "- Added c3: Receipt sent",
        "- Replaced c1: “Charged once” → “Charged exactly once”",
        "- Removed c2: Declines show why",
      ].join("\n"),
    );
  });

  it("keeps an earlier revisedAt, so the revision's age is not reset", () => {
    const { tree: out } = handleProductEdit(tree({ ...edited, revisedAt: "2026-09-01T00:00:00.000Z" }), CAP, BEFORE, OPTS);
    expect(cap(out).revisedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("drafts a change that, applied, makes the node met at the edited spec", () => {
    const { tree: drafted, drafts: [change] } = handleProductEdit(tree(edited), CAP, BEFORE, OPTS);
    const { tree: out } = applyAmendments(drafted, change!.id, { appliedAt: NOW.toISOString(), now: NOW });
    const node = cap(out);
    expect(node.criteria).toEqual(edited.criteria);
    expect(node.metAt).toBe(specHash(edited));
    expect(node.revisedAt).toBeUndefined();
  });

  it("drafts for a constraint too", () => {
    const t = tree();
    const con = t.product[0].children![1];
    const before = { statement: con.statement };
    con.statement = "No card data stored.";
    const { outcome, drafts: [change] } = handleProductEdit(t, CON, before, OPTS);
    expect(outcome).toBe("revised");
    expect(change?.amends).toEqual([
      { target: CON, delta: "modified", summary: "statement edited", proposed: "No card data stored.", base: specHash({ statement: "No card data stored." }) },
    ]);
  });

  it("records the edited spec as base, so apply refuses the draft after another change edits the node", () => {
    const { tree: drafted, drafts: [change] } = handleProductEdit(tree(edited), CAP, BEFORE, OPTS);
    expect(change?.amends?.[0].base).toBe(specHash(edited));
    const other = { id: "other", type: "change", title: "Other", slug: "other", status: "pending" } as RuleNode;
    drafted.changes.push({ ...other, amends: [{ target: CAP, delta: "modified", summary: "s", proposed: "Something else." }] } as RuleNode);
    const applyOpts = { appliedAt: NOW.toISOString(), now: NOW };
    const { tree: afterOther } = applyAmendments(drafted, "other", applyOpts);
    expect(() => applyAmendments(afterOther, change!.id, applyOpts)).toThrow(/no longer matches the target's spec/);
  });

  it("suffixes the draft's slug when another change holds it", () => {
    const t = tree(edited);
    t.changes.push({ id: "other", type: "change", title: "x", slug: "build-the-revised-pay-by-card", status: "pending" } as RuleNode);
    expect(handleProductEdit(t, CAP, BEFORE, OPTS).drafts[0]?.slug).toBe("build-the-revised-pay-by-card-draft1");
  });
});

describe("handleProductEdit: a second edit refreshes pending drafts", () => {
  const B = { statement: "A shopper can pay by card or wallet.", criteria: CRITERIA };
  const C = { statement: "A shopper can pay by card, wallet or bank.", criteria: [...CRITERIA, { id: "c3", text: "Receipt sent" }] };

  /** Edit A → B, then B → C, each handled as it happens. */
  function twoEdits(): ReturnType<typeof handleProductEdit> {
    const first = handleProductEdit(tree(B), CAP, BEFORE, OPTS).tree;
    Object.assign(cap(first), structuredClone(C));
    return handleProductEdit(first, CAP, B, { ...OPTS, now: new Date("2026-10-08T09:00:00.000Z"), newId: () => "draft-2" });
  }

  it("leaves exactly one open product-edit draft for the node", () => {
    const { tree: out, outcome, drafts, stale } = twoEdits();
    expect(outcome).toBe("revised");
    expect(out.changes).toHaveLength(1);
    expect(drafts).toEqual([out.changes[0]]);
    expect(drafts[0].id).toBe("draft-1");
    expect(stale).toEqual([]);
    expect(cap(out).revisedAt).toBe(NOW.toISOString());
  });

  it("proposes the latest statement and lists both diffs in its intent", () => {
    const { drafts: [change] } = twoEdits();
    expect(change?.amends).toEqual([
      { target: "A1.1", delta: "modified", summary: "statement edited; criteria c3 added", proposed: C.statement, base: specHash(C) },
    ]);
    expect(change?.intent).toBe(
      [
        "Pay by card (A1.1) was edited in the product layer. Build it.",
        "",
        `- Statement: “${STATEMENT}” → “${B.statement}”`,
        "",
        "Edited again on 2026-10-08:",
        "",
        `- Statement: “${B.statement}” → “${C.statement}”`,
        "- Added c3: Receipt sent",
      ].join("\n"),
    );
  });

  it("applied after both edits, leaves the node met at the latest spec", () => {
    const { tree: drafted, drafts: [change] } = twoEdits();
    const { tree: out } = applyAmendments(drafted, change!.id, { appliedAt: NOW.toISOString(), now: NOW });
    const node = cap(out);
    expect(node.statement).toBe(C.statement);
    expect(node.criteria).toEqual(C.criteria);
    expect(node.metAt).toBe(specHash(C));
    expect(node.revisedAt).toBeUndefined();
  });

  it("drafts anew when the earlier draft is applied, closed or from another source", () => {
    const closed: Partial<RuleNode>[] = [{ appliedAt: NOW.toISOString() }, { status: "cancelled" }, { status: "deleted" }, { source: "recommend" }];
    for (const patch of closed) {
      const first = handleProductEdit(tree(B), CAP, BEFORE, OPTS).tree;
      Object.assign(first.changes[0], patch);
      Object.assign(cap(first), structuredClone(C));
      const { tree: out, drafts, stale } = handleProductEdit(first, CAP, B, { ...OPTS, newId: () => "draft-2" });
      expect(out.changes.map((c) => c.id)).toEqual(["draft-1", "draft-2"]);
      expect(drafts.map((c) => c.id)).toEqual(["draft-2"]);
      expect(stale).toEqual([]);
    }
  });

  describe("a completed but unapplied draft", () => {
    /** Edit A → B, complete the draft without applying it, then edit B → C. */
    function afterCompleted(): { input: V2Tree; result: ReturnType<typeof handleProductEdit> } {
      const input = handleProductEdit(tree(B), CAP, BEFORE, OPTS).tree;
      input.changes[0].status = "completed";
      Object.assign(cap(input), structuredClone(C));
      return { input, result: handleProductEdit(input, CAP, B, { ...OPTS, newId: () => "draft-2" }) };
    }

    it("is left proposing B, as completed", () => {
      const { input, result } = afterCompleted();
      expect(result.tree.changes[0]).toEqual(input.changes[0]);
      expect(result.tree.changes[0]).toMatchObject({ status: "completed", amends: [{ proposed: B.statement, base: specHash(B) }] });
    });

    it("is reported as stale beside a new draft proposing C", () => {
      const { result } = afterCompleted();
      expect(result.outcome).toBe("revised");
      expect(result.stale).toEqual([result.tree.changes[0]]);
      expect(result.drafts).toEqual([result.tree.changes[1]]);
      expect(result.drafts[0]).toMatchObject({ id: "draft-2", status: "pending", amends: [{ proposed: C.statement, base: specHash(C) }] });
    });

    it("is refused at apply, so it cannot mark C met with B's build", () => {
      const { result } = afterCompleted();
      const applyOpts = { appliedAt: NOW.toISOString(), now: NOW };
      expect(() => applyAmendments(result.tree, "draft-1", applyOpts)).toThrow(/no longer matches the target's spec/);
      expect(cap(applyAmendments(result.tree, "draft-2", applyOpts).tree).metAt).toBe(specHash(C));
    });
  });

  it("refreshes every pending draft, so none proposes an older statement", () => {
    const first = handleProductEdit(tree(B), CAP, BEFORE, OPTS).tree;
    // Two branches each drafted for A1.1, then merged.
    first.changes.push({ ...structuredClone(first.changes[0]), id: "draft-0", slug: "other-branch" });
    Object.assign(cap(first), structuredClone(C));
    const { tree: out, drafts } = handleProductEdit(first, CAP, B, { ...OPTS, newId: () => "draft-2" });
    expect(out.changes.map((c) => c.id)).toEqual(["draft-1", "draft-0"]);
    expect(drafts.map((c) => c.id)).toEqual(["draft-1", "draft-0"]);
    for (const change of out.changes) expect(change.amends).toMatchObject([{ proposed: C.statement, base: specHash(C) }]);
  });
});

describe("handleProductEdit: reverting to the met spec withdraws pending drafts", () => {
  const B = { statement: "A shopper can pay by card or wallet.", criteria: CRITERIA };

  /** Edit A → B, then patch the tree, then edit B back to A. */
  function revert(patch: (t: V2Tree) => void = () => {}): { input: V2Tree; result: ReturnType<typeof handleProductEdit> } {
    const input = handleProductEdit(tree(B), CAP, BEFORE, OPTS).tree;
    patch(input);
    Object.assign(cap(input), structuredClone(BEFORE));
    return { input, result: handleProductEdit(input, CAP, B, { ...OPTS, now: new Date("2026-10-08T09:00:00.000Z") }) };
  }

  it("cancels the draft, so no open product-edit draft amends the node", () => {
    const { result } = revert();
    expect(result.outcome).toBe("reverted");
    expect(result.drafts).toEqual([result.tree.changes[0]]);
    expect(result.stale).toEqual([]);
    expect(result.drafts[0].status).toBe("cancelled");
    expect(result.drafts[0].amends).toEqual([]);
    expect(result.drafts[0].intent?.split("\n").at(-1)).toBe("Cancelled on 2026-10-08: A1.1 was reverted to its met spec.");
    expect(() => applyAmendments(result.tree, "draft-1", { appliedAt: NOW.toISOString(), now: NOW })).toThrow();
  });

  it("clears revisedAt, so the node reads met at the reverted spec", () => {
    const { result } = revert();
    const node = cap(result.tree);
    expect(node.revisedAt).toBeUndefined();
    expect(node.metAt).toBe(specHash(specOfCap(node)));
    expect(node.statement).toBe(STATEMENT);
  });

  it("leaves the input tree unmodified", () => {
    const { input } = revert();
    expect(cap(input).revisedAt).toBe(NOW.toISOString());
    expect(input.changes[0].status).toBe("pending");
    expect(input.changes[0].amends).toHaveLength(1);
  });

  it("cancels the draft's open tasks and subtasks, keeping closed ones", () => {
    const { result } = revert((t) => {
      t.changes[0].children = [
        { id: "t1", type: "task", title: "Build", slug: "build", status: "in_progress", children: [{ id: "s1", type: "subtask", title: "Part", slug: "part", status: "pending" }] },
        { id: "t2", type: "task", title: "Done", slug: "done", status: "completed" },
      ] as RuleNode[];
    });
    const [t1, t2] = result.drafts[0].children!;
    expect([t1.status, t1.children![0].status, t2.status]).toEqual(["cancelled", "cancelled", "completed"]);
  });

  it("drops only the node's amendment from a draft that amends other nodes too", () => {
    const other = { target: CON, delta: "modified", summary: "statement edited", proposed: "Card data is tokenised." } as const;
    const { result } = revert((t) => t.changes[0].amends!.push({ ...other }));
    expect(result.outcome).toBe("reverted");
    expect(result.drafts[0].status).toBe("pending");
    expect(result.drafts[0].amends).toEqual([other]);
    expect(result.drafts[0].intent?.split("\n").at(-1)).toBe("A1.1 was reverted to its met spec on 2026-10-08; its amendment was dropped.");
    expect(cap(result.tree).revisedAt).toBeUndefined();
  });

  it("withdraws every pending draft amending the node", () => {
    const { result } = revert((t) => t.changes.push({ ...structuredClone(t.changes[0]), id: "draft-0", slug: "other-branch" }));
    expect(result.drafts.map((c) => c.id)).toEqual(["draft-1", "draft-0"]);
    for (const change of result.tree.changes) expect(change).toMatchObject({ status: "cancelled", amends: [] });
  });

  it("only clears revisedAt when the draft is already closed", () => {
    const { input, result } = revert((t) => Object.assign(t.changes[0], { status: "cancelled" }));
    expect(result.outcome).toBe("reverted");
    expect(result.drafts).toEqual([]);
    expect(result.tree.changes).toEqual(input.changes);
    expect(cap(result.tree).revisedAt).toBeUndefined();
  });

  it("is unchanged when the draft is closed and the node not revised", () => {
    const { input, result } = revert((t) => {
      Object.assign(t.changes[0], { status: "cancelled" });
      delete cap(t).revisedAt;
    });
    expect(result.outcome).toBe("unchanged");
    expect(result.tree).toBe(input);
  });

  describe("a completed but unapplied draft", () => {
    const completed = (t: V2Tree) => Object.assign(t.changes[0], { status: "completed" });

    it("is reported as stale and left as it was", () => {
      const { input, result } = revert(completed);
      expect(result.outcome).toBe("reverted");
      expect(result.drafts).toEqual([]);
      expect(result.stale).toEqual([result.tree.changes[0]]);
      expect(result.tree.changes[0]).toEqual(input.changes[0]);
      expect(cap(result.tree).revisedAt).toBeUndefined();
    });

    it("is still reported once the node is no longer revised", () => {
      const { result: first } = revert(completed);
      const again = handleProductEdit(first.tree, CAP, BEFORE, OPTS);
      expect(again.outcome).toBe("unchanged");
      expect(again.stale.map((c) => c.id)).toEqual(["draft-1"]);
    });

    it("is refused at apply, so it cannot write the abandoned spec over the revert", () => {
      const { result } = revert(completed);
      expect(() => applyAmendments(result.tree, "draft-1", { appliedAt: NOW.toISOString(), now: NOW })).toThrow(/no longer matches the target's spec/);
    });

    it("is left alone beside a pending draft that is withdrawn", () => {
      const { result } = revert((t) => {
        t.changes.push({ ...structuredClone(t.changes[0]), id: "draft-0", slug: "other-branch" });
        completed(t);
      });
      expect(result.stale.map((c) => c.id)).toEqual(["draft-1"]);
      expect(result.drafts.map((c) => c.id)).toEqual(["draft-0"]);
      expect(result.tree.changes.map((c) => c.status)).toEqual(["completed", "cancelled"]);
    });
  });
});

function specOfCap(node: RuleNode): { statement?: string; criteria?: Criterion[] } {
  return { statement: node.statement, criteria: node.criteria };
}

describe("handleProductEdit: nothing to do", () => {
  it("reports unchanged when the spec still hashes to metAt", () => {
    const input = tree({ body: "Card payments, reworded." });
    const { tree: out, outcome } = handleProductEdit(input, CAP, BEFORE, OPTS);
    expect(outcome).toBe("unchanged");
    expect(out).toEqual(input);
  });

  it("reports proposed for a node never met: there is no build to revise", () => {
    const input = tree({ metAt: undefined, statement: "Changed" });
    const { tree: out, outcome } = handleProductEdit(input, CAP, BEFORE, { ...OPTS, editorial: true });
    expect(outcome).toBe("proposed");
    expect(out).toEqual(input);
  });
});

describe("handleProductEdit: refusals", () => {
  it("refuses a node that is not a live capability or constraint", () => {
    expect(refusal(() => handleProductEdit(tree(), "A1", BEFORE, OPTS)).message).toMatch(/not a live capability or constraint/);
    expect(refusal(() => handleProductEdit(tree(), "nope", BEFORE, OPTS)).message).toMatch(/not a live capability or constraint/);
    expect(refusal(() => handleProductEdit(tree({ status: "deleted" }), CAP, BEFORE, OPTS)).message).toMatch(/not a live/);
  });

  it("refuses an editorial edit to a node already revised, which would mark the unbuilt revision met", () => {
    const revised = { statement: "A shopper can pay by card or wallet." };
    const reworded = { statement: "A shopper can pay by card or by wallet." };
    const input = tree(reworded);
    expect(refusal(() => handleProductEdit(input, CAP, { ...BEFORE, ...revised }, { ...OPTS, editorial: true })).message).toMatch(/already revised/);
    expect(cap(input).metAt).toBe(MET);
  });

  it("refuses a taken id for the draft", () => {
    expect(refusal(() => handleProductEdit(tree({ statement: "x" }), CAP, BEFORE, { ...OPTS, newId: () => CON })).message).toMatch(/con-1 is already taken/);
  });

  it("leaves the input tree untouched", () => {
    const input = tree({ statement: "x" });
    const before = structuredClone(input);
    handleProductEdit(input, CAP, BEFORE, OPTS);
    handleProductEdit(input, CAP, BEFORE, { ...OPTS, editorial: true });
    expect(input).toEqual(before);
  });
});
