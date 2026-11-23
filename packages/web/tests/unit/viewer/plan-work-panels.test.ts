// @vitest-environment jsdom
/**
 * The pieces of the Plan and Work redesign that are not the stage frame:
 * Plan's glance cards and product areas, Work's Statistics section and PRD
 * tools, and the Settings dropdown Workspaces sits behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isMyChange, planGlanceModel, PlanGlance } from "../../../src/viewer/views/plan-glance.js";
import { areaBoxes } from "../../../src/viewer/views/plan-areas.js";
import { WorkStats } from "../../../src/viewer/views/work-stats.js";
import { RexDashboard } from "../../../src/viewer/views/rex-dashboard.js";
import { SettingsDisclosure } from "../../../src/viewer/views/settings-disclosure.js";
import { StagePage } from "../../../src/viewer/views/stage-pages.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { ReadyToRun, type ReadyTask } from "../../../src/viewer/components/ready-to-run.js";
import { _primePeopleForTests, _resetPeopleForTests } from "../../../src/viewer/components/assignee.js";
import { getRegisteredPollers, resetPollingManager } from "../../../src/viewer/polling/polling-manager.js";
import { buildValidViews } from "../../../src/shared/index.js";
import type { ChangeSummary, GlanceChange, ProductMap } from "../../../src/viewer/views/product-model.js";

const change = (id: string, extra: Partial<GlanceChange> = {}): GlanceChange => ({
  id, title: `Change ${id}`, stage: "ready", taskCount: 1, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...extra,
});

const summary = (open: GlanceChange[], next: ChangeSummary["next"] = null): ChangeSummary => ({
  inbox: 0, inboxInStage: 0, stages: { proposed: 0, ready: open.length, "in-progress": 0, "awaiting-apply": 0 },
  open, next, requirements: { total: 0, uncovered: 0 },
});

const ME = "Ann <ann@x.io>";

describe("Plan's glance cards", () => {
  it("counts a change as yours by its own assignee or an open task's, matched by email", () => {
    expect(isMyChange(change("a", { assignee: "Ann Lee <ann@x.io>" }), ME)).toBe(true);
    expect(isMyChange(change("a", { taskAssignees: ["Bo <bo@x.io>", "ann@x.io"] }), ME)).toBe(true);
    expect(isMyChange(change("a", { assignee: "Bo <bo@x.io>" }), ME)).toBe(false);
    expect(isMyChange(change("a", { assignee: ME }), null)).toBe(false);
  });

  it("names your change in progress before your other open ones", () => {
    const model = planGlanceModel(summary([
      change("ready-high", { assignee: ME, priority: "high" }),
      change("working", { assignee: ME, priority: "low", stage: "in-progress" }),
    ]), ME);
    expect(model.mine).toEqual({ change: expect.objectContaining({ id: "working" }), active: true });
  });

  it("falls back to your next open change, said as next rather than in progress", () => {
    const model = planGlanceModel(summary([change("low", { assignee: ME, priority: "low" }), change("high", { assignee: ME, priority: "high" })]), ME);
    expect(model.mine).toEqual({ change: expect.objectContaining({ id: "high" }), active: false });
    expect(planGlanceModel(summary([change("x")]), ME).mine).toBeNull();
  });

  it("leads with a prioritized change, then by priority", () => {
    const model = planGlanceModel(summary([
      change("critical", { priority: "critical" }),
      change("marked", { priority: "low", prioritized: true }),
    ]), null);
    expect(model.top?.id).toBe("marked");
    expect(planGlanceModel(summary([]), null).top).toBeNull();
  });

  it("names the release being planned and what is open in it, skipping the unscheduled", () => {
    const model = planGlanceModel(summary([
      change("a", { plannedRelease: "1.0", stage: "in-progress" }),
      change("b", { plannedRelease: "1.0" }),
      change("c", { plannedRelease: "0.9" }),
      change("d"),
    ]), null);
    // Newest first, as the open-changes glance groups them.
    expect(model.release).toEqual({ label: "1.0", open: 2, inProgress: 1 });
    expect(model.openCount).toBe(4);
    expect(planGlanceModel(summary([change("d")]), null).release).toBeNull();
  });
});

describe("Plan's product areas", () => {
  const map: ProductMap = {
    areas: [
      { id: "1", slug: "checkout", title: "Checkout", summary: "Paying", capabilities: [], openChangeIds: ["b", "a"] },
      { id: "2", slug: "search", title: "Search", capabilities: [], openChangeIds: [] },
    ],
    constraints: [],
  };

  it("boxes each area's open changes in queue order, counting in progress against planned", () => {
    const boxes = areaBoxes(map, [
      change("a", { priority: "low", stage: "in-progress" }),
      change("b", { priority: "critical" }),
      change("loose", { priority: "medium" }),
    ]);
    expect(boxes.map((b) => [b.slug, b.title, b.changes.map((c) => c.id), b.inProgress, b.planned])).toEqual([
      ["checkout", "Checkout", ["b", "a"], 1, 1],
      ["search", "Search", [], 0, 0],
      // A change no area counts still shows, in a box of its own.
      [null, "Not in an area", ["loose"], 0, 1],
    ]);
    expect(boxes[0]!.summary).toBe("Paying");
  });

  it("draws no overflow box when every change sits in an area, and ignores ids that are not open", () => {
    const boxes = areaBoxes(map, [change("a")]);
    expect(boxes.map((b) => b.slug)).toEqual(["checkout", "search"]);
    expect(boxes[0]!.changes.map((c) => c.id)).toEqual(["a"]);
  });
});

describe("Work's Statistics", () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url === "/api/rex/dashboard"
        ? {
            title: "PRD", layout: "v2", percentComplete: 40, nextTask: null,
            stats: { total: 10, completed: 4, inProgress: 2, pending: 3, deferred: 0, blocked: 1 },
            priorities: { critical: 1, high: 2, medium: 3, low: 0, unset: 4 },
            epics: [{ id: "c1", title: "Change one", status: "in_progress", stats: { total: 1, completed: 0, inProgress: 1, pending: 0, deferred: 0, blocked: 0 }, percentComplete: 0, type: "change" }],
          }
        : url === "/api/rex/health"
          ? { overall: 72, dimensions: { depth: 80, balance: 60, granularity: 70, completeness: 75, staleness: 90 }, suggestions: ["Split the big change"] }
          : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }));
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  it("puts the totals, progress, status, priority and structure health in one section, and no change progress", async () => {
    await act(async () => { render(h(WorkStats, null), root); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const stats = [...root.querySelectorAll(".rex-dash-stat")].map((s) => [s.querySelector(".rex-dash-stat-label")?.textContent, s.querySelector(".rex-dash-stat-value")?.textContent]);
    expect(stats).toEqual([["Total", "10"], ["Done", "4"], ["Active", "2"], ["Pending", "3"], ["Blocked", "1"]]);
    expect(root.querySelector(".rex-dash-progress-pct")?.textContent).toBe("40%");
    const titles = [...root.querySelectorAll(".rex-dash-panel-title")].map((t) => t.textContent);
    expect(titles).toEqual(["Priority Distribution", "Status Breakdown", "Structure Health"]);
    expect(root.querySelector(".rex-dash-health-suggestions")?.textContent).toContain("Split the big change");
    // Change progress is Plan's to show, not Work's.
    expect(root.textContent).not.toContain("Change one");
    expect(root.querySelector(".rex-dash-epics, .rex-dash-epic")).toBeNull();
  });
});

// ── Fixes from the adversarial review ────────────────────────────────

async function flush(n = 6) {
  for (let i = 0; i < n; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

describe("side panel layout (F1)", () => {
  const css = readFileSync(resolve(__dirname, "../../../src/viewer/styles/stage-tiles.css"), "utf-8");
  const rule = (selector: string) => {
    const m = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css);
    return m?.[2] ?? "";
  };

  it("keeps the tab column in the page's flow, sticky, never fixed to the viewport", () => {
    expect(rule(".stage-side-tabs")).toMatch(/position: sticky/);
    expect(rule(".stage-side-tabs")).not.toMatch(/position: fixed/);
    expect(rule(".stage-side-tab")).not.toMatch(/position: fixed/);
    // The page is two columns: the page, then the tabs beside it.
    expect(rule(".stage-page--side")).toMatch(/grid-template-columns: minmax\(0, 1fr\) auto/);
  });

  it("renders the tabs as the page's second column, beside its content", async () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response));
    await act(async () => {
      render(h(StagePage, { stage: "work", validViews: buildValidViews(null), navigateTo: vi.fn(), renderView: () => null, renderSidePanel: () => null }), root);
    });
    const page = root.querySelector<HTMLElement>(".stage-page--side")!;
    expect([...page.children].map((c) => c.className)).toEqual(["stage-page-main", "stage-side-tabs"]);
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });
});

describe("side panel keyboard and focus (F3)", () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response));
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  const mount = () => act(() => {
    render(h("div", null,
      h("button", { type: "button", class: "outside" }, "Behind the scrim"),
      h(StagePage, {
        stage: "plan", validViews: buildValidViews(null), navigateTo: vi.fn(), renderView: () => null,
        renderSidePanel: () => h("div", null, h("button", { type: "button", class: "first-in-body" }, "A"), h("button", { type: "button", class: "last-in-body" }, "B")),
      }),
    ), root);
  });
  const tab = () => root.querySelector<HTMLButtonElement>('.stage-side-tab[data-panel="plan-health"]')!;
  const panel = () => root.querySelector<HTMLElement>(".stage-side-panel");

  it("uses disclosure buttons, not tab roles, and opens an aria-modal dialog", () => {
    mount();
    expect(root.querySelector('[role="tablist"].stage-side-tabs, .stage-side-tab[role="tab"]')).toBeNull();
    expect(tab().getAttribute("aria-expanded")).toBe("false");
    act(() => { tab().click(); });
    expect(tab().getAttribute("aria-expanded")).toBe("true");
    expect(panel()?.getAttribute("role")).toBe("dialog");
    expect(panel()?.getAttribute("aria-modal")).toBe("true");
  });

  it("closes on a scrim click and returns focus to the tab", () => {
    mount();
    tab().focus();
    act(() => { tab().click(); });
    act(() => { root.querySelector<HTMLElement>(".stage-side-scrim")!.click(); });
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(tab());
  });

  it("keeps focus inside: Tab wraps at the ends, and focus that lands behind the scrim comes back", () => {
    mount();
    act(() => { tab().click(); });
    const last = root.querySelector<HTMLButtonElement>(".last-in-body")!;
    last.focus();
    act(() => { panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(root.querySelector(".stage-side-open"));
    act(() => { panel()!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); });
    expect(document.activeElement).toBe(last);
    act(() => { root.querySelector<HTMLButtonElement>(".outside")!.focus(); });
    expect(document.activeElement?.classList.contains("stage-side-title")).toBe(true);
  });
});

describe("Work's Statistics polling (F2)", () => {
  let a: HTMLDivElement;
  let b: HTMLDivElement;
  beforeEach(() => {
    resetPollingManager();
    a = document.createElement("div");
    b = document.createElement("div");
    document.body.append(a, b);
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ title: "PRD", stats: { total: 0, completed: 0, inProgress: 0, pending: 0, deferred: 0, blocked: 0 }, percentComplete: 0, epics: [], nextTask: null, priorities: { critical: 0, high: 0, medium: 0, low: 0, unset: 0 } }) }) as Response));
  });
  afterEach(() => {
    act(() => { render(null, a); render(null, b); });
    a.remove();
    b.remove();
    resetPollingManager();
    vi.unstubAllGlobals();
  });

  it("keeps the tile's poll when the full-screen dashboard beside it unmounts", async () => {
    const dashboardKeys = () => getRegisteredPollers().map((p) => p.key).filter((k) => k.startsWith("rex-dashboard"));
    await act(async () => { render(h(WorkStats, null), a); });
    await act(async () => { render(h(RexDashboard, null), b); });
    await flush(2);
    const both = dashboardKeys();
    expect(both).toHaveLength(2);
    act(() => { render(null, b); });
    expect(dashboardKeys()).toEqual([both[0]]);
  });
});

describe("Ready to run's counts when split (F4)", () => {
  let root: HTMLDivElement;
  const t = (id: string, assignee: string | null): ReadyTask =>
    ({ id, title: `Task ${id}`, status: "pending", priority: null, parentChain: [], criteriaCount: 0, resume: false, assignee, tier: null });
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    const tasks = [t("m1", "Ann <ann@x.io>"), t("m2", "Ann <ann@x.io>"), t("m3", "Ann <ann@x.io>"), t("m4", "Ann <ann@x.io>"), t("u1", null), t("o1", "Bo <bo@x.io>"), t("o2", "Bo <bo@x.io>")];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ dir: "/repo", total: tasks.length, tasks }) }) as Response));
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  it("counts and offers only the rows it can list: yours and the unassigned", async () => {
    await act(async () => {
      render(h(ReadyToRun, { heading: false, split: { me: "Ann <ann@x.io>", areaOf: () => null }, onPrepare: vi.fn(), onOpenLive: vi.fn(), onOpenPrd: vi.fn() }), root);
    });
    await flush();
    // Three of the four yours, and the one unassigned, are on screen; Bo's two never are.
    expect(root.querySelectorAll(".ready-row")).toHaveLength(4);
    expect(root.querySelector(".ready-count")?.textContent).toBe("4 of 5");
    expect(root.querySelector(".ready-more")?.textContent).toBe("Show all 5");
  });
});

describe("the Highest priority card (F5)", () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    _primePeopleForTests({ me: null, people: [] });
    const body = { layout: "v2", summary: summary([change("top", { priority: "critical", assignee: "Ann Lee <ann@x.io>" })]) };
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body }) as Response));
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    _resetPeopleForTests();
    vi.unstubAllGlobals();
  });

  it("names the assignee as the dashboard does elsewhere, not by the stored identity", async () => {
    await act(async () => { render(h(ChangesSummaryProvider, null, h(PlanGlance, { navigateTo: vi.fn() })), root); });
    await flush();
    const card = root.querySelector(".plan-glance-card--top")!;
    expect(card.textContent).toContain("Assigned to Ann Lee.");
    expect(card.textContent).not.toContain("ann@x.io");
  });
});

describe("the Settings dropdown", () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    localStorage.clear();
    root = document.createElement("div");
    document.body.appendChild(root);
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    localStorage.clear();
  });

  const mount = () => act(() => {
    render(h(SettingsDisclosure, { id: "workspaces", title: "Workspaces", blurb: "Every worktree." }, h("div", { class: "inside" })), root);
  });
  const toggle = () => root.querySelector<HTMLButtonElement>(".settings-disclosure-toggle")!;

  it("starts collapsed, mounting nothing, and expands to its content", () => {
    mount();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(toggle().textContent).toContain("Workspaces");
    expect(root.querySelector(".inside")).toBeNull();
    act(() => { toggle().click(); });
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
    expect(toggle().getAttribute("aria-controls")).toBe("settings-disclosure-workspaces");
    expect(root.querySelector("#settings-disclosure-workspaces .inside")).not.toBeNull();
  });

  it("remembers the choice for the next visit", () => {
    mount();
    act(() => { toggle().click(); });
    act(() => { render(null, root); });
    mount();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");
  });
});
