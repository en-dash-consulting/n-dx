// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SpecGapsPanel, specGaps, NO_GAPS_LINE, NO_REQUIREMENTS_LINE } from "../../../src/viewer/views/spec-gaps.js";
import { ChangesSummaryProvider } from "../../../src/viewer/views/changes-summary-context.js";
import { gapFilter, hasGap } from "../../../src/viewer/views/changes.js";
import type { ChangeSummary, GlanceChange } from "../../../src/viewer/views/product-model.js";

function change(id: string, over: Partial<GlanceChange> = {}): GlanceChange {
  return { id, title: `Change ${id}`, stage: "proposed", taskCount: 0, completedTaskCount: 0, criteriaGap: false, openBlockers: 0, ...over };
}

function summary(open: GlanceChange[], over: Partial<ChangeSummary> = {}): ChangeSummary {
  return {
    inbox: 0,
    stages: { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 0 },
    open,
    next: null,
    requirements: { total: 1, uncovered: 0 },
    ...over,
  };
}

describe("hasGap", () => {
  it("splits criteriaGap by whether the change has tasks", () => {
    const noTasks = { criteriaGap: true, openBlockers: 0, taskCount: 0 };
    const tasks = { criteriaGap: true, openBlockers: 0, taskCount: 2 };
    expect(hasGap(noTasks, "no-criteria")).toBe(true);
    expect(hasGap(noTasks, "task-criteria")).toBe(false);
    expect(hasGap(tasks, "task-criteria")).toBe(true);
    expect(hasGap(tasks, "no-criteria")).toBe(false);
    expect(hasGap({ criteriaGap: false, openBlockers: 1, taskCount: 0 }, "blocked")).toBe(true);
  });
});

describe("specGaps", () => {
  it("lists only non-zero rows", () => {
    const { rows } = specGaps(summary(
      [change("a", { criteriaGap: true }), change("b", { criteriaGap: true }), change("c", { criteriaGap: true, taskCount: 3 }), change("d", { openBlockers: 1 })],
      { stages: { proposed: 0, ready: 0, "in-progress": 0, "awaiting-apply": 2 } },
    ));
    expect(rows.map((r) => [r.key, r.count])).toEqual([["no-criteria", 2], ["task-criteria", 1], ["blocked", 1], ["review", 2]]);
  });

  it("adds a capability row once requirements exist, and the ready line before", () => {
    const withReq = specGaps(summary([], { requirements: { total: 2, uncovered: 3 } }));
    expect(withReq.rows.map((r) => [r.key, r.count])).toEqual([["requirements", 3]]);
    expect(withReq.readyLine).toBe(false);
    const without = specGaps(summary([], { requirements: { total: 0, uncovered: 4 } }));
    expect(without.rows).toEqual([]);
    expect(without.readyLine).toBe(true);
  });
});

describe("SpecGapsPanel", () => {
  let root: HTMLElement;
  const navigateTo = vi.fn();
  beforeEach(() => { root = document.createElement("div"); document.body.appendChild(root); navigateTo.mockReset(); localStorage.clear(); });
  afterEach(() => { render(null, root); root.remove(); vi.unstubAllGlobals(); });

  const fetchSpy = vi.fn();
  async function mount(s: ChangeSummary) {
    fetchSpy.mockReset();
    fetchSpy.mockImplementation(async () => ({ ok: true, json: async () => ({ layout: "v2", summary: s }) }));
    vi.stubGlobal("fetch", fetchSpy);
    await act(async () => { render(h(ChangesSummaryProvider, null, h(SpecGapsPanel, { navigateTo })), root); });
    await act(async () => {});
  }

  it("reads the shared summary once, under the provider", async () => {
    await mount(summary([change("a", { openBlockers: 1 })]));
    const reads = fetchSpy.mock.calls.filter(([url]) => url === "/api/rex/changes/summary");
    expect(reads).toHaveLength(1);
    expect(root.querySelector('[data-gap="blocked"]')).not.toBeNull();
  });

  it("each count stores its filter and opens Open changes", async () => {
    await mount(summary([change("a", { openBlockers: 2 })]));
    const row = root.querySelector('[data-gap="blocked"] button') as HTMLButtonElement;
    expect(row.textContent).toContain("1");
    await act(async () => { row.click(); });
    expect(localStorage.getItem("ndx.changes.filter")).toBe(gapFilter("blocked"));
    expect(navigateTo).toHaveBeenCalledWith("changes");
  });

  it("without requirements shows the ready line linking Requirements, not a coverage row", async () => {
    await mount(summary([change("a", { criteriaGap: true })], { requirements: { total: 0, uncovered: 2 } }));
    expect(root.querySelector('[data-gap="requirements"]')).toBeNull();
    const line = root.querySelector(".sg-ready") as HTMLButtonElement;
    expect(line.textContent).toBe(NO_REQUIREMENTS_LINE);
    await act(async () => { line.click(); });
    expect(navigateTo).toHaveBeenCalledWith("requirements");
  });

  it("shows the empty state with no gaps", async () => {
    await mount(summary([change("a")]));
    expect(root.querySelector(".sg-empty")!.textContent).toBe(NO_GAPS_LINE);
    expect(root.querySelector(".sg-rows")).toBeNull();
  });
});
