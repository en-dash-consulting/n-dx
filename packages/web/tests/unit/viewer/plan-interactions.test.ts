// @vitest-environment jsdom
/**
 * Plan's filters and interactions from the Plan page design, and the product
 * area boxes: For me / Everyone, the stage chips, even and clickable area
 * boxes with a three-line summary, planning an Inbox item by its "Plan in"
 * button or by dropping it on an area, Solo / Team, and the newcomer tour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PlanAreas, filterForView, stageCounts } from "../../../src/viewer/views/plan-areas.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { InboxView } from "../../../src/viewer/views/inbox.js";
import type { InboxRow } from "../../../src/viewer/views/inbox-read.js";
import { PLAN_DRAG_EVENT, candidateInArea, endPlanDrag, startPlanDrag } from "../../../src/viewer/views/plan-placement.js";
import { PlanHeadControls, TOUR_STEPS, cardPosition } from "../../../src/viewer/views/plan-tour.js";
import { _resetPlanViewForTests, setPlanView } from "../../../src/viewer/views/plan-view-state.js";
import { StageSidePanels } from "../../../src/viewer/views/stage-side-panels.js";
import { _primePeopleForTests, _resetPeopleForTests } from "../../../src/viewer/components/assignee.js";
import type { ChangeRow, ChangeSummary, GlanceChange, PlacementCandidate, ProductMap } from "../../../src/viewer/views/product-model.js";
import type { StageSidePanel } from "../../../src/viewer/views/stages.js";

const ME = "Ann <ann@x.io>";

const change = (id: string, extra: Partial<GlanceChange> = {}): GlanceChange => ({
  id, title: `Change ${id}`, stage: "proposed", taskCount: 1, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...extra,
});

const OPEN: GlanceChange[] = [
  change("mine-ready", { stage: "ready", assignee: ME }),
  change("bo-working", { stage: "in-progress", assignee: "Bo <bo@x.io>" }),
  change("loose", { stage: "proposed" }),
];

const SUMMARY: ChangeSummary = {
  inbox: 0, inboxInStage: 0,
  stages: { proposed: 1, ready: 1, "in-progress": 1, "awaiting-apply": 0 },
  open: OPEN, next: null, requirements: { total: 0, uncovered: 0 },
};

const LONG = "Line one of a long summary. ".repeat(30);
const MAP: ProductMap = {
  areas: [
    { id: "a1", slug: "checkout", title: "Checkout", summary: LONG, capabilities: [], openChangeIds: ["mine-ready", "bo-working"] },
    { id: "a2", slug: "search", title: "Search", capabilities: [], openChangeIds: ["loose"] },
  ],
  constraints: [],
};

let root: HTMLDivElement;
let fetchSpy: ReturnType<typeof vi.fn>;

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

beforeEach(() => {
  localStorage.clear();
  _resetPlanViewForTests();
  _primePeopleForTests({ me: ME, people: [] });
  root = document.createElement("div");
  document.body.appendChild(root);
  fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = url === "/api/rex/changes/summary" ? { layout: "v2", summary: SUMMARY }
      : url === "/api/rex/product" ? { layout: "v2", map: MAP }
      : url.endsWith("/place") && init?.method === "POST" ? { change: "x", target: "cap-1", relation: "touches" }
      : {};
    return { ok: true, status: 200, json: async () => body } as Response;
  });
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  act(() => { render(null, root); });
  root.remove();
  _resetPeopleForTests();
  _resetPlanViewForTests();
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function mountAreas(navigateTo = vi.fn()) {
  await act(async () => { render(h(ChangesSummaryProvider, null, h(PlanAreas, { navigateTo })), root); });
  await flush();
  return navigateTo;
}

const boxIds = (slug: string) => [...root.querySelectorAll<HTMLElement>(`.plan-area[data-area="${slug}"] .plan-area-change`)].map((e) => e.dataset.change);

describe("filtering the product areas", () => {
  it("keeps yours under For me, the focused stage only, and counts each stage over the scope", () => {
    expect(filterForView(OPEN, { scope: "me", stage: null, mode: "team" }, ME).map((c) => c.id)).toEqual(["mine-ready"]);
    expect(filterForView(OPEN, { scope: "all", stage: "in-progress", mode: "team" }, ME).map((c) => c.id)).toEqual(["bo-working"]);
    // Solo ignores For me: all the work is yours.
    expect(filterForView(OPEN, { scope: "me", stage: null, mode: "solo" }, ME)).toHaveLength(3);
    expect(stageCounts(OPEN)).toEqual({ proposed: 1, ready: 1, "in-progress": 1, "awaiting-apply": 0 });
  });

  it("For me narrows the boxes to your changes, and Everyone brings them back", async () => {
    await mountAreas();
    expect(boxIds("checkout")).toEqual(["mine-ready", "bo-working"]);
    act(() => { root.querySelector<HTMLButtonElement>('.plan-seg[data-scope="me"]')!.click(); });
    expect(boxIds("checkout")).toEqual(["mine-ready"]);
    expect(boxIds("search")).toEqual([]);
    expect(root.querySelector('.plan-area[data-area="search"] .plan-area-empty')?.textContent).toBe("Nothing here for this view.");
    expect(JSON.parse(localStorage.getItem("ndx.plan-view")!)).toMatchObject({ scope: "me" });
    act(() => { root.querySelector<HTMLButtonElement>('.plan-seg[data-scope="all"]')!.click(); });
    expect(boxIds("checkout")).toEqual(["mine-ready", "bo-working"]);
  });

  it("a stage chip focuses the boxes on that stage; pressing it again, or Show all, clears it", async () => {
    await mountAreas();
    const chip = () => root.querySelector<HTMLButtonElement>('.plan-stage-chip[data-stage="in-progress"]')!;
    expect(chip().textContent).toBe("In progress1");
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    act(() => { chip().click(); });
    expect(chip().getAttribute("aria-pressed")).toBe("true");
    expect(boxIds("checkout")).toEqual(["bo-working"]);
    act(() => { root.querySelector<HTMLButtonElement>(".plan-show-all")!.click(); });
    expect(boxIds("checkout")).toEqual(["mine-ready", "bo-working"]);
    act(() => { chip().click(); });
    act(() => { chip().click(); });
    expect(chip().getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector(".plan-show-all")).toBeNull();
  });
});

describe("the product area boxes", () => {
  const css = readFileSync(resolve(__dirname, "../../../src/viewer/styles/stage-tiles.css"), "utf-8");
  const rule = (selector: string) =>
    new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[2] ?? "";

  it("stretches the boxes of a row to one height and clamps a summary to three lines, fading the third", () => {
    expect(rule(".plan-areas-grid")).toMatch(/align-items: stretch/);
    expect(rule(".plan-area-summary")).toMatch(/-webkit-line-clamp: 3/);
    expect(rule(".plan-area-summary--clamped")).toMatch(/mask-image: linear-gradient/);
  });

  it("opens the area on a click anywhere in the box or on Enter, and a change title opens the change instead", async () => {
    const navigateTo = await mountAreas();
    const box = root.querySelector<HTMLElement>('.plan-area[data-area="checkout"]')!;
    expect(box.tabIndex).toBe(0);
    act(() => { box.querySelector<HTMLElement>(".plan-area-count")!.click(); });
    expect(navigateTo).toHaveBeenLastCalledWith("product", { tab: "area/checkout" });
    act(() => { box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); });
    expect(navigateTo).toHaveBeenCalledTimes(2);
    act(() => { box.querySelector<HTMLButtonElement>(".plan-area-change-title")!.click(); });
    expect(navigateTo).toHaveBeenLastCalledWith("prd", { taskId: "mine-ready" });
    expect(navigateTo).toHaveBeenCalledTimes(3);
  });

  it("keeps the whole summary as its tooltip", async () => {
    await mountAreas();
    expect(root.querySelector('.plan-area[data-area="checkout"] .plan-area-summary')?.getAttribute("title")).toBe(LONG);
  });
});

const candidate = (target: string, area: string): PlacementCandidate =>
  ({ target, type: "capability", title: `Cap ${target}`, area, criteria: [], score: 5, strength: "strong", reasons: [] });

const inboxRow = (id: string, candidates: PlacementCandidate[]): InboxRow => ({
  change: { id, title: `Inbox ${id}`, stage: "proposed", inbox: true, amends: [], touches: [], taskCount: 0, completedTaskCount: 0, criteriaGap: false, openBlockers: 0 } as unknown as ChangeRow,
  shortlist: { placement: { layout: "v2", change: { id, title: id, status: "pending", taskCount: 0 }, relation: "touches", relationRule: "r", tied: false, shortlist: candidates } },
});

describe("planning from the Inbox", () => {
  it("finds the best candidate in an area, or none", () => {
    const list = [candidate("c1", "Search"), candidate("c2", "Checkout"), candidate("c3", "Checkout")];
    expect(candidateInArea(list, "Checkout")?.target).toBe("c2");
    expect(candidateInArea(list, "Billing")).toBeNull();
  });

  it("offers 'Plan in <area>' for a row's best guess, and drags under Plan", async () => {
    const onPlanIn = vi.fn();
    const row = inboxRow("i1", [candidate("c2", "Checkout")]);
    await act(async () => {
      render(h(InboxView, { rows: [row], appliedUnplaced: 0, onOpenChange: vi.fn(), scope: "all", dragToPlan: true, onPlanIn }), root);
    });
    await flush(2);
    const button = root.querySelector<HTMLButtonElement>(".inbox-plan-in")!;
    expect(button.textContent).toBe("Plan in Checkout");
    act(() => { button.click(); });
    expect(onPlanIn).toHaveBeenCalledWith(row, row.shortlist && "placement" in row.shortlist ? row.shortlist.placement.shortlist[0] : null);
    expect(root.querySelector<HTMLElement>(".inbox-row")!.getAttribute("draggable")).toBe("true");
  });

  it("For me hides the Inbox rows assigned to others, and Solo drops the assignee picker", async () => {
    const mine = { ...inboxRow("m", []), change: { ...inboxRow("m", []).change, assignee: ME } as ChangeRow };
    const theirs = { ...inboxRow("t", []), change: { ...inboxRow("t", []).change, assignee: "Bo <bo@x.io>" } as ChangeRow };
    await act(async () => { render(h(InboxView, { rows: [mine, theirs], appliedUnplaced: 0, onOpenChange: vi.fn(), scope: "me" }), root); });
    await flush(2);
    expect([...root.querySelectorAll<HTMLElement>(".inbox-row")].map((r) => r.dataset.changeId)).toEqual(["m"]);
    // Plan's scope replaces the Inbox's own assignee filter.
    expect(root.querySelector(".inbox-filters")).toBeNull();
    await act(async () => { render(h(InboxView, { rows: [mine, theirs], appliedUnplaced: 0, onOpenChange: vi.fn(), scope: "all", hideAssignees: true }), root); });
    await flush(2);
    expect(root.querySelectorAll(".inbox-row")).toHaveLength(2);
    expect(root.querySelector(".assignee-picker, .ap-trigger")).toBeNull();
  });

  it("dropping a dragged row on an area places it on that area's candidate", async () => {
    await mountAreas();
    const row = inboxRow("i1", [candidate("cap-search", "Search"), candidate("cap-checkout", "Checkout")]);
    act(() => { startPlanDrag(row, new Event("dragstart") as DragEvent); });
    const box = root.querySelector<HTMLElement>('.plan-area[data-area="checkout"]')!;
    expect(box.querySelector(".plan-area-drop")?.textContent).toBe("Drop an Inbox item here to plan it in this area");
    await act(async () => { box.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true })); });
    await flush(2);
    const place = fetchSpy.mock.calls.find(([url]) => String(url) === "/api/rex/changes/i1/place")!;
    expect(JSON.parse(String(place[1]!.body))).toEqual({ target: "cap-checkout", relation: "touches" });
    expect(root.querySelector(".plan-areas-note")?.textContent).toContain("in Checkout");
    expect(root.querySelector(".plan-area-drop")).toBeNull();
  });

  it("a drop on an area with no candidate opens placement mode instead", async () => {
    const navigateTo = await mountAreas();
    act(() => { startPlanDrag(inboxRow("i2", [candidate("cap-x", "Billing")]), new Event("dragstart") as DragEvent); });
    await act(async () => { root.querySelector<HTMLElement>('.plan-area[data-area="search"]')!.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true })); });
    expect(navigateTo).toHaveBeenCalledWith("product", { tab: "place/i2" });
    expect(fetchSpy.mock.calls.some(([url]) => String(url).endsWith("/place"))).toBe(false);
  });

  it("the open side panel steps aside, and lifts its scrim, while a row is dragged", () => {
    const panels: StageSidePanel[] = [{ id: "inbox", label: "Inbox", title: "Inbox", blurb: "b", view: "inbox" }];
    act(() => { render(h(StageSidePanels, { stage: "plan", panels, openId: "inbox", onToggle: vi.fn(), renderPanel: () => null, navigateTo: vi.fn() }), root); });
    expect(root.querySelector(".stage-side-scrim")).not.toBeNull();
    act(() => { window.dispatchEvent(new CustomEvent(PLAN_DRAG_EVENT, { detail: { active: true } })); });
    expect(root.querySelector(".stage-side-panel")?.classList.contains("stage-side-panel--peek")).toBe(true);
    expect(root.querySelector(".stage-side-scrim")).toBeNull();
    act(() => { endPlanDrag(); });
    expect(root.querySelector(".stage-side-panel")?.classList.contains("stage-side-panel--peek")).toBe(false);
  });
});

describe("Solo / Team and the newcomer tour", () => {
  it("Solo hides For me / Everyone and the assignees on the area boxes, and is remembered", async () => {
    await mountAreas();
    expect(root.querySelector(".plan-area-who")).not.toBeNull();
    act(() => { setPlanView({ mode: "solo" }); });
    expect(root.querySelector('.plan-seg[data-scope="me"]')).toBeNull();
    expect(root.querySelector(".plan-area-who")).toBeNull();
    expect(JSON.parse(localStorage.getItem("ndx.plan-view")!)).toMatchObject({ mode: "solo" });
  });

  it("the head's Solo / Team buttons switch the mode", () => {
    act(() => { render(h(PlanHeadControls, null), root); });
    const solo = root.querySelector<HTMLButtonElement>('.plan-seg[data-mode="solo"]')!;
    expect(solo.getAttribute("aria-pressed")).toBe("false");
    act(() => { solo.click(); });
    expect(solo.getAttribute("aria-pressed")).toBe("true");
  });

  it("the tour walks four steps with Next and Back, and Escape closes it, returning focus", () => {
    act(() => { render(h(PlanHeadControls, null), root); });
    const open = root.querySelector<HTMLButtonElement>(".plan-tour-open")!;
    act(() => { open.click(); });
    const card = () => root.querySelector<HTMLElement>(".plan-tour-card");
    expect(card()?.getAttribute("role")).toBe("dialog");
    expect(card()?.getAttribute("aria-modal")).toBe("true");
    expect(card()?.querySelector(".plan-tour-count")?.textContent).toBe("1 of 4");
    expect(card()?.querySelector(".plan-tour-title")?.textContent).toBe("Start here every day");
    const next = () => root.querySelector<HTMLButtonElement>(".plan-tour-next")!;
    for (let i = 0; i < 3; i++) act(() => { next().click(); });
    expect(card()?.querySelector(".plan-tour-count")?.textContent).toBe("4 of 4");
    expect(next().textContent).toBe("Done");
    act(() => { root.querySelector<HTMLButtonElement>(".plan-tour-card .prep-btn:not(.plan-tour-next)")!.click(); });
    expect(card()?.querySelector(".plan-tour-count")?.textContent).toBe("3 of 4");
    act(() => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("names the four parts it spotlights, and places its card under a part, else above, else centred", () => {
    expect(TOUR_STEPS.map((s) => s.target)).toEqual([".plan-glance", ".plan-areas-toolbar", '.stage-side-tab[data-panel="inbox"]', ".plan-areas-grid"]);
    const view = { width: 1200, height: 800 };
    expect(cardPosition({ top: 100, left: 40, width: 300, height: 100 }, view)).toEqual({ top: 212, left: 40 });
    expect(cardPosition({ top: 600, left: 40, width: 300, height: 150 }, view).top).toBe(600 - 240 - 12);
    expect(cardPosition(null, view)).toEqual({ top: 280, left: 410 });
  });
});
