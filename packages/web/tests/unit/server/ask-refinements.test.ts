/**
 * Parsing and staleness for proposed PRD refinements.
 *
 * The module's job is to be suspicious: the proposals come from a model, they
 * describe edits to content that already exists, and an edit applied to text
 * the model never saw is how a PRD loses history. So the tests lean on the two
 * refusals — malformed proposals never become reviewable, and a proposal whose
 * `before` no longer matches the item is stale.
 *
 * @see packages/web/src/server/ask-refinements.ts
 */

import { describe, it, expect } from "vitest";
import {
  parseRefinementProposals,
  stripRefinementBlock,
  refinementInstructions,
  stalenessOf,
  currentValue,
  REFINEMENT_BLOCK_TAG,
} from "../../../src/server/ask-refinements.js";
import type { PRDItem } from "../../../src/server/rex-gateway.js";

const ITEM: PRDItem = {
  id: "item-1",
  title: "Ship the billing report",
  level: "task",
  status: "pending",
  priority: "medium",
  description: "Generate the monthly invoice report.",
  acceptanceCriteria: ["Report renders", "Totals reconcile"],
};

const SIBLING: PRDItem = {
  id: "item-2",
  title: "Billing report (duplicate)",
  level: "task",
  status: "pending",
};

const ITEMS = [ITEM, SIBLING];

/** Wrap proposals in the fenced block the model is asked to emit. */
function answerWith(proposals: unknown[], prose = "Here is what I would change.\n\n"): string {
  return `${prose}\`\`\`${REFINEMENT_BLOCK_TAG}\n${JSON.stringify(proposals, null, 2)}\n\`\`\``;
}

const DESCRIPTION_PROPOSAL = {
  kind: "description",
  itemId: "item-1",
  rationale: "The description does not say which month.",
  before: ["Generate the monthly invoice report."],
  after: ["Generate the invoice report for the closing month."],
};

describe("parseRefinementProposals", () => {
  it("reads a well-formed proposal out of the answer", () => {
    const [proposal] = parseRefinementProposals(answerWith([DESCRIPTION_PROPOSAL]), ITEMS);

    expect(proposal).toMatchObject({
      kind: "description",
      itemId: "item-1",
      itemTitle: "Ship the billing report",
      before: ["Generate the monthly invoice report."],
      after: ["Generate the invoice report for the closing month."],
    });
    expect(proposal!.id).toBeTruthy();
  });

  it("finds nothing when the answer is only prose", () => {
    expect(parseRefinementProposals("The billing zone owns invoicing.", ITEMS)).toEqual([]);
  });

  it("survives a block that is not valid JSON", () => {
    // The prose is still worth reading; a broken block is not worth failing on.
    const answer = `Prose.\n\n\`\`\`${REFINEMENT_BLOCK_TAG}\n[{"kind": "descrip\n\`\`\``;

    expect(parseRefinementProposals(answer, ITEMS)).toEqual([]);
  });

  it("drops a proposal against an item that does not exist", () => {
    // A hallucinated id can only fail later; failing it here keeps it off the
    // review list entirely.
    const answer = answerWith([{ ...DESCRIPTION_PROPOSAL, itemId: "no-such-item" }]);

    expect(parseRefinementProposals(answer, ITEMS)).toEqual([]);
  });

  it("drops proposals of an unknown kind", () => {
    const answer = answerWith([{ ...DESCRIPTION_PROPOSAL, kind: "deleteEverything" }]);

    expect(parseRefinementProposals(answer, ITEMS)).toEqual([]);
  });

  it("drops a proposal whose values are not strings", () => {
    const answer = answerWith([{ ...DESCRIPTION_PROPOSAL, after: [{ text: "nope" }] }]);

    expect(parseRefinementProposals(answer, ITEMS)).toEqual([]);
  });

  it("drops a priority that rex would reject", () => {
    const answer = answerWith([
      { kind: "priority", itemId: "item-1", rationale: "", before: ["medium"], after: ["urgent"] },
    ]);

    expect(parseRefinementProposals(answer, ITEMS)).toEqual([]);
  });

  it("drops a no-op, which is only noise in a review list", () => {
    const answer = answerWith([{ ...DESCRIPTION_PROPOSAL, after: DESCRIPTION_PROPOSAL.before }]);

    expect(parseRefinementProposals(answer, ITEMS)).toEqual([]);
  });

  it("keeps the good proposals when one of them is malformed", () => {
    const answer = answerWith([{ kind: "nonsense" }, DESCRIPTION_PROPOSAL]);

    const proposals = parseRefinementProposals(answer, ITEMS);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.kind).toBe("description");
  });

  it("accepts a multi-line acceptance-criteria rewrite", () => {
    const answer = answerWith([{
      kind: "acceptanceCriteria",
      itemId: "item-1",
      rationale: "Criteria are not testable.",
      before: ["Report renders", "Totals reconcile"],
      after: ["Report renders within 2s", "Totals reconcile against the ledger", "Empty months render a notice"],
    }]);

    const [proposal] = parseRefinementProposals(answer, ITEMS);
    expect(proposal!.after).toHaveLength(3);
  });

  it("gives each proposal a distinct id so verdicts cannot collide", () => {
    const answer = answerWith([
      DESCRIPTION_PROPOSAL,
      { kind: "priority", itemId: "item-1", rationale: "", before: ["medium"], after: ["high"] },
    ]);

    const ids = parseRefinementProposals(answer, ITEMS).map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("stripRefinementBlock", () => {
  it("removes the block so the same change is not shown twice", () => {
    const stripped = stripRefinementBlock(answerWith([DESCRIPTION_PROPOSAL]));

    expect(stripped).toBe("Here is what I would change.");
    expect(stripped).not.toContain(REFINEMENT_BLOCK_TAG);
    expect(stripped).not.toContain("itemId");
  });

  it("leaves an answer with no block untouched", () => {
    expect(stripRefinementBlock("Just prose.")).toBe("Just prose.");
  });

  it("leaves ordinary code fences alone", () => {
    const answer = "Run this:\n\n```sh\nndx analyze .\n```";

    expect(stripRefinementBlock(answer)).toBe(answer);
  });
});

describe("refinementInstructions", () => {
  it("lists the items a proposal may target", () => {
    const instructions = refinementInstructions(ITEMS);

    // A model cannot propose a change to an item it was never shown, and an id
    // it invents is dropped at parse time.
    expect(instructions).toContain("item-1");
    expect(instructions).toContain("Ship the billing report");
    expect(instructions).toContain(REFINEMENT_BLOCK_TAG);
  });

  it("tells the model that before is checked against disk", () => {
    expect(refinementInstructions(ITEMS)).toMatch(/checked against the item on/i);
  });

  it("handles a project with no items", () => {
    expect(refinementInstructions([])).toContain("(none)");
  });
});

describe("stalenessOf", () => {
  const proposal = {
    id: "refinement-1",
    kind: "description" as const,
    itemId: "item-1",
    itemTitle: ITEM.title,
    rationale: "",
    before: ["Generate the monthly invoice report."],
    after: ["Something else."],
  };

  it("is fresh when the item still says what the model was shown", () => {
    expect(stalenessOf(proposal, ITEM)).toEqual({ stale: false });
  });

  it("is stale when the item's text has changed underneath it", () => {
    const edited = { ...ITEM, description: "Someone rewrote this in the meantime." };

    const result = stalenessOf(proposal, edited);
    expect(result.stale).toBe(true);
    expect(result.stale && result.reason).toMatch(/has changed since this was proposed/i);
  });

  it("is stale when the item is gone", () => {
    const result = stalenessOf(proposal, null);

    expect(result.stale).toBe(true);
    expect(result.stale && result.reason).toMatch(/no longer exists/i);
  });

  it("tolerates reformatting — a rewrap is not a rewrite", () => {
    const rewrapped = { ...ITEM, description: "Generate   the monthly\ninvoice report." };

    expect(stalenessOf(proposal, rewrapped)).toEqual({ stale: false });
  });

  it("compares the field the proposal targets, not the whole item", () => {
    // A priority change must not be refused because someone edited the
    // description.
    const priorityProposal = { ...proposal, kind: "priority" as const, before: ["medium"], after: ["high"] };
    const edited = { ...ITEM, description: "Totally different." };

    expect(stalenessOf(priorityProposal, edited)).toEqual({ stale: false });
  });

  it("compares the parent for a reparent proposal", () => {
    const move = { ...proposal, kind: "parent" as const, before: ["epic-1"], after: ["epic-2"] };

    expect(stalenessOf(move, ITEM, "epic-1")).toEqual({ stale: false });
    expect(stalenessOf(move, ITEM, "epic-9").stale).toBe(true);
  });
});

describe("currentValue", () => {
  it("renders each field the way the model was asked to render it", () => {
    expect(currentValue(ITEM, "description")).toEqual(["Generate the monthly invoice report."]);
    expect(currentValue(ITEM, "acceptanceCriteria")).toEqual(["Report renders", "Totals reconcile"]);
    expect(currentValue(ITEM, "priority")).toEqual(["medium"]);
    expect(currentValue(ITEM, "parent", "epic-1")).toEqual(["epic-1"]);
  });

  it("treats an unset description as empty rather than undefined", () => {
    expect(currentValue({ ...ITEM, description: undefined }, "description")).toEqual([]);
  });

  it("defaults an unset priority the way rex does", () => {
    expect(currentValue({ ...ITEM, priority: undefined }, "priority")).toEqual(["medium"]);
  });
});
