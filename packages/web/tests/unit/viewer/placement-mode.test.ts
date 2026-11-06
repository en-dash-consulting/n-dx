// @vitest-environment jsdom
/**
 * Placement mode: the route every Place opens (WF1), where it starts on the
 * map (WF2), and the breadcrumb that names the change being placed.
 *
 * @see src/viewer/views/placement-mode.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import type { VNode } from "preact";
import { act } from "preact/test-utils";
import {
  PlacementMode,
  areaCandidateNote,
  candidateNote,
  candidatesByArea,
  mapLevelNote,
  nearNotes,
  otherAreaCandidates,
  placementStart,
  placingLabel,
  sharedWords,
  targetOfRow,
} from "../../../src/viewer/views/placement-mode.js";
import { REFUSAL_HINTS, amendsEffect, relationQuestion, touchesEffect } from "../../../src/viewer/components/prd-tree/change-placement.js";
import { ProductPage } from "../../../src/viewer/views/product-pages.js";
import { parsePathnameRoute, placeChangeOfTab, placementTab, routeTab, viewPathname } from "../../../src/viewer/route-state.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { createWSPipeline } from "../../../src/viewer/hooks/use-gateway.js";
import type {
  AreaDetail,
  CapabilityRow,
  ChangePlacement,
  ChangeRow,
  PlacementCandidate,
  ProductMap,
} from "../../../src/viewer/views/product-model.js";
import type { SidecarPlacementCheck } from "../../../src/viewer/hooks/sidecar.js";
import { CHECK_DEBOUNCE_MS } from "../../../src/viewer/components/sidecar-placement.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const cap = (id: string, title: string, criteriaCount = 1): CapabilityRow =>
  ({ id, title, status: "met", health: "ok", criteriaCount, openChanges: [] });

const MAP: ProductMap = {
  areas: [
    { id: "area-pay", slug: "payments", title: "Payments", capabilities: [cap("cap-refund", "Refunds", 3), cap("cap-gift", "Gift cards")], openChangeIds: [] },
    { id: "area-ship", slug: "shipping", title: "Shipping", capabilities: [cap("cap-label", "Shipping labels")], openChangeIds: [] },
    { id: "area-tax", slug: "tax", title: "Tax", capabilities: [cap("cap-vat", "VAT")], openChangeIds: [] },
  ],
  constraints: [{ id: "con-pci", title: "PCI scope", health: "ok", appliesTo: "all" }],
};

function areaDetail(slug: string): AreaDetail {
  const area = MAP.areas.find((a) => a.slug === slug)!;
  return {
    id: area.id, slug, title: area.title, stewards: [],
    counts: { capabilities: area.capabilities.length, constraints: 0, met: area.capabilities.length, changing: 0, defective: 0, openChanges: 0 },
    capabilities: area.capabilities, constraints: [], openChanges: [], inbox: [], recentlyApplied: [], code: [],
  };
}

function change(id: string, extra: Partial<ChangeRow> = {}): ChangeRow {
  return {
    id, title: `Change ${id}`, stage: "proposed", awaitsPlacement: true, needsPlacement: true,
    amends: [], touches: [], taskCount: 1, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...extra,
  };
}

function candidate(target: string, extra: Partial<PlacementCandidate> = {}): PlacementCandidate {
  return { target, type: "capability", title: `Home ${target}`, area: "", criteria: [], score: 5, strength: "strong", reasons: [], ...extra };
}

function placement(id: string, shortlist: PlacementCandidate[], tied = false): ChangePlacement {
  return { layout: "v2", change: { id, title: `Change ${id}`, status: "pending", taskCount: 1 }, relation: "touches", relationRule: "r", tied, shortlist };
}

// ── Model ────────────────────────────────────────────────────────────

describe("the placement route", () => {
  const valid = buildValidViews(null);

  it("reads /product/place/<id> as the Product page in placement mode and writes it back", () => {
    const route = parsePathnameRoute("/product/place/change-a", valid);
    expect(route).toEqual({ view: "product", subId: "place/change-a" });
    expect(routeTab("product", route!.subId)).toBe("place/change-a");
    expect(placeChangeOfTab(route!.subId)).toBe("change-a");
    expect(viewPathname("product", placementTab("change-a"))).toBe("/product/place/change-a");
  });

  it("round-trips an id that needs encoding, and is null for any other tab", () => {
    expect(placeChangeOfTab(placementTab("a b/c"))).toBe("a b/c");
    expect(placeChangeOfTab("area/payments")).toBeNull();
    expect(placeChangeOfTab(null)).toBeNull();
    // A malformed escape in a hand-edited address names no change instead of throwing.
    expect(placeChangeOfTab("place/%E0%A4%A")).toBeNull();
    expect(routeTab("product", "place/a/extra")).toBeNull();
  });
});

describe("placementStart (WF2)", () => {
  it("zooms into the area of a strong, untied top pick", () => {
    expect(placementStart(placement("a", [candidate("cap-label"), candidate("cap-gift", { strength: "possible" })]), MAP))
      .toEqual({ level: "area", slug: "shipping", target: "cap-label" });
  });

  it("opens the area level for a possible, weak or tied shortlist, or none", () => {
    expect(placementStart(placement("a", [candidate("cap-label", { strength: "possible" })]), MAP)).toEqual({ level: "map" });
    expect(placementStart(placement("a", [candidate("cap-label", { strength: "weak" })]), MAP)).toEqual({ level: "map" });
    expect(placementStart(placement("a", [candidate("cap-label"), candidate("cap-vat")], true), MAP)).toEqual({ level: "map" });
    expect(placementStart(placement("a", []), MAP)).toEqual({ level: "map" });
  });

  it("opens the area level when the strong pick is a constraint, which sits under no area", () => {
    expect(placementStart(placement("a", [candidate("con-pci", { type: "constraint" })]), MAP)).toEqual({ level: "map" });
  });
});

describe("candidatesByArea", () => {
  it("groups the shortlist by area in the order each area's best ranks, keeping ranks, and skips constraints", () => {
    const groups = candidatesByArea([
      candidate("cap-label"), candidate("con-pci", { type: "constraint" }), candidate("cap-refund"), candidate("cap-gift"),
    ], MAP);
    expect(groups.map((g) => [g.area.slug, g.candidates.map((c) => [c.candidate.target, c.rank])])).toEqual([
      ["shipping", [["cap-label", 1]]],
      ["payments", [["cap-refund", 3], ["cap-gift", 4]]],
    ]);
  });
});

describe("labels", () => {
  it("counts an area's candidates, ranks a block, and names the change's place in the Inbox", () => {
    expect(areaCandidateNote(1)).toBe("1 candidate");
    expect(areaCandidateNote(2)).toBe("2 candidates");
    expect(candidateNote(1, { strength: "strong" }, false)).toBe("#1 · strong");
    expect(candidateNote(2, { strength: "strong" }, true)).toBe("#2 · tied");
    expect(candidateNote(3, { strength: "weak" }, true)).toBe("#3 · weak");
    expect(placingLabel(2, 19, "Condense")).toBe("Placing 3 of 19 · Condense");
    expect(placingLabel(-1, 0, "Condense")).toBe("Placing · Condense");
  });

  it("says why the map opened at the area level", () => {
    expect(mapLevelNote(null)).toBe("rex found no candidate. Pick an area, or search in the panel.");
    expect(mapLevelNote(null, "HTTP 500")).toBe("Could not read rex's shortlist: HTTP 500. Pick an area, or search in the panel.");
    expect(mapLevelNote(placement("a", [candidate("x"), candidate("y")], true))).toContain("tie");
    expect(mapLevelNote(placement("a", [candidate("x", { strength: "possible" })]))).toBe("None strong: the best is possible. Pick an area to compare its candidates in place.");
  });
});

describe("near blocks, map picks and other-area candidates", () => {
  it("shares only words of four letters or more that are not common ones", () => {
    expect(sharedWords("Print gift receipts with the refund", "Gift cards: refund to the card")).toEqual(["gift", "refund"]);
    expect(sharedWords("Add a tax line", "Tax on a line")).toEqual(["line"]);
  });

  it("marks capabilities off the shortlist that share words with the change, never a lit one", () => {
    const rows = [cap("cap-refund", "Refund receipts"), cap("cap-gift", "Gift cards"), { ...cap("cap-x", "Other"), statement: "Prints receipts" }];
    const near = nearNotes(rows, "Print gift receipts", new Set(["cap-refund"]));
    expect([...near]).toEqual([["cap-gift", "near · gift"], ["cap-x", "near · receipts"]]);
  });

  it("takes a block's shortlist row when it has one, and the capability itself otherwise", () => {
    const row = candidate("cap-refund", { strength: "possible" });
    expect(targetOfRow(cap("cap-refund", "Refunds"), "Payments", [row])).toBe(row);
    expect(targetOfRow({ ...cap("cap-gift", "Gift cards"), statement: "Sells them" }, "Payments", [row]))
      .toEqual({ target: "cap-gift", type: "capability", title: "Gift cards", area: "Payments", statement: "Sells them" });
  });

  it("lists the candidates outside the zoomed area, constraints included, with their rank", () => {
    const others = otherAreaCandidates([candidate("cap-refund"), candidate("cap-label"), candidate("con-pci", { type: "constraint" })], MAP, "payments");
    expect(others.map((o) => [o.candidate.target, o.rank, o.area?.slug ?? null])).toEqual([["cap-label", 2, "shipping"], ["con-pci", 3, null]]);
  });
});

// ── View ─────────────────────────────────────────────────────────────

let root: HTMLDivElement;

/** Answers `POST …/placement/check`: rex's dry run of the body the card sent. */
type CheckRoute = (body: Record<string, unknown>) => Promise<SidecarPlacementCheck> | SidecarPlacementCheck;

function serve(changes: ChangeRow[], shortlists: ChangePlacement[], check?: CheckRoute): void {
  const routes: Record<string, unknown> = {
    "/api/project": { cliName: "ndx" },
    "/api/rex/changes": { layout: "v2", changes },
    "/api/rex/product": { layout: "v2", map: MAP },
    "/api/rex/changes/placements": { layout: "v2", placements: Object.fromEntries(shortlists.map((p) => [p.change.id, p])) },
    ...Object.fromEntries(MAP.areas.map((a) => [`/api/rex/product/area/${a.slug}`, { layout: "v2", area: areaDetail(a.slug) }])),
    ...Object.fromEntries(changes.map((c) => [`/api/rex/changes/${c.id}/place`, { relation: "touches" }])),
    ...Object.fromEntries(changes.map((c) => [`/api/rex/changes/${c.id}/propose`, { proposed: { type: "capability", title: "Gift receipts" } }])),
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (check && url.endsWith("/placement/check")) {
      const answer = await check(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ layout: "v2", change: "a", check: answer }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    const body = routes[url];
    return new Response(JSON.stringify(body ?? { error: "not found" }), {
      status: body === undefined ? 404 : 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
  }
}

async function mount(vnode: VNode): Promise<void> {
  await act(async () => { render(vnode, root); });
  await settle();
}

const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
const $$ = <T extends Element = HTMLElement>(sel: string) => [...root.querySelectorAll<T>(sel)];
const crumb = () => $$(".placing-crumb > button, .placing-crumb > b").map((el) => el.textContent);
const lit = () => $$(".pam-block.pam-lit").map((el) => [el.dataset.block, el.querySelector(".pam-lit-note")?.textContent]);

beforeEach(() => {
  // Placement drafts live in sessionStorage for the browser session: none may carry over.
  sessionStorage.clear();
  clearProjectMetadataCache();
  root = document.createElement("div");
  document.body.appendChild(root);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  vi.unstubAllGlobals();
});

describe("PlacementMode", () => {
  it("opens zoomed into a strong, untied pick's area with its block lit, and names the change in the breadcrumb", async () => {
    serve([change("a"), change("b")], [
      placement("a", [candidate("cap-label", { score: 9 })]),
      placement("b", [candidate("cap-vat", { strength: "possible", score: 1 })]),
    ]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-container")?.dataset.level).toBe("area");
    expect(crumb()).toEqual(["Plan", "Product map", "Shipping"]);
    expect($(".placing-label")?.textContent).toBe("Placing 1 of 2 · Change a");
    expect($(".pam.pam-placing")).not.toBeNull();
    expect(lit()).toEqual([["cap-label", "#1 · strong"]]);
    // "Where it goes" sits beside the map, for this change.
    expect($(".placing-panel .cp-section")).not.toBeNull();
    expect($(".placing-panel .cp-place-on-map")).toBeNull();
  });

  it("opens a possible shortlist at the area level with each area's candidate count lit, and choosing an area zooms in", async () => {
    serve([change("a")], [placement("a", [
      candidate("cap-refund", { strength: "possible", score: 3 }),
      candidate("cap-label", { strength: "possible", score: 2 }),
      candidate("cap-gift", { strength: "weak", score: 1 }),
    ])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-container")?.dataset.level).toBe("map");
    expect(crumb()).toEqual(["Plan", "Product map"]);
    expect($(".placing-note")?.textContent).toBe("None strong: the best is possible. Pick an area to compare its candidates in place.");
    // Every area is a block; only the ones holding candidates are lit.
    expect($$(".pam-block").map((el) => el.dataset.block)).toEqual(["area-pay", "area-ship", "area-tax"]);
    expect(lit()).toEqual([["area-pay", "2 candidates"], ["area-ship", "1 candidate"]]);
    expect($('.pam-block[data-block="area-pay"]')?.getAttribute("aria-label")).toContain("; 2 candidates");

    await act(async () => { $<HTMLButtonElement>('.pam-block[data-block="area-pay"]')!.click(); });
    await settle();
    expect($(".placing-container")?.dataset.level).toBe("area");
    expect(crumb()).toEqual(["Plan", "Product map", "Payments"]);
    expect(lit()).toEqual([["cap-refund", "#1 · possible"], ["cap-gift", "#3 · weak"]]);

    // The breadcrumb's map steps back out to the area level.
    await act(async () => { $<HTMLButtonElement>(".placing-crumb-map")!.click(); });
    await settle();
    expect($(".placing-container")?.dataset.level).toBe("map");
  });

  it("names the failure in the area-level note when the shortlist read fails, not 'no candidate'", async () => {
    serve([change("a")], []);
    const served = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) =>
      url === "/api/rex/changes/placements"
        ? new Response(JSON.stringify({ error: "rex is down" }), { status: 500, headers: { "Content-Type": "application/json" } })
        : served(url, init)));
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-container")?.dataset.level).toBe("map");
    expect($(".placing-note")?.textContent).toBe("Could not read rex's shortlist: rex is down. Pick an area, or search in the panel.");
  });

  it("opens a tied shortlist at the area level, even when its top pick is strong", async () => {
    serve([change("a")], [placement("a", [candidate("cap-label"), candidate("cap-vat")], true)]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-container")?.dataset.level).toBe("map");
    expect(lit()).toEqual([["area-ship", "1 candidate"], ["area-tax", "1 candidate"]]);
  });

  it("the breadcrumb's Plan returns to Plan", async () => {
    serve([change("a")], [placement("a", [])]);
    const navigateTo = vi.fn();
    await mount(h(PlacementMode, { changeId: "a", navigateTo }));
    expect($(".placing-note")?.textContent).toBe("rex found no candidate. Pick an area, or search in the panel.");
    await act(async () => { $$<HTMLButtonElement>(".placing-crumb > button")[0]!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("plan");
  });

  it("Next › in the panel opens the next change in placement mode", async () => {
    serve([change("a"), change("b")], [placement("a", [candidate("cap-label", { score: 9 })]), placement("b", [candidate("cap-vat", { score: 1 })])]);
    const navigateTo = vi.fn();
    await mount(h(PlacementMode, { changeId: "a", navigateTo }));
    await act(async () => { $<HTMLButtonElement>(".placing-panel .cp-next")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("product", { tab: "place/b" });
  });

  it("says so for a change that is not waiting in the Inbox", async () => {
    serve([change("a", { awaitsPlacement: undefined, needsPlacement: false })], []);
    const navigateTo = vi.fn();
    await mount(h(PlacementMode, { changeId: "a", navigateTo }));
    expect($('.placing-container [role="status"]')?.textContent).toBe("This change is not waiting in the Inbox.");
    await act(async () => { $<HTMLButtonElement>(".placing-container .ch-change-link")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "a" });
  });

  it("shows one card per candidate with its area, strength, matched words, statement and what Touches and Amends do", async () => {
    serve([change("a")], [placement("a", [
      candidate("cap-label", { title: "Shipping labels", area: "Shipping", statement: "Prints a label per parcel.", reasons: ["words: label, parcel"] }),
      candidate("cap-refund", { title: "Refunds", area: "Payments", strength: "possible", score: 2 }),
    ])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-panel .cp-section")?.dataset.layout).toBe("wide");
    expect($$(".placing-panel .cp-card").map((el) => el.dataset.target)).toEqual(["cap-label", "cap-refund"]);
    const card = $('.cp-card[data-target="cap-label"]')!;
    expect(card.querySelector(".cp-target-title")?.textContent).toBe("Shipping labels");
    expect(card.querySelector(".cp-card-area")?.textContent).toBe("Shipping");
    expect(card.querySelector(".strength-chip, [data-strength]")?.textContent).toContain("strong");
    expect(card.querySelector(".cp-card-words")?.textContent).toBe("matched label, parcel");
    expect(card.querySelector(".cp-card-statement")?.textContent).toBe("Prints a label per parcel.");
    expect([...card.querySelectorAll(".cp-card-effects dd")].map((el) => el.textContent))
      .toEqual([touchesEffect("Shipping labels"), amendsEffect("Shipping labels")]);
  });

  it("a card lights its block, and a lit block selects its card", async () => {
    serve([change("a")], [placement("a", [candidate("cap-refund", { score: 9 }), candidate("cap-gift", { strength: "possible", score: 2 })])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    const pressed = () => $$('.pam-block[aria-pressed="true"]').map((el) => el.dataset.block);
    expect(pressed()).toEqual([]);

    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-gift"] input[type="radio"]')!.click(); });
    await settle();
    expect(pressed()).toEqual(["cap-gift"]);

    await act(async () => { $<HTMLButtonElement>('.pam-block[data-block="cap-refund"]')!.click(); });
    await settle();
    expect(pressed()).toEqual(["cap-refund"]);
    expect($$(".cp-card.is-checked").map((el) => el.dataset.target)).toEqual(["cap-refund"]);
    expect($<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.checked).toBe(true);
  });

  it("picking another area's candidate, as chip or card, moves the map and keeps the panel's edits", async () => {
    serve([change("a")], [placement("a", [
      candidate("cap-label", { score: 9 }),
      candidate("cap-refund", { strength: "possible", score: 2 }),
      candidate("con-pci", { type: "constraint", strength: "weak", score: 1 }),
    ])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect(crumb()).toEqual(["Plan", "Product map", "Shipping"]);
    expect($$(".placing-chip").map((el) => el.dataset.target)).toEqual(["cap-refund", "con-pci"]);

    // Edit the panel: choose the strong pick, Amends, and a summary.
    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-label"] input[type="radio"]')!.click(); });
    await settle();
    await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="amends"]')!.click(); });
    await settle();
    const summary = $<HTMLInputElement>(".cp-amends input.cp-input")!;
    await act(async () => { summary.value = "Labels carry the return address"; summary.dispatchEvent(new Event("input")); });

    await act(async () => { $<HTMLButtonElement>('.placing-chip[data-target="cap-refund"]')!.click(); });
    await settle();
    expect(crumb()).toEqual(["Plan", "Product map", "Payments"]);
    expect($$('.pam-block[aria-pressed="true"]').map((el) => el.dataset.block)).toEqual(["cap-refund"]);
    expect($(".cp-card.is-checked")?.dataset.target).toBe("cap-refund");
    expect($<HTMLInputElement>(".cp-amends input.cp-input")?.value).toBe("Labels carry the return address");
    expect($$(".placing-chip").map((el) => el.dataset.target)).toEqual(["cap-label", "con-pci"]);

    // A card in another area moves the map too.
    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-label"] input[type="radio"]')!.click(); });
    await settle();
    expect(crumb()).toEqual(["Plan", "Product map", "Shipping"]);
    expect($<HTMLInputElement>(".cp-amends input.cp-input")?.value).toBe("Labels carry the return address");
  });

  it("Place & add another opens with no target chosen, and a block on the map still chooses one", async () => {
    serve([change("a")], [placement("a", [candidate("cap-refund", { score: 9 }), candidate("cap-gift", { strength: "possible", score: 2 })])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.click(); });
    await settle();
    await act(async () => { $<HTMLButtonElement>(".cp-place-another")!.click(); });
    await settle();
    expect($(".cp-section")?.dataset.changePlacement).toBe("another");
    expect($$(".cp-card.is-checked")).toEqual([]);
    expect($<HTMLButtonElement>(".cp-place")!.disabled).toBe(true);

    await act(async () => { $<HTMLButtonElement>('.pam-block[data-block="cap-gift"]')!.click(); });
    await settle();
    expect($(".cp-card.is-checked")?.dataset.target).toBe("cap-gift");
  });

  it("pre-selects rex's relation for a strong, untied pick", async () => {
    serve([change("a")], [placement("a", [candidate("cap-label", { score: 9 })])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-label"] input[type="radio"]')!.click(); });
    await settle();
    expect($('.cp-card.is-checked .cp-relation')?.dataset.relation).toBe("touches");
    expect($<HTMLButtonElement>(".cp-place")!.disabled).toBe(false);
  });

  it.each([
    ["possible", [candidate("cap-label", { strength: "possible" })], false],
    ["tied", [candidate("cap-label"), candidate("cap-vat")], true],
  ] as const)("selects no relation for a %s pick and asks whether the change alters the promise", async (_, shortlist, tied) => {
    serve([change("a")], [placement("a", [...shortlist], tied)]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-label"] input[type="radio"]')!.click(); });
    await settle();
    const fieldset = $('.cp-card.is-checked .cp-relation')!;
    expect(fieldset.dataset.relation).toBe("unset");
    expect(fieldset.querySelector("legend")?.textContent).toBe(relationQuestion("Home cap-label"));
    expect([...fieldset.querySelectorAll<HTMLInputElement>("input")].some((i) => i.checked)).toBe(false);
    expect($<HTMLButtonElement>(".cp-place")!.disabled).toBe(true);

    await act(async () => { fieldset.querySelector<HTMLInputElement>('input[value="touches"]')!.click(); });
    await settle();
    expect($<HTMLButtonElement>(".cp-place")!.disabled).toBe(false);
  });

  it("dims blocks off the shortlist and marks the ones sharing words with the change near", async () => {
    serve([change("a", { title: "Print gift receipts" })], [placement("a", [candidate("cap-refund", { score: 9 })])]);
    await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
    expect(lit()).toEqual([["cap-refund", "#1 · strong"]]);
    const gift = $('.pam-block[data-block="cap-gift"]')!;
    expect(gift.classList.contains("pam-near")).toBe(true);
    expect(gift.querySelector(".pam-near-note")?.textContent).toBe("near · gift");
    expect(gift.getAttribute("aria-label")).toContain("; near · gift");
  });

  describe("Nothing fits (WF6)", () => {
    const ghost = () => $$('.pam-block[data-ghost="true"]');
    const near = () => $$(".pam-block.pam-near").map((el) => el.dataset.block);
    async function type(sel: string, value: string, event = "input"): Promise<void> {
      await act(async () => {
        const el = $<HTMLInputElement>(sel)!;
        el.value = value;
        el.dispatchEvent(new Event(event, { bubbles: true }));
      });
      await settle();
    }
    async function nothingFits(): Promise<void> {
      await act(async () => { $<HTMLButtonElement>(".cp-nothing-fits")!.click(); });
      await settle();
    }

    it("shows the proposal form and a dashed ghost block, titled as the form is, in the chosen area", async () => {
      serve([change("a", { title: "Print gift receipts" })], [placement("a", [candidate("cap-label", { score: 9 })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      expect(ghost()).toHaveLength(0);
      await nothingFits();
      expect($(".placing-panel .cp-propose")).not.toBeNull();
      // The form opens under the zoomed area, so the ghost is there at once.
      expect(crumb()).toEqual(["Plan", "Product map", "Shipping"]);
      expect($<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!.value).toBe("area-ship");
      expect(ghost().map((el) => el.querySelector(".pam-label")?.textContent)).toEqual(["Print gift receipts"]);

      const under = $<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!;
      await act(async () => { under.value = "area-pay"; under.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      // The map moved to Payments, and the ghost wears the change's title until one is typed.
      expect(crumb()).toEqual(["Plan", "Product map", "Payments"]);
      expect(ghost().map((el) => el.querySelector(".pam-label")?.textContent)).toEqual(["Print gift receipts"]);
      expect(ghost()[0]!.getAttribute("aria-label")).toBe("Proposed capability: Print gift receipts");

      await type('.cp-propose input[type="text"]', "Refund to wallet");
      expect(ghost().map((el) => el.querySelector(".pam-label")?.textContent)).toEqual(["Refund to wallet"]);

      // Another area moves the ghost.
      await act(async () => { under.value = "area-tax"; under.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      expect(crumb()).toEqual(["Plan", "Product map", "Tax"]);
      expect(ghost()).toHaveLength(1);
      expect($('.pam-block[data-block="cap-vat"]')).not.toBeNull();
    });

    it("follows the map to another area, and re-picking the old area in the form brings the map back", async () => {
      serve([change("a", { title: "Print gift receipts" })], [placement("a", [candidate("cap-label", { score: 9 })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await nothingFits();
      const under = () => $<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!;
      expect(under().value).toBe("area-ship");

      // Zoom to the area level, then into Payments: the form and the ghost go there.
      await act(async () => { $<HTMLButtonElement>(".placing-crumb-map")!.click(); });
      await settle();
      await act(async () => { $<HTMLButtonElement>('.pam-block[data-block="area-pay"]')!.click(); });
      await settle();
      expect(crumb()).toEqual(["Plan", "Product map", "Payments"]);
      expect(under().value).toBe("area-pay");
      expect(ghost()).toHaveLength(1);

      // Choosing Shipping in the form moves the map back and redraws the ghost.
      await act(async () => { under().value = "area-ship"; under().dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      expect(crumb()).toEqual(["Plan", "Product map", "Shipping"]);
      expect(ghost()).toHaveLength(1);
    });

    it("at the area level, opens with no area and draws no ghost until one is chosen", async () => {
      serve([change("a")], [placement("a", [candidate("cap-label", { strength: "possible", score: 2 })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      expect($(".placing-container")?.dataset.level).toBe("map");
      await nothingFits();
      expect($<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!.value).toBe("");
      expect(ghost()).toHaveLength(0);
      const under = $<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!;
      await act(async () => { under.value = "area-tax"; under.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      expect($(".placing-container")?.dataset.level).toBe("area");
      expect(ghost()).toHaveLength(1);
    });

    it("keeps blocks sharing words with the title lit as it is typed", async () => {
      serve([change("a", { title: "Handle taxes" })], [placement("a", [candidate("cap-label", { score: 9 })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await nothingFits();
      const under = $<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!;
      await act(async () => { under.value = "area-pay"; under.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      expect(near()).toEqual([]);
      await type('.cp-propose input[type="text"]', "Gift card refunds");
      expect(near().sort()).toEqual(["cap-gift", "cap-refund"]);
    });

    it("proposes through /propose and clears the ghost after the write", async () => {
      serve([change("a")], [placement("a", [candidate("cap-label", { score: 9 })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await nothingFits();
      const under = $<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!;
      await act(async () => { under.value = "area-pay"; under.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      expect(ghost()).toHaveLength(1);
      await act(async () => { $<HTMLButtonElement>(".cp-propose-btn")!.click(); });
      await settle();
      const fetched = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls as Array<[string, RequestInit?]>;
      const propose = fetched.find(([url]) => url === "/api/rex/changes/a/propose");
      expect(propose?.[1]?.method).toBe("POST");
      expect(JSON.parse(String(propose?.[1]?.body))).toMatchObject({ type: "capability", under: "area-pay" });
      expect(ghost()).toHaveLength(0);
    });

    it("clears the ghost when the form goes back to the shortlist", async () => {
      serve([change("a")], [placement("a", [candidate("cap-label", { score: 9 })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await nothingFits();
      const under = $<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!;
      await act(async () => { under.value = "area-ship"; under.dispatchEvent(new Event("change", { bubbles: true })); });
      await settle();
      expect(ghost()).toHaveLength(1);
      await act(async () => { $<HTMLButtonElement>(".cp-back")!.click(); });
      await settle();
      expect(ghost()).toHaveLength(0);
    });
  });

  describe("an amendment edited in the card (WF5)", () => {
    const REFUNDS = candidate("cap-refund", {
      title: "Refunds", score: 9,
      criteria: [{ id: "c1", text: "Refund to card" }, { id: "c2", text: "Refund to wallet" }, { id: "c3", text: "Partial refunds" }],
    });
    const accepted = (body: Record<string, unknown>): SidecarPlacementCheck =>
      ({ ok: true, action: "place", target: String(body.target), title: "Refunds", relation: "amends", base: "abcdef12", warnings: [] });

    const place = () => $<HTMLButtonElement>(".cp-place")!;
    const dryRun = () => $('.cp-card.is-checked .cp-dry-run');
    /** Let the edit settle past the check's debounce, then let its answer land. */
    async function recheck(): Promise<void> {
      await act(async () => { await new Promise<void>((r) => setTimeout(r, CHECK_DEBOUNCE_MS + 20)); });
      await settle();
    }
    async function amend(): Promise<void> {
      await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="amends"]')!.click(); });
      await settle();
    }

    it("re-checks every edit through /placement/check, shows the dry-run line, and holds Place while a check is in flight", async () => {
      const sent: Array<Record<string, unknown>> = [];
      const answers: Array<() => void> = [];
      serve([change("a")], [placement("a", [REFUNDS])], (body) => {
        sent.push(body);
        return new Promise((resolve) => answers.push(() => resolve(accepted(body))));
      });
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await amend();

      // The editor sits in the checked card.
      expect($(".cp-card.is-checked .cp-amends")).not.toBeNull();
      expect(dryRun()?.dataset.check).toBe("checking");
      expect(dryRun()?.textContent).toBe("Checking the amendment…");
      expect(place().disabled).toBe(true);

      await recheck();
      expect(sent).toEqual([{ target: "cap-refund", relation: "amends" }]);
      expect(place().disabled).toBe(true);
      await act(async () => { answers.shift()!(); });
      await settle();
      expect(dryRun()?.dataset.check).toBe("ok");
      expect(dryRun()?.textContent).toBe("Applies cleanly: amends Refunds (cap-refund @ spec abcd).");
      expect(place().disabled).toBe(false);

      // Editing the statement checks again, and Place waits for it.
      const statement = $<HTMLTextAreaElement>(".cp-card.is-checked .cp-amends textarea")!;
      await act(async () => { statement.value = "Refunds reach the original card"; statement.dispatchEvent(new Event("input")); });
      expect(place().disabled).toBe(true);
      expect(dryRun()?.dataset.check).toBe("checking");
      await recheck();
      expect(sent[1]).toEqual({ target: "cap-refund", relation: "amends", proposed: "Refunds reach the original card" });
      await act(async () => { answers.shift()!(); });
      await settle();
      expect(place().disabled).toBe(false);
    });

    it("shows rex's own message and kind for a refusal, and keeps Place disabled", async () => {
      serve([change("a")], [placement("a", [REFUNDS])], () =>
        ({ ok: false, kind: "nothing-to-modify", error: "amends needs a criteria edit or a proposed statement" }));
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await amend();
      await recheck();
      expect(dryRun()?.dataset.check).toBe("refused");
      expect(dryRun()?.dataset.kind).toBe("nothing-to-modify");
      expect(dryRun()?.querySelector(".cp-dry-run-line")?.textContent)
        .toBe("Rex refuses this placement (nothing-to-modify): amends needs a criteria edit or a proposed statement");
      expect(dryRun()?.querySelector(".cp-refusal-hint")?.textContent).toBe(REFUSAL_HINTS["nothing-to-modify"]);
      expect(place().disabled).toBe(true);
    });

    it("shows the pending criteria count on the selected block", async () => {
      serve([change("a")], [placement("a", [REFUNDS])], accepted);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      const size = () => $('.pam-block[data-block="cap-refund"] .pam-size')?.textContent;
      expect(size()).toBe("3");
      await amend();
      expect(size()).toBe("3 → 3");

      await act(async () => { $<HTMLButtonElement>(".cp-card.is-checked .task-criterion-add-btn")!.click(); });
      const input = $<HTMLInputElement>(".cp-card.is-checked .task-criterion-add-input")!;
      await act(async () => { input.value = "Refunds show on the statement"; input.dispatchEvent(new Event("input")); });
      await act(async () => { $<HTMLButtonElement>(".cp-card.is-checked .task-criterion-add-confirm")!.click(); });
      await settle();
      expect(size()).toBe("3 → 4");
      expect($('.pam-block[data-block="cap-refund"]')?.getAttribute("aria-label")).toContain("; criteria 3 → 4 with this amendment");

      await act(async () => { $$<HTMLButtonElement>(".cp-card.is-checked .task-criterion-remove")[0]!.click(); });
      await act(async () => { $$<HTMLButtonElement>(".cp-card.is-checked .task-criterion-remove")[0]!.click(); });
      await settle();
      expect(size()).toBe("3 → 2");

      // Touches amends nothing: the block shows its own size again.
      await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="touches"]')!.click(); });
      await settle();
      expect(size()).toBe("3");
    });
  });

  /** Extra answers over `serve`'s: `routes` by URL, with every POST recorded. */
  function also(routes: Record<string, unknown>): Array<{ url: string; body: unknown }> {
    const base = globalThis.fetch;
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const body = routes[url];
      if (body === undefined) return base(url, init);
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    }));
    return posts;
  }

  const press = async (key: string) => {
    await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    await settle();
  };

  describe("keys (#896) in placement mode", () => {
    const TWO = [candidate("cap-refund", { score: 9 }), candidate("cap-gift", { strength: "possible", score: 2 })];

    it("1–5 pick a card, T and A set the relation, Enter places and opens the next change", async () => {
      serve([change("a"), change("b")], [placement("a", TWO), placement("b", [candidate("cap-vat")])]);
      const posts = also({});
      const navigateTo = vi.fn();
      await mount(h(PlacementMode, { changeId: "a", navigateTo }));

      await press("2");
      expect($(".cp-card.is-checked")?.dataset.target).toBe("cap-gift");
      await press("t");
      expect($('.cp-card.is-checked .cp-relation')?.dataset.relation).toBe("touches");
      await press("a");
      expect($('.cp-card.is-checked .cp-relation')?.dataset.relation).toBe("amends");
      await press("t");

      await press("Enter");
      expect(posts.filter((p) => p.url.endsWith("/place"))).toEqual([
        { url: "/api/rex/changes/a/place", body: { target: "cap-gift", relation: "touches" } },
      ]);
      expect(navigateTo).toHaveBeenCalledWith("product", { tab: "place/b" });
    });

    it("J and K open the next and the previous Inbox change; N opens the proposal form", async () => {
      serve([change("a"), change("b"), change("c")], [placement("a", TWO), placement("b", TWO), placement("c", TWO)]);
      const navigateTo = vi.fn();
      await mount(h(PlacementMode, { changeId: "b", navigateTo }));
      await press("j");
      expect(navigateTo).toHaveBeenLastCalledWith("product", { tab: "place/c" });
      await press("k");
      expect(navigateTo).toHaveBeenLastCalledWith("product", { tab: "place/a" });
      await press("n");
      expect($(".cp-propose")).not.toBeNull();
    });

    describe("after a plain Place, the placed change has left the Inbox", () => {
      /** Place's write comes back as `rex:prd-changed`: deliver it through every pipeline the views opened. */
      const prdChanged = async () => {
        const pipelines = vi.mocked(createWSPipeline).mock.calls.map(([config]) => config);
        await act(async () => {
          for (const config of pipelines) {
            config.onFlush({ types: new Set(["rex:prd-changed"]), countByType: new Map(), messages: [], size: 1 });
          }
        });
        await settle();
      };

      const placeThen = async (key: string) => {
        vi.mocked(createWSPipeline).mockClear();
        const all = ["a", "b", "c", "d"];
        serve(all.map((id) => change(id)), all.map((id) => placement(id, TWO)));
        const navigateTo = vi.fn();
        await mount(h(PlacementMode, { changeId: "c", navigateTo }));
        expect($(".placing-label")?.textContent).toContain("Placing 3 of 4");
        // The reread after Place no longer lists c.
        also({ "/api/rex/changes": { layout: "v2", changes: ["a", "b", "d"].map((id) => change(id)) } });
        await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.click(); });
        await settle();
        await act(async () => { $<HTMLButtonElement>(".cp-place")!.click(); });
        await settle();
        await prdChanged();
        // c has left the Inbox order, so the label no longer counts it.
        expect($(".placing-label")?.textContent).toBe("Placing · Change c");
        navigateTo.mockClear();
        await press(key);
        return navigateTo;
      };

      it("J opens the change that took its slot", async () => {
        expect(await placeThen("j")).toHaveBeenLastCalledWith("product", { tab: "place/d" });
      });

      it("K opens the change before its slot", async () => {
        expect(await placeThen("k")).toHaveBeenLastCalledWith("product", { tab: "place/b" });
      });
    });

    it("leaves a key typed into a field to the field", async () => {
      serve([change("a"), change("b")], [placement("a", TWO), placement("b", TWO)]);
      const navigateTo = vi.fn();
      await mount(h(PlacementMode, { changeId: "a", navigateTo }));
      const input = $<HTMLInputElement>(".cp-search-input")!;
      await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "j", bubbles: true, cancelable: true })); });
      expect(navigateTo).not.toHaveBeenCalled();
    });
  });

  it("Place & next writes the place and opens the next change, which starts where its own shortlist says", async () => {
    serve([change("a"), change("b")], [placement("a", [candidate("cap-label")]), placement("b", [candidate("cap-vat")])]);
    const posts = also({});
    const navigateTo = vi.fn();
    await mount(h(PlacementMode, { changeId: "a", navigateTo }));
    await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-label"] input[type="radio"]')!.click(); });
    await settle();
    await act(async () => { $<HTMLButtonElement>(".cp-place-next")!.click(); });
    await settle();
    expect(posts.map((p) => p.url)).toContain("/api/rex/changes/a/place");
    expect(navigateTo).toHaveBeenCalledWith("product", { tab: "place/b" });

    // The route keys placement mode by change, so the next one decides its own start (WF2).
    await mount(h(PlacementMode, { key: "b", changeId: "b", navigateTo }));
    expect($(".placing-container")?.dataset.placing).toBe("b");
    expect(crumb()).toEqual(["Plan", "Product map", "Tax"]);
  });

  describe("Place & add another (WF8)", () => {
    const TWO = [candidate("cap-refund", { score: 9 }), candidate("cap-gift", { strength: "possible", score: 2 })];
    const marked = () => $$(".pam-block.pam-placed").map((el) => el.dataset.block);
    const homes = () => $$(".cp-home").map((el) => el.querySelector(".cp-home-text")?.textContent);

    async function placeFirst() {
      serve([change("a")], [placement("a", TWO)]);
      const posts = also({ "/api/rex/changes/a/unplace": { change: "a", target: "cap-refund" } });
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLButtonElement>(".cp-place-another")!.click(); });
      await settle();
      return posts;
    }

    it("lists each placed home with Remove and marks its block with the change's marker", async () => {
      await placeFirst();
      expect(homes()).toEqual(["Touches Home cap-refund"]);
      expect(marked()).toEqual(["cap-refund"]);
      expect($('.pam-block[data-block="cap-refund"] .pam-placed-mark')?.textContent).toContain("this change");

      // An extra home is a touches, whatever relation the first one had.
      await act(async () => { $<HTMLButtonElement>('.pam-block[data-block="cap-gift"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLButtonElement>(".cp-place")!.click(); });
      await settle();
      expect(homes()).toEqual(["Touches Home cap-refund", "Touches Home cap-gift"]);
      expect(marked()).toEqual(["cap-refund", "cap-gift"]);
    });

    it("Remove takes the home back through /unplace and clears its marker", async () => {
      const posts = await placeFirst();
      await act(async () => { $<HTMLButtonElement>(".cp-home-remove")!.click(); });
      await settle();
      expect(posts.find((p) => p.url.endsWith("/unplace"))).toEqual({ url: "/api/rex/changes/a/unplace", body: { target: "cap-refund" } });
      expect(homes()).toEqual([]);
      expect(marked()).toEqual([]);
    });

    it("Done ends the session but keeps the markers", async () => {
      await placeFirst();
      await act(async () => { $<HTMLButtonElement>(".cp-done")!.click(); });
      await settle();
      expect($(".cp-homes")).toBeNull();
      expect(marked()).toEqual(["cap-refund"]);
    });
  });

  describe("the one-shot model draft (WF9)", () => {
    const DRAFT = "/api/rex/changes/a/placement/draft";
    const rows = [candidate("cap-refund", { score: 9 }), candidate("cap-gift", { strength: "possible", score: 2 })];
    const toggle = { "/api/features": { toggles: [{ key: "rex.placementDraft", enabled: true }] } };
    const draftBody = (pick: string, shortlist: PlacementCandidate[]) =>
      ({ layout: "v2", change: "a", relation: "touches", tied: false, shortlist, pick, model: "m", warnings: [] });

    it("adds the model's pick as a card marked model and never selects it", async () => {
      serve([change("a")], [placement("a", [rows[0]])]);
      also({ ...toggle, [DRAFT]: draftBody("cap-gift", rows) });
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      expect($$(".cp-card[data-target='cap-gift']")).toEqual([]);

      await act(async () => { $$<HTMLButtonElement>("button").find((b) => b.textContent === "Draft with the model")!.click(); });
      await settle();
      const card = $('.cp-card[data-target="cap-gift"]')!;
      expect(card.querySelector(".cp-model-mark")?.textContent).toBe("model");
      expect($$(".cp-card.is-checked")).toEqual([]);
      expect($<HTMLButtonElement>(".cp-place")!.disabled).toBe(true);
      expect($(".cp-draft-note")?.textContent).toContain("Picked by the model (m)");

      // Choosing it is the person's act; it keeps its mark.
      await act(async () => { card.querySelector<HTMLInputElement>('input[type="radio"]')!.click(); });
      await settle();
      expect($(".cp-card.is-checked")?.dataset.target).toBe("cap-gift");
      expect($(".cp-card.is-checked .cp-model-mark")).not.toBeNull();
    });

    it("marks the shortlist's own card when the model picks a candidate already on it", async () => {
      serve([change("a")], [placement("a", rows)]);
      also({ ...toggle, [DRAFT]: draftBody("cap-gift", rows) });
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await act(async () => { $$<HTMLButtonElement>("button").find((b) => b.textContent === "Draft with the model")!.click(); });
      await settle();
      expect($$(".cp-model-mark").map((el) => el.closest<HTMLElement>(".cp-card")?.dataset.target)).toEqual(["cap-gift"]);
      expect($$(".cp-card.is-checked")).toEqual([]);
    });

    it("drops the earlier pick's card when a later draft picks nothing", async () => {
      serve([change("a")], [placement("a", [rows[0]])]);
      const answers: Record<string, unknown> = { ...toggle, [DRAFT]: draftBody("cap-gift", rows) };
      also(answers);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      const draftButton = () => $$<HTMLButtonElement>("button").find((b) => b.textContent === "Draft with the model")!;
      await act(async () => { draftButton().click(); });
      await settle();
      expect($('.cp-card[data-target="cap-gift"] .cp-model-mark')).not.toBeNull();

      answers[DRAFT] = { layout: "v2", change: "a", relation: "touches", tied: false, shortlist: rows, warnings: [] };
      await act(async () => { draftButton().click(); });
      await settle();
      expect($(".cp-draft-note")?.textContent).toContain("No draft from the model");
      expect($$(".cp-model-mark")).toEqual([]);
      expect($('.cp-card[data-target="cap-gift"]')).toBeNull();
    });
  });

  describe("leaving keeps an unsaved placement as a draft (WF10)", () => {
    const TWO = [candidate("cap-refund", { score: 9 }), candidate("cap-gift", { strength: "possible", score: 2 })];
    const KEY = "ndx.placement-draft.a";
    const typeInto = async (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
      await act(async () => { el.value = value; el.dispatchEvent(new Event("input", { bubbles: true })); });
    };
    const leave = async () => { await act(async () => { render(null, root); }); };
    const pressEscape = async () => {
      await act(async () => { document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    };

    it("Esc leaves for Plan; a pick and an edit come back on the next Place, and nothing is written", async () => {
      serve([change("a")], [placement("a", TWO)]);
      const posts = also({});
      const navigateTo = vi.fn();
      await mount(h(PlacementMode, { changeId: "a", navigateTo }));
      await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-gift"] input[type="radio"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="amends"]')!.click(); });
      await settle();
      await typeInto($<HTMLInputElement>(".cp-amends input.cp-input")!, "Gift cards expire");
      await pressEscape();
      expect(navigateTo).toHaveBeenCalledWith("plan");
      await leave();

      await mount(h(PlacementMode, { changeId: "a", navigateTo }));
      expect($(".cp-card.is-checked")?.dataset.target).toBe("cap-gift");
      expect($(".cp-card.is-checked .cp-relation")?.dataset.relation).toBe("amends");
      expect($<HTMLInputElement>(".cp-amends input.cp-input")?.value).toBe("Gift cards expire");
      // The map follows the resumed pick.
      expect($$('.pam-block[aria-pressed="true"]').map((el) => el.dataset.block)).toEqual(["cap-gift"]);
      expect(posts).toEqual([]);
    });

    it("keeps an edited criterion across the leave", async () => {
      serve([change("a")], [placement("a", [candidate("cap-refund", { score: 9, criteria: [{ id: "c1", text: "Refund in 5 days" }] })])]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="amends"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLButtonElement>(".cp-card.is-checked .task-criterion-remove")!.click(); });
      await settle();
      await leave();

      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      expect($$(".cp-card.is-checked .task-criterion")).toEqual([]);
    });

    it("Esc in a text field, such as cancelling a criterion edit, stays in placement mode", async () => {
      serve([change("a")], [placement("a", TWO)]);
      const navigateTo = vi.fn();
      await mount(h(PlacementMode, { changeId: "a", navigateTo }));
      await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-gift"] input[type="radio"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="amends"]')!.click(); });
      await settle();
      const field = $<HTMLInputElement>(".cp-amends input.cp-input")!;
      await act(async () => { field.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
      expect(navigateTo).not.toHaveBeenCalledWith("plan");
    });

    it("Esc with no edits just leaves and keeps nothing", async () => {
      serve([change("a")], [placement("a", TWO)]);
      const navigateTo = vi.fn();
      await mount(h(PlacementMode, { changeId: "a", navigateTo }));
      await pressEscape();
      expect(navigateTo).toHaveBeenCalledWith("plan");
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it("resumes on the proposal step with what was typed, and the ghost block follows", async () => {
      serve([change("a")], [placement("a", TWO)]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await press("n");
      await typeInto($<HTMLInputElement>(".cp-propose input.cp-input")!, "Gift receipts");
      await leave();

      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      expect($(".cp-propose")).not.toBeNull();
      expect($<HTMLInputElement>(".cp-propose input.cp-input")?.value).toBe("Gift receipts");
    });

    it("Place drops the draft", async () => {
      serve([change("a")], [placement("a", TWO)]);
      also({});
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      await act(async () => { $<HTMLInputElement>('.cp-card[data-target="cap-refund"] input[type="radio"]')!.click(); });
      await settle();
      expect(sessionStorage.getItem(KEY)).not.toBeNull();
      await act(async () => { $<HTMLInputElement>('.cp-card.is-checked .cp-relation input[value="touches"]')!.click(); });
      await settle();
      await act(async () => { $<HTMLButtonElement>(".cp-place")!.click(); });
      await settle();
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });

    it("resumes a proposal under its saved area, not the area the map opens on", async () => {
      sessionStorage.setItem(KEY, JSON.stringify({ step: "propose", type: "capability", under: "area-tax", title: "Gift receipts", statement: "", criteria: "" }));
      serve([change("a")], [placement("a", TWO)]);
      await mount(h(PlacementMode, { changeId: "a", navigateTo: vi.fn() }));
      expect($<HTMLSelectElement>(".cp-propose label:nth-of-type(2) select")!.value).toBe("area-tax");
      expect(crumb()).toEqual(["Plan", "Product map", "Tax"]);
    });

    it("a change placed by another route loses its draft once the Inbox is read", async () => {
      sessionStorage.setItem(KEY, JSON.stringify({ step: "propose", type: "capability", under: "", title: "Gift receipts", statement: "", criteria: "" }));
      // `a` is no longer waiting; `b` is.
      serve([change("a", { awaitsPlacement: undefined, needsPlacement: false }), change("b")], [placement("b", TWO)]);
      await mount(h(PlacementMode, { changeId: "b", navigateTo: vi.fn() }));
      expect(sessionStorage.getItem(KEY)).toBeNull();
    });
  });

  it("is what the Product page shows at /product/place/<id>", async () => {
    serve([change("a")], [placement("a", [candidate("cap-label")])]);
    await mount(h(ProductPage, { placeChangeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-container")?.dataset.placing).toBe("a");
  });
});
