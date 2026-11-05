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
  placementStart,
  placingLabel,
} from "../../../src/viewer/views/placement-mode.js";
import { ProductPage } from "../../../src/viewer/views/product-pages.js";
import { parsePathnameRoute, placeChangeOfTab, placementTab, routeTab, viewPathname } from "../../../src/viewer/route-state.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import type {
  AreaDetail,
  CapabilityRow,
  ChangePlacement,
  ChangeRow,
  PlacementCandidate,
  ProductMap,
} from "../../../src/viewer/views/product-model.js";

vi.mock("../../../src/viewer/hooks/use-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createWSPipeline: vi.fn(() => ({ push: vi.fn(), dispose: vi.fn() })),
}));

// ── Fixtures ─────────────────────────────────────────────────────────

const cap = (id: string, title: string, criteriaCount = 1): CapabilityRow =>
  ({ id, title, status: "met", health: "ok", criteriaCount, openChanges: [] });

const MAP: ProductMap = {
  areas: [
    { id: "area-pay", slug: "payments", title: "Payments", capabilities: [cap("cap-refund", "Refunds", 3), cap("cap-gift", "Gift cards")] },
    { id: "area-ship", slug: "shipping", title: "Shipping", capabilities: [cap("cap-label", "Shipping labels")] },
    { id: "area-tax", slug: "tax", title: "Tax", capabilities: [cap("cap-vat", "VAT")] },
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
    expect(mapLevelNote(placement("a", [candidate("x"), candidate("y")], true))).toContain("tie");
    expect(mapLevelNote(placement("a", [candidate("x", { strength: "possible" })]))).toBe("None strong: the best is possible. Pick an area to compare its candidates in place.");
  });
});

// ── View ─────────────────────────────────────────────────────────────

let root: HTMLDivElement;

function serve(changes: ChangeRow[], shortlists: ChangePlacement[]): void {
  const routes: Record<string, unknown> = {
    "/api/project": { cliName: "ndx" },
    "/api/rex/changes": { layout: "v2", changes },
    "/api/rex/product": { layout: "v2", map: MAP },
    "/api/rex/changes/placements": { layout: "v2", placements: Object.fromEntries(shortlists.map((p) => [p.change.id, p])) },
    ...Object.fromEntries(MAP.areas.map((a) => [`/api/rex/product/area/${a.slug}`, { layout: "v2", area: areaDetail(a.slug) }])),
  };
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
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

  it("is what the Product page shows at /product/place/<id>", async () => {
    serve([change("a")], [placement("a", [candidate("cap-label")])]);
    await mount(h(ProductPage, { placeChangeId: "a", navigateTo: vi.fn() }));
    expect($(".placing-container")?.dataset.placing).toBe("a");
  });
});
