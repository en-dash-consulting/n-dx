// @vitest-environment jsdom
/**
 * Ghosts outside the tree (SP5): a waiting change-set card's changes show as
 * dashed rows in Open changes, "+N" markers on the blocks they target and a
 * "+N waiting on a card" note on the strip. Real counts never include them,
 * and with no card (denied, or approved and written) nothing extra is drawn.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { GhostCardsContext, ghostChanges, ghostCountsByTarget, ghostStripCounts } from "../../../src/viewer/components/ghost-changes.js";
import type { GhostSource } from "../../../src/viewer/components/prd-tree/ghost-rows.js";
import { areaBlocks } from "../../../src/viewer/views/product-area-map.js";
import { ChangesGlance } from "../../../src/viewer/views/changes-glance.js";
import { LifecycleStrip, v2Cells } from "../../../src/viewer/views/lifecycle-strip.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { ProductAreaMap } from "../../../src/viewer/views/product-area-map.js";
import type { AreaSection, ChangeSummary, ProductMap } from "../../../src/viewer/views/product-model.js";

vi.mock("../../../src/viewer/hooks/use-project-status.js", async (orig) => ({ ...(await orig<object>()), useProjectStatus: () => null }));

const PLACED: GhostSource = {
  id: "card-1",
  changeSet: {
    layout: "v2",
    placement: { target: "cap-1", title: "Checkout" },
    items: [
      { title: "Add refunds", type: "change" },
      { title: "Refund form", type: "task", parent: 0 },
    ],
  },
};
const INBOX: GhostSource = {
  id: "card-2",
  changeSet: { layout: "v2", placement: { inbox: true }, items: [{ title: "Loose idea", type: "change" }] },
};

const SUMMARY: ChangeSummary = {
  inbox: 3,
  stages: { proposed: 4, ready: 0, "in-progress": 2, "awaiting-apply": 1 },
  open: [],
  requirements: { total: 0, uncovered: 0 },
  next: null,
} as unknown as ChangeSummary;

const AREA = (id: string, caps: string[]): AreaSection => ({
  id,
  slug: id,
  title: id,
  capabilities: caps.map((c) => ({ id: c, title: c, status: "met", health: "ok", criteriaCount: 0, openChanges: [] })),
  openChangeIds: [],
}) as unknown as AreaSection;

describe("ghost helpers", () => {
  it("lists v2 changes, not their tasks, and ignores v1 cards", () => {
    const v1: GhostSource = { id: "v1", changeSet: { layout: "v1", items: [{ title: "Epic", type: "change" }] } };
    expect(ghostChanges([PLACED, INBOX, v1]).map((g) => g.title)).toEqual(["Add refunds", "Loose idea"]);
  });

  it("counts every item once against the node it targets", () => {
    const counts = ghostCountsByTarget([PLACED, INBOX]);
    expect(counts.get("cap-1")).toBe(2);
    expect(counts.size).toBe(1);
  });

  it("an item's own parentId outranks the card's placement", () => {
    const card: GhostSource = { id: "c", changeSet: { layout: "v2", placement: { target: "cap-1", title: "x" }, items: [{ title: "a", type: "change", parentId: "cap-2" }] } };
    expect(ghostCountsByTarget([card]).get("cap-2")).toBe(1);
  });

  it("splits the strip note between Inbox and Proposed", () => {
    expect(ghostStripCounts([PLACED, INBOX])).toEqual({ inbox: 1, proposed: 1 });
    expect(ghostStripCounts([])).toEqual({ inbox: 0, proposed: 0 });
  });

  it("puts waiting counts on map blocks through an area or its capabilities", () => {
    const blocks = areaBlocks([AREA("a1", ["cap-1", "cap-9"]), AREA("a2", ["cap-2"])], ghostCountsByTarget([PLACED]));
    expect(blocks.map((b) => b.ghosts)).toEqual([2, 0]);
  });

  it("never touches the real strip counts", () => {
    const cells = v2Cells(SUMMARY, { inbox: 1, proposed: 1 });
    expect(cells.map((c) => c.count)).toEqual([3, 4, 0, 2, 1]);
    expect(cells.map((c) => c.waiting)).toEqual([1, 1, 0, 0, 0]);
  });
});

describe("the Plan surfaces", () => {
  let root: HTMLElement;
  const navigateTo = vi.fn();

  beforeEach(() => { root = document.createElement("div"); document.body.append(root); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  async function mount(view: unknown, cards: GhostSource[], body: unknown) {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
    // The Plan grid reads the summary once and shares it; the strip and glance read it from there.
    await act(async () => { render(h(GhostCardsContext.Provider, { value: cards }, h(ChangesSummaryProvider, null, view as never)), root); });
    await act(async () => {});
  }

  it("Open changes draws a dashed row per waiting placed change, not Inbox-bound ones", async () => {
    await mount(h(ChangesGlance, { navigateTo }), [PLACED, INBOX], { summary: { ...SUMMARY, open: [] } });
    const rows = [...root.querySelectorAll(".cg-ghost")];
    expect(rows.map((r) => r.querySelector(".cg-title")?.textContent)).toEqual(["Add refunds"]);
    expect(rows[0].textContent).toContain("proposed · on a card");
  });

  it("Open changes draws nothing extra once the card is gone", async () => {
    await mount(h(ChangesGlance, { navigateTo }), [], { summary: { ...SUMMARY, open: [] } });
    expect(root.querySelector(".cg-ghost")).toBeNull();
    expect(root.textContent).toContain("No open changes.");
  });

  it("the strip notes the waiting changes and keeps its counts", async () => {
    await mount(h(LifecycleStrip, { navigateTo }), [PLACED, INBOX], { summary: SUMMARY });
    const note = (stage: string) => root.querySelector(`[data-stage="${stage}"] .ls-waiting`)?.textContent;
    expect(note("inbox")).toBe("+1 waiting on a card");
    expect(note("proposed")).toBe("+1 waiting on a card");
    expect(note("ready")).toBeUndefined();
    expect(root.querySelector('[data-stage="inbox"] .ls-number')?.textContent).toBe("3");
    expect(root.querySelector('[data-stage="proposed"] .ls-number')?.textContent).toBe("4");
  });

  it("the map marks the block a waiting item targets", async () => {
    const map: ProductMap = { areas: [AREA("a1", ["cap-1"]), AREA("a2", ["cap-2"])], constraints: [] };
    await mount(h(ProductAreaMap, { onOpenArea: vi.fn() }), [PLACED], { map });
    expect(root.querySelector('[data-block="a1"] .pam-ghost-mark')?.textContent).toBe("+2");
    expect(root.querySelector('[data-block="a2"] .pam-ghost-mark')).toBeNull();
    expect(root.querySelector('[data-block="a1"] .pam-open')).toBeNull();
  });
});
