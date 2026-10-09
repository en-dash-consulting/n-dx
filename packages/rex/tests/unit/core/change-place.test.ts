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
        node({
          id: "card",
          type: "capability",
          displayId: "A1.1",
          title: "Pay by card",
          statement: "A shopper pays for a basket with a card",
          criteria: [{ id: "c1", text: "Visa is accepted" }, { id: "c2", text: "A declined card shows why" }],
        }),
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
    const { tree: next, placement } = recordPlacement(t, "ch", { target: "card", proposed: "Cards and wallets" }, NOW);
    expect(placement.relation).toBe("amends");
    const card = indexTree(t).resolve("card")!;
    expect(changeIn(next).amends).toEqual([
      { target: "card", delta: "modified", summary: "Add wallets to card payment", proposed: "Cards and wallets", base: specHash(nodeSpec(card)) },
    ]);
    expect(changeIn(next)).not.toHaveProperty("touches");
  });

  it("uses a given summary", () => {
    const { tree: next } = recordPlacement(tree(), "ch", { target: "card", relation: "amends", summary: "Wallets count as cards", proposed: "Cards and wallets" }, NOW);
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
    // Apply refuses these (in these words), and no tool edits the amendment afterwards.
    ["a summary-only amends placement", {}, { target: "card", relation: "amends" as const }, /nothing to modify.*Pass proposed or criteria, or use relation touches/],
    ["a criteria delta on a constraint", {}, { target: "arch", relation: "amends" as const, criteria: { remove: ["c1"] } }, /amendment 1 \(modified arch\): a constraint has no capability criteria/],
    ["removing a criterion the capability lacks", {}, { target: "A1.1", relation: "amends" as const, criteria: { remove: ["c7"] } }, /criterion c7 to remove does not exist/],
    ["replacing a criterion the capability lacks", {}, { target: "A1.1", relation: "amends" as const, criteria: { replace: [{ id: "c7", text: "x" }] } }, /criterion c7 to replace does not exist/],
    ["adding a criterion the capability has", {}, { target: "A1.1", relation: "amends" as const, criteria: { add: [{ id: "c1", text: "x" }] } }, /criterion c1 to add already exists/],
  ])("refuses %s", (_label, changeFields, input, message) => {
    expect(() => recordPlacement(tree(changeFields), "ch", input, NOW)).toThrow(ChangePlacementError);
    expect(() => recordPlacement(tree(changeFields), "ch", input, NOW)).toThrow(message);
  });

  it.each([
    ["not-a-target", {}, { target: "nope" }],
    ["already-amends", { amends: [{ target: "card", delta: "modified", summary: "s" }] }, { target: "A1.1", relation: "touches" as const }],
    ["change-not-open", { status: "cancelled" }, { target: "card" }],
    ["content-needs-amends", {}, { target: "card", relation: "touches" as const, proposed: "x" }],
    ["nothing-to-modify", {}, { target: "card", relation: "amends" as const }],
    ["apply-problems", {}, { target: "A1.1", relation: "amends" as const, criteria: { remove: ["c7"] } }],
  ])("tags the %s refusal with its kind", (kind, changeFields, input) => {
    const err = (() => { try { recordPlacement(tree(changeFields), "ch", input, NOW); } catch (e) { return e as ChangePlacementError; } })();
    expect(err?.kind).toBe(kind);
  });

  it("tags an unknown change, and keeps the MCP-only wording out of `plain`", () => {
    const unknown = (() => { try { recordPlacement(tree(), "zz", { target: "card" }, NOW); } catch (e) { return e as ChangePlacementError; } })();
    expect(unknown?.kind).toBe("no-such-change");
    const bad = (() => { try { recordPlacement(tree(), "ch", { target: "nope" }, NOW); } catch (e) { return e as ChangePlacementError; } })()!;
    expect(bad.message).toMatch(/\(see get_product\)$/);
    expect(bad.plain).not.toMatch(/get_product/);
  });

  it("names every criterion id that does not fit in one refusal", () => {
    const criteria = { remove: ["c7"], replace: [{ id: "c8", text: "x" }], add: [{ id: "c2", text: "x" }] };
    expect(() => recordPlacement(tree(), "ch", { target: "card", relation: "amends", criteria }, NOW)).toThrow(
      /c7 to remove does not exist; .*c8 to replace does not exist; .*c2 to add already exists/,
    );
  });

  it("records a criteria delta that fits the capability", () => {
    const criteria = { remove: ["c2"], replace: [{ id: "c1", text: "Visa and wallets are accepted" }], add: [{ id: "c3", text: "x" }] };
    const { tree: next } = recordPlacement(tree(), "ch", { target: "card", relation: "amends", criteria }, NOW);
    expect(changeIn(next).amends![0]).toMatchObject({ target: "card", delta: "modified", criteria });
  });

  it("names the refused amendment by its place among the change's amends, as apply does", () => {
    const earlier = { amends: [{ target: "refund", delta: "modified", summary: "s", criteria: { add: [{ id: "c3", text: "x" }] } }] };
    expect(() => recordPlacement(tree(earlier), "ch", { target: "card", relation: "amends", criteria: { remove: ["c3"] } }, NOW)).toThrow(
      /amendment 2 \(modified card\): criterion c3 to remove does not exist/,
    );
  });

  it("judges only the amendment it records, not the change's earlier ones", () => {
    const broken = { amends: [{ target: "arch", delta: "modified", summary: "s", criteria: { add: [{ id: "c1", text: "x" }] } }] };
    const { tree: next } = recordPlacement(tree(broken), "ch", { target: "card", relation: "amends", proposed: "Cards and wallets" }, NOW);
    expect(changeIn(next).amends).toHaveLength(2);
  });

  it("never stamps the tree: the dry run's apply is discarded", () => {
    const input = tree();
    const { tree: next } = recordPlacement(input, "ch", { target: "card", relation: "amends", criteria: { add: [{ id: "c3", text: "x" }] } }, NOW);
    expect(changeIn(next)).not.toHaveProperty("appliedAt");
    expect(indexTree(next).resolve("card")).toEqual(indexTree(input).resolve("card"));
    expect(indexTree(next).resolve("card")).not.toHaveProperty("metAt");
  });

  it("refuses a ref that is not a change", () => {
    expect(() => suggestPlacement(tree(), "card")).toThrow(/No live change "card"/);
  });
});
