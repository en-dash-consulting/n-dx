import { describe, it, expect, vi } from "vitest";
import { ChangePlacementError, draftPlacement, recordProposal } from "../../../src/core/change-place.js";
import type { PlacementModel } from "../../../src/core/placement.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";

const node = (fields: Record<string, unknown>): RuleNode => ({ slug: fields.id as string, ...fields }) as RuleNode;
const NOW = new Date("2026-10-09T00:00:00.000Z");

const tree = (changeFields: Record<string, unknown> = {}): V2Tree => ({
  product: [
    node({
      id: "pay",
      type: "area",
      title: "Payments",
      children: [
        node({ id: "card", type: "capability", title: "Pay by card", statement: "A shopper pays for a basket with a card" }),
        node({ id: "refund", type: "capability", title: "Refund an order", statement: "Support refunds an order" }),
      ],
    }),
  ],
  changes: [node({ id: "ch", type: "change", displayId: "CH-1", title: "Add wallets to card payment", needsPlacement: true, ...changeFields })],
});

const proposing = (fields: Record<string, unknown>): PlacementModel =>
  async () => ({ propose: { delta: "added", type: "capability", target: "model-slug", title: "Pay by wallet", summary: "Wallets", ...fields } as never });

describe("draftPlacement", () => {
  it("returns the model's pick with the rules shortlist, and passes the live areas", async () => {
    const model = vi.fn<PlacementModel>(async () => "card");
    const d = await draftPlacement(tree(), "CH-1", model);
    expect(d).toMatchObject({ change: "ch", relation: "amends", pick: "card", warnings: [] });
    expect(d.shortlist[0]).toMatchObject({ target: "card", relation: "amends", strength: expect.any(String) });
    expect(d.proposal).toBeUndefined();
    expect(model.mock.calls[0]![0].areas).toEqual([{ id: "pay", title: "Payments" }]);
  });

  it("drops a pick that is not on the shortlist", async () => {
    const d = await draftPlacement(tree(), "ch", async () => "nowhere");
    expect(d.pick).toBeUndefined();
    expect(d.warnings).toEqual([expect.stringContaining('"nowhere"')]);
  });

  it("returns a proposal without the model's target, which recordProposal accepts with a minted id", async () => {
    const t = tree();
    const before = structuredClone(t);
    const model = proposing({ under: "pay", summary: "Wallets", proposed: "A shopper pays with a wallet", criteria: { add: [{ id: "c1", text: "Apple Pay" }] } });
    const d = await draftPlacement(t, "ch", model);
    expect(d.proposal).toEqual({
      type: "capability",
      under: "pay",
      title: "Pay by wallet",
      summary: "Wallets",
      proposed: "A shopper pays with a wallet",
      criteria: { add: [{ id: "c1", text: "Apple Pay" }] },
    });
    expect(d.proposal).not.toHaveProperty("target");
    expect(d.pick).toBeUndefined();
    expect(t).toEqual(before);

    const accepted = recordProposal(t, "ch", d.proposal!, NOW, { newId: () => "minted" });
    expect(accepted.proposal.target).toBe("minted");
  });

  it("keeps only added criteria on a proposal, with a warning", async () => {
    const d = await draftPlacement(tree(), "ch", proposing({ under: "pay", criteria: { add: [{ id: "c1", text: "x" }], remove: ["c9"] } }));
    expect(d.proposal?.criteria).toEqual({ add: [{ id: "c1", text: "x" }] });
    expect(d.warnings).toEqual([expect.stringContaining("remove")]);
  });

  it("drops criteria from a constraint proposal, with a warning", async () => {
    const d = await draftPlacement(tree(), "ch", proposing({ type: "constraint", under: "pay", criteria: { add: [{ id: "c1", text: "x" }] } }));
    expect(d.proposal).toMatchObject({ type: "constraint", title: "Pay by wallet" });
    expect(d.proposal).not.toHaveProperty("criteria");
    expect(d.warnings).toEqual([expect.stringContaining("constraint")]);
  });

  it("drops a proposal under an unknown area with a warning", async () => {
    const d = await draftPlacement(tree(), "ch", proposing({ under: "nope" }));
    expect(d.proposal).toBeUndefined();
    expect(d.warnings).toEqual([expect.stringContaining('"nope", which is not a known area')]);
  });

  it("propagates a model error and leaves the tree alone", async () => {
    const t = tree();
    const before = structuredClone(t);
    await expect(draftPlacement(t, "ch", async () => { throw new Error("placement response is not JSON"); })).rejects.toThrow(/not JSON/);
    expect(t).toEqual(before);
  });

  it("returns the rules shortlist alone without a model", async () => {
    const d = await draftPlacement(tree(), "ch");
    expect(d.shortlist.length).toBeGreaterThan(0);
    expect(d).not.toHaveProperty("pick");
    expect(d).not.toHaveProperty("proposal");
  });

  it("refuses an applied change without asking the model", async () => {
    const model = vi.fn<PlacementModel>(async () => "card");
    const applied = tree({ status: "completed", completedAt: "2026-10-01T00:00:00.000Z", appliedAt: "2026-10-01T00:00:00.000Z" });
    await expect(draftPlacement(applied, "ch", model)).rejects.toMatchObject({ kind: "applied-change-amends" });
    expect(model).not.toHaveBeenCalled();
    await expect(draftPlacement(tree(), "missing", model)).rejects.toBeInstanceOf(ChangePlacementError);
  });
});
