// @vitest-environment jsdom
/**
 * The placement picture's model: source → relation → target, why the target
 * was suggested, the target before and after, and the confirm label, for
 * touches, amends and a move.
 *
 * @see src/viewer/components/placement-preview.ts
 */
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import {
  PlacementPreview,
  movePreview,
  placePreview,
  reasonText,
  type PlacePreviewInput,
} from "../../../src/viewer/components/placement-preview.js";

const REFUNDS: PlacePreviewInput["target"] = {
  title: "Refunds",
  type: "capability",
  area: "Payments",
  statement: "Refund an order",
  criteria: [{ id: "c1", text: "a" }, { id: "c2", text: "b" }],
  strength: "strong",
  reasons: ["words: refund, order", "package: web"],
};

const place = (extra: Partial<PlacePreviewInput> = {}) =>
  placePreview({ changeTitle: "Partial refunds", target: REFUNDS, relation: "touches", suggested: true, ...extra });

describe("reasonText", () => {
  it("puts each rex rule in words and keeps an unknown one as it is", () => {
    expect(reasonText("words: refund, order")).toBe("Shares the words refund, order");
    expect(reasonText("path: src/pay")).toBe("Names the path src/pay");
    expect(reasonText("package: web")).toBe("Names the package web");
    expect(reasonText("file evidence: pay.ts")).toBe("Its files are named: pay.ts");
    expect(reasonText("something new")).toBe("something new");
  });
});

describe("placePreview — touches", () => {
  it("draws change → touches → capability, with rex's strength and reasons", () => {
    const model = place();
    expect(model.relation).toBe("touches");
    expect(model.source).toEqual({ title: "Partial refunds", kind: "change", detail: "Inbox" });
    expect(model.target).toEqual({ title: "Refunds", kind: "capability", detail: "Payments" });
    expect(model.strength).toBe("strong");
    expect(model.why).toEqual(["Rex rates it a strong match", "Shares the words refund, order", "Names the package web"]);
  });

  it("leaves the statement and criteria alone and adds a touching change", () => {
    const model = place();
    expect(model.before).toEqual([{ text: "Statement: Refund an order" }, { text: "2 criteria" }]);
    expect(model.after).toEqual([
      { text: "Statement: Refund an order (unchanged)" },
      { text: "2 criteria (unchanged)" },
      { text: "Touched by Partial refunds", changed: true },
    ]);
    expect(model.action).toBe("Touch Refunds");
  });

  it("names rex's rule when the chosen relation is the rules' own, and a tie", () => {
    const model = place({ rule: { relation: "touches", text: "the change is a fix" }, tied: true });
    expect(model.why).toContain("Touches, by rex's rule: the change is a fix");
    expect(model.why).toContain("Tied with another match: their order means nothing");
    // The rule's relation is not the chosen one: it is not a reason for it.
    expect(place({ rule: { relation: "amends", text: "x" } }).why.some((w) => w.includes("rule"))).toBe(false);
  });

  it("says a search pick is the person's own, with no strength", () => {
    const model = place({ suggested: false });
    expect(model.strength).toBeUndefined();
    expect(model.why).toEqual(["Your pick: not on rex's shortlist"]);
  });

  it("says when the model picked it", () => {
    expect(place({ suggested: false, byModel: true }).why).toEqual(["Picked by the model"]);
  });
});

describe("placePreview — amends", () => {
  it("shows the replacement statement and the criteria count the edits leave", () => {
    const model = place({ relation: "amends", amendment: { proposed: "Refund part of an order", added: 2, replaced: 1, removed: 1 } });
    expect(model.after).toEqual([
      { text: "Statement: Refund part of an order", changed: true },
      { text: "3 criteria (+2 added, 1 reworded, −1 removed)", changed: true },
      { text: "Amended by Partial refunds when it is applied", changed: true },
    ]);
    expect(model.action).toBe("Amend Refunds");
  });

  it("keeps what an empty amendment leaves alone", () => {
    const model = place({ relation: "amends", amendment: { added: 0, replaced: 0, removed: 0 } });
    expect(model.after.slice(0, 2)).toEqual([
      { text: "Statement: Refund an order (unchanged)" },
      { text: "2 criteria (unchanged)" },
    ]);
  });

  it("names another open change amending the target, and marks the after-state uncertain", () => {
    const model = place({
      relation: "amends",
      target: { ...REFUNDS, amendedBy: ["C-12"] },
      amendment: { added: 1, replaced: 0, removed: 0 },
    });
    expect(model.why).toContain("Also amended by C-12");
    expect(model.after).toEqual([
      { text: "C-12 also amends it: the first to apply wins, and the other may be refused", caution: true },
      { text: "Statement: Refund an order (unchanged)" },
      { text: "3 criteria (+1 added)", caution: true },
      { text: "Amended by Partial refunds when it is applied", caution: true },
    ]);
    // No line is drawn as a plain change.
    expect(model.after.some((l) => l.changed)).toBe(false);
  });

  it("says nothing about other amenders for a touches", () => {
    const model = place({ target: { ...REFUNDS, amendedBy: ["C-12"] } });
    expect(model.why.some((w) => w.includes("C-12"))).toBe(false);
    expect(model.after.some((l) => l.caution)).toBe(false);
  });

  it("counts no criteria on a constraint", () => {
    const model = place({ relation: "amends", target: { title: "PCI scope", type: "constraint", area: "" } });
    expect(model.target).toEqual({ title: "PCI scope", kind: "constraint" });
    expect(model.before).toEqual([{ text: "No statement" }]);
    expect(model.after.map((l) => l.text)).toEqual(["No statement (unchanged)", "Amended by Partial refunds when it is applied"]);
  });
});

describe("placePreview — no relation yet", () => {
  it("draws the edge undecided, shows no after, and leaves the button Place", () => {
    const model = place({ relation: null });
    expect(model.relation).toBeNull();
    expect(model.after).toEqual([]);
    expect(model.action).toBe("Place");
  });
});

describe("movePreview", () => {
  it("draws item, old parent → new parent, the rationale and Move to", () => {
    const model = movePreview({ title: "Add export", kind: "task", from: "Search", to: "Checkout", rationale: "Checkout work" });
    expect(model).toEqual({
      relation: "move",
      source: { title: "Add export", kind: "task" },
      from: { title: "Search", kind: "parent" },
      target: { title: "Checkout", kind: "parent" },
      why: ["Checkout work"],
      before: [{ text: "Under Search" }],
      after: [{ text: "Under Checkout", changed: true }, { text: "No longer under Search", changed: true }],
      action: "Move to Checkout",
    });
  });

  it("says when no reason was given", () => {
    expect(movePreview({ title: "x", kind: "task", from: "a", to: "b" }).why).toEqual(["No reason was given"]);
  });
});

describe("PlacementPreview", () => {
  const draw = (model: ReturnType<typeof placePreview>) => {
    const root = document.createElement("div");
    render(h(PlacementPreview, { model }), root);
    return root;
  };

  it("draws touches and amends as distinct edges", () => {
    const touches = draw(place()).querySelector<HTMLElement>(".pp-edge")!;
    const amends = draw(place({ relation: "amends" })).querySelector<HTMLElement>(".pp-edge")!;
    expect(touches.dataset.relation).toBe("touches");
    expect(amends.dataset.relation).toBe("amends");
    expect(touches.textContent).toBe("touches");
    expect(amends.textContent).toBe("amends");
  });

  it("shows the strength chip, the reasons and the before/after", () => {
    const root = draw(place());
    expect(root.querySelector<HTMLElement>(".pp-why .inbox-strength")?.dataset.strength).toBe("strong");
    expect([...root.querySelectorAll(".pp-why li")].map((li) => li.textContent)).toContain("Shares the words refund, order");
    expect(root.querySelector(".pp-after li.is-changed")?.textContent).toBe("Touched by Partial refunds");
  });

  it("draws a cautioned line apart from a plain change", () => {
    const root = draw(place({ relation: "amends", target: { ...REFUNDS, amendedBy: ["C-12"] } }));
    expect(root.querySelectorAll(".pp-after li.is-changed")).toHaveLength(0);
    expect(root.querySelector(".pp-after li.is-caution")?.textContent).toContain("C-12 also amends it");
  });

  it("asks for a relation in place of the after", () => {
    const root = draw(place({ relation: null }));
    expect(root.querySelector<HTMLElement>(".pp")?.dataset.relation).toBe("unset");
    expect(root.querySelector(".pp-diff")).toBeNull();
    expect(root.querySelector(".pp-diff-pending")?.textContent).toBe("Choose Touches or Amends to see what changes.");
  });
});
