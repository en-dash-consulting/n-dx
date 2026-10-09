import { describe, it, expect } from "vitest";
import { ChangePlacementError, recordPlacement, suggestPlacement } from "../../../src/core/change-place.js";
import { indexTree, nodeSpec, specHash, type RuleNode, type V2Tree } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ slug: fields.id as string, ...fields }) as RuleNode;
const NOW = new Date("2026-10-09T00:00:00.000Z");

const tree = (changeFields: Record<string, unknown> = {}): V2Tree => ({
  product: [
    node({
      id: "pay",
      type: "area",
      title: "Payments",
      children: [
        node({ id: "card", type: "capability", displayId: "A1.1", title: "Pay by card", statement: "A shopper pays for a basket with a card" }),
        node({ id: "refund", type: "capability", title: "Refund an order", statement: "Support refunds an order" }),
        node({ id: "arch", type: "constraint", title: "Architecture", tags: ["architecture"], statement: "Layers import downward" }),
      ],
    }),
  ],
  changes: [
    node({ id: "ch", type: "change", displayId: "CH-1", title: "Add wallets to card payment", needsPlacement: true, ...changeFields }),
  ],
});

const changeIn = (t: V2Tree) => indexTree(t).resolve("ch")!;

describe("suggestPlacement", () => {
  it("ranks capabilities and constraints with the rules and names the relation", () => {
    const s = suggestPlacement(tree(), "CH-1");
    expect(s.change).toBe("ch");
    expect(s.relation).toBe("amends");
    expect(s.shortlist[0]).toMatchObject({ target: "card", relation: "amends" });
    expect(s.shortlist.map((c) => c.target)).not.toContain("pay");
  });

  it("ranks the architecture constraint first for a code-health change, which touches", () => {
    const s = suggestPlacement(tree({ title: "Split the store module", tags: ["code-health"] }), "ch");
    expect(s.relation).toBe("touches");
    expect(s.shortlist[0]).toMatchObject({ target: "arch", relation: "touches" });
  });
});

describe("recordPlacement", () => {
  it("adds a touches target and clears needsPlacement, leaving the input tree alone", () => {
    const input = tree();
    const { tree: next, placement, change } = recordPlacement(input, "CH-1", { target: "A1.1", relation: "touches" }, NOW);
    expect({ change, placement }).toEqual({ change: "ch", placement: { target: "card", relation: "touches" } });
    expect(changeIn(next)).toMatchObject({ touches: ["card"] });
    expect(changeIn(next)).not.toHaveProperty("needsPlacement");
    expect(changeIn(input).needsPlacement).toBe(true);
  });

  it("adds a modified amendment with base and the title as summary when the rules say amends", () => {
    const t = tree({ touches: ["card"] });
    const { tree: next, placement } = recordPlacement(t, "ch", { target: "card" }, NOW);
    expect(placement.relation).toBe("amends");
    const card = indexTree(t).resolve("card")!;
    expect(changeIn(next).amends).toEqual([{ target: "card", delta: "modified", summary: "Add wallets to card payment", base: specHash(nodeSpec(card)) }]);
    expect(changeIn(next)).not.toHaveProperty("touches");
  });

  it("uses a given summary", () => {
    const { tree: next } = recordPlacement(tree(), "ch", { target: "card", relation: "amends", summary: "Wallets count as cards" }, NOW);
    expect(changeIn(next).amends![0].summary).toBe("Wallets count as cards");
  });

  it("records proposed text on an amendment of a constraint", () => {
    const { tree: next } = recordPlacement(tree(), "ch", { target: "arch", relation: "amends", proposed: "Layers import downward only" }, NOW);
    expect(changeIn(next).amends![0]).toMatchObject({ target: "arch", delta: "modified", proposed: "Layers import downward only" });
  });

  it("leaves a target it already touches touched once", () => {
    const { tree: next } = recordPlacement(tree({ touches: ["card"] }), "ch", { target: "card", relation: "touches" }, NOW);
    expect(changeIn(next).touches).toEqual(["card"]);
  });

  it.each([
    ["an area target", {}, { target: "pay" }, /not a live capability or constraint/],
    ["an unknown target", {}, { target: "nope" }, /not a live capability or constraint/],
    ["a target it already amends", { amends: [{ target: "card", delta: "modified", summary: "s" }] }, { target: "A1.1", relation: "touches" as const }, /already amends "Pay by card"/],
    ["an applied change", { status: "completed", appliedAt: "2026-10-01T00:00:00.000Z" }, { target: "card" }, /is applied at 2026-10-01/],
    ["a cancelled change", { status: "cancelled" }, { target: "card" }, /is cancelled; only an open change is placed/],
    ["proposed on a touches placement", {}, { target: "card", relation: "touches" as const, proposed: "x" }, /relation amends/],
    ["a criteria delta on a constraint", {}, { target: "arch", relation: "amends" as const, criteria: { remove: ["c1"] } }, /constraint, which has no criteria; state it in proposed/],
  ])("refuses %s", (_label, changeFields, input, message) => {
    expect(() => recordPlacement(tree(changeFields), "ch", input, NOW)).toThrow(ChangePlacementError);
    expect(() => recordPlacement(tree(changeFields), "ch", input, NOW)).toThrow(message);
  });

  it("refuses a ref that is not a change", () => {
    expect(() => suggestPlacement(tree(), "card")).toThrow(/No live change "card"/);
  });
});
