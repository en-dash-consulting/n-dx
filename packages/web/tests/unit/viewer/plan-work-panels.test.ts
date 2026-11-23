// @vitest-environment jsdom
/**
 * The pieces of the Plan and Work redesign that are not the stage frame:
 * Plan's glance cards and product areas, Work's Statistics section and PRD
 * tools, and the Settings dropdown Workspaces sits behind.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { isMyChange, planGlanceModel } from "../../../src/viewer/views/plan-glance.js";
import { areaBoxes } from "../../../src/viewer/views/plan-areas.js";
import { WorkStats } from "../../../src/viewer/views/work-stats.js";
import { SettingsDisclosure } from "../../../src/viewer/views/settings-disclosure.js";
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
