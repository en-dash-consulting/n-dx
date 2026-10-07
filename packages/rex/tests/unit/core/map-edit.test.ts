/**
 * Direct edits to the product layer: an editorial edit re-stamps metAt, any
 * other spec edit leaves the node revised and drafts one change in the Inbox.
 */

import { describe, it, expect } from "vitest";
import { applyAmendments } from "../../../src/core/apply-amendments.js";
import { MapEditError, handleMapEdit, type MapEditOptions } from "../../../src/core/map-edit.js";
import { specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";
import type { Criterion } from "../../../src/schema/v2.js";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const OPTS: MapEditOptions = { now: NOW, newId: () => "draft-1" };

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

function refusal(fn: () => unknown): MapEditError {
  try {
    fn();
  } catch (err) {
    if (err instanceof MapEditError) return err;
    throw err;
  }
  throw new Error("expected MapEditError");
}

describe("handleMapEdit: editorial", () => {
  const edited = { statement: "A shopper can pay with a card." };

  it("re-stamps metAt so the node stays met, and records a History line", () => {
    const { tree: out, outcome, change } = handleMapEdit(tree(edited), "A1.1", BEFORE, { ...OPTS, editorial: true, summary: "Wording" });
    const node = cap(out);
    expect(outcome).toBe("editorial");
    expect(change).toBeUndefined();
    expect(node.metAt).toBe(specHash(node));
    expect(node.revisedAt).toBeUndefined();
    expect(node.body).toBe("Card payments.\n\n## History\n\n- 2026-10-07 editorial: Wording");
    expect(out.changes).toEqual([]);
  });

  it("derives the History summary from the diff when none is given", () => {
    const { tree: out } = handleMapEdit(tree(edited), CAP, BEFORE, { ...OPTS, editorial: true });
    expect(cap(out).body).toMatch(/- 2026-10-07 editorial: statement edited$/);
  });
});

describe("handleMapEdit: substantive", () => {
  const edited = {
    statement: "A shopper can pay by card or wallet.",
    criteria: [
      { id: "c1", text: "Charged exactly once" },
      { id: "c3", text: "Receipt sent" },
    ],
  };

  it("leaves the node revised and drafts one Inbox change with source map-edit", () => {
    const { tree: out, outcome, change } = handleMapEdit(tree(edited), "A1.1", BEFORE, OPTS);
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
      source: "map-edit",
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
        "Pay by card (A1.1) was edited on the map. Build it.",
        "",
        "- Statement: “A shopper can pay by card.” → “A shopper can pay by card or wallet.”",
        "- Added c3: Receipt sent",
        "- Replaced c1: “Charged once” → “Charged exactly once”",
        "- Removed c2: Declines show why",
      ].join("\n"),
    );
  });

  it("keeps an earlier revisedAt, so the revision's age is not reset", () => {
    const { tree: out } = handleMapEdit(tree({ ...edited, revisedAt: "2026-09-01T00:00:00.000Z" }), CAP, BEFORE, OPTS);
    expect(cap(out).revisedAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("drafts a change that, applied, makes the node met at the edited spec", () => {
    const { tree: drafted, change } = handleMapEdit(tree(edited), CAP, BEFORE, OPTS);
    const { tree: out } = applyAmendments(drafted, change!.id, { commit: "abc1234", now: NOW });
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
    const { outcome, change } = handleMapEdit(t, CON, before, OPTS);
    expect(outcome).toBe("revised");
    expect(change?.amends).toEqual([{ target: CON, delta: "modified", summary: "statement edited", proposed: "No card data stored." }]);
  });

  it("suffixes the draft's slug when another change holds it", () => {
    const t = tree(edited);
    t.changes.push({ id: "other", type: "change", title: "x", slug: "build-the-revised-pay-by-card", status: "pending" } as RuleNode);
    expect(handleMapEdit(t, CAP, BEFORE, OPTS).change?.slug).toBe("build-the-revised-pay-by-card-draft1");
  });
});

describe("handleMapEdit: nothing to do", () => {
  it("reports unchanged when the spec still hashes to metAt", () => {
    const input = tree({ body: "Card payments, reworded." });
    const { tree: out, outcome } = handleMapEdit(input, CAP, BEFORE, OPTS);
    expect(outcome).toBe("unchanged");
    expect(out).toEqual(input);
  });

  it("reports proposed for a node never met: there is no build to revise", () => {
    const input = tree({ metAt: undefined, statement: "Changed" });
    const { tree: out, outcome } = handleMapEdit(input, CAP, BEFORE, { ...OPTS, editorial: true });
    expect(outcome).toBe("proposed");
    expect(out).toEqual(input);
  });
});

describe("handleMapEdit: refusals", () => {
  it("refuses a node that is not a live capability or constraint", () => {
    expect(refusal(() => handleMapEdit(tree(), "A1", BEFORE, OPTS)).message).toMatch(/not a live capability or constraint/);
    expect(refusal(() => handleMapEdit(tree(), "nope", BEFORE, OPTS)).message).toMatch(/not a live capability or constraint/);
    expect(refusal(() => handleMapEdit(tree({ status: "deleted" }), CAP, BEFORE, OPTS)).message).toMatch(/not a live/);
  });

  it("refuses an editorial edit to a node already revised, which would mark the unbuilt revision met", () => {
    const revised = { statement: "A shopper can pay by card or wallet." };
    const reworded = { statement: "A shopper can pay by card or by wallet." };
    const input = tree(reworded);
    expect(refusal(() => handleMapEdit(input, CAP, { ...BEFORE, ...revised }, { ...OPTS, editorial: true })).message).toMatch(/already revised/);
    expect(cap(input).metAt).toBe(MET);
  });

  it("refuses a taken id for the draft", () => {
    expect(refusal(() => handleMapEdit(tree({ statement: "x" }), CAP, BEFORE, { ...OPTS, newId: () => CON })).message).toMatch(/con-1 is already taken/);
  });

  it("leaves the input tree untouched", () => {
    const input = tree({ statement: "x" });
    const before = structuredClone(input);
    handleMapEdit(input, CAP, BEFORE, OPTS);
    handleMapEdit(input, CAP, BEFORE, { ...OPTS, editorial: true });
    expect(input).toEqual(before);
  });
});
