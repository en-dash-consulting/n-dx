import { describe, it, expect } from "vitest";
import { applyAmendmentsProblems } from "../../../src/core/apply-amendments.js";
import { ChangePlacementError, recordPlacement, recordProposal, suggestPlacement } from "../../../src/core/change-place.js";
import { placementStrength } from "../../../src/core/placement.js";
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

  const twins = (second: string): V2Tree => ({
    product: [
      node({
        id: "area",
        type: "area",
        title: "Area",
        children: [
          node({ id: "zeta", type: "capability", title: "Ledger export" }),
          node({ id: "alpha", type: "capability", title: second }),
        ],
      }),
    ],
    changes: [node({ id: "ch", type: "change", title: "Ledger export speed", needsPlacement: true })],
  });

  it("reports tied when the top two candidates share a score, even with a shortlist of one", () => {
    const s = suggestPlacement(twins("Ledger export"), "ch");
    expect(s.tied).toBe(true);
    expect(s.shortlist.map((c) => c.target)).toEqual(["alpha", "zeta"]);
    expect(suggestPlacement(twins("Ledger export"), "ch", 1)).toMatchObject({ tied: true, shortlist: [{ target: "alpha" }] });
  });

  it("reports not tied when one candidate leads, or only one matched", () => {
    expect(suggestPlacement(twins("Ledger"), "ch").tied).toBe(false);
    expect(suggestPlacement(twins("Unrelated"), "ch")).toMatchObject({ tied: false, shortlist: [{ target: "zeta" }] });
    expect(suggestPlacement(twins("Unrelated"), "ch").shortlist).toHaveLength(1);
  });

  it("gives each candidate the strength band of its score", () => {
    const s = suggestPlacement(twins("Ledger"), "ch");
    expect(s.shortlist.map((c) => [c.target, c.score, c.strength])).toEqual([
      ["zeta", 2, "weak"],
      ["alpha", 1, "weak"],
    ]);
    for (const c of suggestPlacement(tree(), "ch").shortlist) expect(c.strength).toBe(placementStrength(c.score));
  });
});

describe("recordPlacement", () => {
  it("adds a touches target and clears needsPlacement, leaving the input tree alone", () => {
    const input = tree();
    const placed = recordPlacement(input, "CH-1", { target: "A1.1", relation: "touches" }, NOW);
    const { tree: next, placement, change } = placed;
    expect({ change, placement }).toEqual({ change: "ch", placement: { target: "card", relation: "touches" } });
    expect(changeIn(next)).toMatchObject({ touches: ["card"] });
    expect(changeIn(next)).not.toHaveProperty("needsPlacement");
    expect(placed).toMatchObject({ warnings: [], pending: [], blockedBy: [] });
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

// recordPlacement's pending/blockedBy branch is defensive: place writes only
// modified amendments, pending comes only from removals, and pending that
// existed before the placement is filtered. These pin why it is empty today.
describe("recordPlacement pending and blockedBy", () => {
  const withChanges = (chFields: Record<string, unknown>, others: RuleNode[]): V2Tree => {
    const t = tree(chFields);
    t.changes.push(...others);
    return t;
  };
  const removal = (id: string, target: string) =>
    node({ id, type: "change", displayId: id.toUpperCase(), title: `Remove ${target}`, amends: [{ target, delta: "removed", summary: "gone" }] });

  it("returns no problems when it modifies a capability another open change removes", () => {
    const placed = recordPlacement(withChanges({}, [removal("rm", "card")]), "ch", { target: "card", proposed: "Cards and wallets" }, NOW);
    expect(placed).toMatchObject({ warnings: [], pending: [], blockedBy: [] });
    expect(changeIn(placed.tree).amends).toHaveLength(1);
  });

  it("refuses, rather than stores with pending warnings, a modify on a descendant of a node under a pending removal", () => {
    const t = withChanges(
      // The change retires the whole area, so only card, which rm removes, keeps the removal pending.
      { amends: ["pay", "refund", "arch"].map((target) => ({ target, delta: "removed", summary: "retire payments" })) },
      [removal("rm", "card")],
    );
    expect(applyAmendmentsProblems(t, "ch", NOW)).toMatchObject({ always: [], blockedBy: ["RM"] });
    expect(() => recordPlacement(t, "ch", { target: "card", proposed: "Cards and wallets" }, NOW)).toThrow(ChangePlacementError);
    expect(() => recordPlacement(t, "ch", { target: "card", proposed: "Cards and wallets" }, NOW)).toThrow(/Cannot place change CH-1/);
  });
});

describe("recordProposal", () => {
  const ID = "new-node";
  const opts = { newId: () => ID };
  const wallets = { type: "capability" as const, under: "pay", title: "Pay by wallet", proposed: "A shopper pays with a wallet" };
  const refusal = (fn: () => unknown): ChangePlacementError | undefined => {
    try {
      fn();
    } catch (e) {
      return e as ChangePlacementError;
    }
    return undefined;
  };

  it("appends an added amendment under the area, clears needsPlacement and leaves the input tree alone", () => {
    const input = tree();
    const before = structuredClone(input);
    const criteria = { add: [{ id: "c1", text: "Apple Pay is accepted" }] };
    const result = recordProposal(input, "CH-1", { ...wallets, criteria }, NOW, opts);
    const amendment = { target: ID, delta: "added", type: "capability", under: "pay", title: "Pay by wallet", summary: "Add wallets to card payment", proposed: "A shopper pays with a wallet", criteria };
    expect(result).toMatchObject({ change: "ch", proposal: amendment, warnings: [], pending: [], blockedBy: [] });
    expect(changeIn(result.tree).amends).toEqual([amendment]);
    expect(changeIn(result.tree)).not.toHaveProperty("needsPlacement");
    expect(input).toEqual(before);
    // A proposal only: nothing reaches the product layer until the change is applied.
    expect(result.tree.product).toEqual(input.product);
  });

  it("resolves the area by display id, keeps a given summary and mints a fresh id by default", () => {
    const t = tree();
    t.product[0].displayId = "A1";
    const input = { type: "constraint" as const, under: "A1", title: " Wallet tokens stay server-side ", summary: "Guard tokens", proposed: "Tokens never reach the browser" };
    const { proposal } = recordProposal(t, "ch", input, NOW);
    expect(proposal).toMatchObject({ type: "constraint", under: "pay", title: "Wallet tokens stay server-side", summary: "Guard tokens" });
    expect(proposal.target).toMatch(/^[0-9a-f-]{36}$/);
    expect(recordProposal(t, "ch", wallets, NOW).proposal.target).not.toBe(proposal.target);
  });

  it("appends after the change's earlier amendments", () => {
    const earlier = { amends: [{ target: "card", delta: "modified", summary: "s", proposed: "Cards" }] };
    const { tree: next } = recordProposal(tree(earlier), "ch", wallets, NOW, opts);
    expect(changeIn(next).amends!.map((a) => a.delta)).toEqual(["modified", "added"]);
  });

  it.each([
    ["not-an-area", "a capability under", {}, { ...wallets, under: "card" }, /"card" is not a live area/],
    ["not-an-area", "an unknown under", {}, { ...wallets, under: "nope" }, /"nope" is not a live area/],
    ["empty-title", "a blank title", {}, { ...wallets, title: "  " }, /needs a title/],
    ["change-not-open", "an applied change", { status: "completed", appliedAt: "2026-10-01T00:00:00.000Z" }, wallets, /is applied at 2026-10-01/],
    ["change-not-open", "a cancelled change", { status: "cancelled" }, wallets, /is cancelled; only an open change is placed/],
    ["invalid-proposal", "a type that is neither capability nor constraint", {}, { ...wallets, type: "area" as never }, /The proposal is not a valid amendment \(type: /],
    ["rule-errors", "a new node on a fix change", { fix: true }, wallets, /Cannot place change CH-1/],
    ["apply-problems", "a criterion added twice", {}, { ...wallets, criteria: { add: [{ id: "c1", text: "a" }, { id: "c1", text: "b" }] } }, /Cannot propose for change CH-1: .*criterion c1 is added twice/],
    ["apply-problems", "capability criteria on a constraint", {}, { ...wallets, type: "constraint" as const, criteria: { add: [{ id: "c1", text: "a" }] } }, /Cannot propose for change CH-1: .*has no capability criteria/],
  ])("refuses with %s: %s", (kind, _label, changeFields, input, message) => {
    const err = refusal(() => recordProposal(tree(changeFields), "ch", input, NOW, opts));
    expect(err).toBeInstanceOf(ChangePlacementError);
    expect(err!.kind).toBe(kind);
    expect(err!.plain).toMatch(message);
    expect(err!.plain).not.toMatch(/get_product/);
  });

  describe("a repeat proposal", () => {
    const first = () => recordProposal(tree(), "ch", wallets, NOW, opts).tree;
    const repeat = (input: Record<string, unknown>) => refusal(() => recordProposal(first(), "ch", { ...wallets, ...input } as typeof wallets, NOW, { newId: () => "other" }));

    it.each([
      ["the same title", {}],
      ["the title trimmed and in another case", { title: "  PAY BY WALLET " }],
      ["the area given by alias or display id", { under: "A1" }],
    ])("is refused for %s, naming the title and the area", (_label, input) => {
      const t = first();
      t.product[0].displayId = "A1";
      const err = refusal(() => recordProposal(t, "ch", { ...wallets, ...input }, NOW, { newId: () => "other" }));
      expect(err).toBeInstanceOf(ChangePlacementError);
      expect(err!.kind).toBe("already-proposed");
      expect(err!.plain).toContain('"Pay by wallet"');
      expect(err!.plain).toContain('"Payments"');
      expect(changeIn(t).amends).toHaveLength(1);
    });

    it("is refused when the stored amendment names the area by display id", () => {
      const t = tree({ amends: [{ target: "x", delta: "added", type: "capability", under: "A1", title: "Pay by wallet", summary: "s" }] });
      t.product[0].displayId = "A1";
      expect(refusal(() => recordProposal(t, "ch", wallets, NOW))!.kind).toBe("already-proposed");
    });

    it.each([
      ["a different title", { title: "Pay by bank transfer" }],
      ["a different type", { type: "constraint" as const }],
    ])("is allowed with %s", (_label, input) => {
      expect(repeat(input)).toBeUndefined();
    });

    it("is allowed under a different area", () => {
      const t = first();
      t.product.push(node({ id: "ship", type: "area", title: "Shipping", children: [] }));
      const { tree: next } = recordProposal(t, "ch", { ...wallets, under: "ship" }, NOW, { newId: () => "other" });
      expect(changeIn(next).amends).toHaveLength(2);
    });
  });

  it("names get_product only in the MCP wording of an under that is not an area", () => {
    expect(refusal(() => recordProposal(tree(), "ch", { ...wallets, under: "nope" }, NOW))!.message).toMatch(/\(see get_product\)$/);
  });
});
