// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { agentLabel, areaByChange, remainingLine, runFraction, UpNext, v1Section } from "../../../src/viewer/views/work-now.js";
import { estimateBasis, estimateFor, estimateLine, formatDuration, type RunEstimates } from "../../../src/viewer/components/run-estimate.js";
import { splitReady, type ReadyTask } from "../../../src/viewer/components/ready-to-run.js";
import { _resetPeopleForTests } from "../../../src/viewer/components/assignee.js";

const ESTIMATES: RunEstimates = {
  windowDays: 30,
  overall: { runs: 12, durationMs: 10 * 60_000, tokens: 41_000, costUsd: 0.85 },
  byTier: { heavy: { runs: 4, durationMs: 30 * 60_000, tokens: 120_000, costUsd: 3.2 } },
};

describe("run estimates", () => {
  it("uses a tier's own figure, else the overall one", () => {
    expect(estimateFor(ESTIMATES, "heavy")?.durationMs).toBe(30 * 60_000);
    expect(estimateFor(ESTIMATES, "light")).toBe(ESTIMATES.overall);
    expect(estimateFor(ESTIMATES, null)).toBe(ESTIMATES.overall);
    expect(estimateFor(null, "heavy")).toBeNull();
  });

  it("reads as one approximate line, with its basis in the tooltip", () => {
    expect(estimateLine(ESTIMATES.overall!)).toBe("~10 min · ~41k tokens · ~$0.85");
    expect(estimateLine({ ...ESTIMATES.overall!, costUsd: null })).toBe("~10 min · ~41k tokens");
    expect(estimateBasis(ESTIMATES.byTier["heavy"]!, ESTIMATES, "heavy")).toBe("Median of 4 finished heavy runs in the last 30 days");
    expect(estimateBasis(ESTIMATES.overall!, ESTIMATES, "light")).toBe("Median of 12 finished runs in the last 30 days");
  });

  it("formats durations from seconds to hours", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(80 * 60_000)).toBe("1 h 20 min");
  });
});

describe("Running now", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  const started = new Date(now - 4 * 60_000).toISOString();

  it("names the agent by vendor and model", () => {
    expect(agentLabel({ vendor: "claude", model: "sonnet" })).toBe("claude · sonnet");
    expect(agentLabel({ vendor: null, model: null })).toBe("Agent");
  });

  it("measures a run against a typical one, capped at the median", () => {
    expect(runFraction(started, 10 * 60_000, now)).toBeCloseTo(0.4);
    expect(runFraction(started, 2 * 60_000, now)).toBe(1);
    expect(runFraction(null, 10 * 60_000, now)).toBeNull();
    expect(remainingLine(started, 10 * 60_000, now)).toBe("about 6 min left");
    expect(remainingLine(started, 2 * 60_000, now)).toBe("longer than usual");
  });
});

const task = (id: string, extra: Partial<ReadyTask> = {}): ReadyTask =>
  ({ id, title: `Task ${id}`, status: "pending", priority: null, parentChain: [], criteriaCount: 0, resume: false, assignee: null, tier: null, ...extra });

describe("splitting the queue", () => {
  it("puts yours first, the unassigned by area in queue order with no area last, and counts the rest", () => {
    const areaOf = (t: ReadyTask) => ({ b: "Plan", c: "Analysis", e: "Plan" } as Record<string, string>)[t.id] ?? null;
    const tasks = [
      task("a", { assignee: "Ann <ann@x.io>" }),
      task("d"),
      task("b"),
      task("x", { assignee: "Bo <bo@x.io>" }),
      task("c"),
      task("m", { assignee: "ann@x.io" }),
      task("e"),
    ];
    const groups = splitReady(tasks, "Ann <ann@x.io>", areaOf);
    // Mine matches by email, as the assignee filter does.
    expect(groups.mine.map((t) => t.id)).toEqual(["a", "m"]);
    expect(groups.unassigned.map((g) => [g.area, g.tasks.map((t) => t.id)])).toEqual([
      ["Plan", ["b", "e"]],
      ["Analysis", ["c"]],
      [null, ["d"]],
    ]);
    expect(groups.others).toBe(1);
  });

  it("lists nothing as yours while the current user is unknown", () => {
    const groups = splitReady([task("a", { assignee: "Ann <ann@x.io>" }), task("b")], null, () => null);
    expect(groups.mine).toEqual([]);
    expect(groups.others).toBe(1);
  });

  it("reads a change's area from the product map, and a v1 task's section from its chain", () => {
    const map = { areas: [
      { id: "1", slug: "plan", title: "Plan", capabilities: [], openChangeIds: ["c1", "c2"] },
      { id: "2", slug: "map", title: "Map", capabilities: [], openChangeIds: ["c2", "c3"] },
    ], constraints: [] };
    // A change two areas count goes under the first.
    expect([...areaByChange(map)]).toEqual([["c1", "Plan"], ["c2", "Plan"], ["c3", "Map"]]);
    expect(v1Section(task("a", { parentChain: ["Epic", "Feature"] }))).toBe("Epic");
    expect(v1Section(task("a"))).toBeNull();
  });
});

describe("Up next", () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    _resetPeopleForTests();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/hench/ready")
        ? {
            dir: "/repo",
            total: 4,
            tasks: [
              task("a", { title: "Task A", priority: "high", criteriaCount: 1, assignee: "Ann <ann@x.io>", tier: "heavy", change: { id: "c1", title: "Change 1" } }),
              task("b", { title: "Task B", change: { id: "c1", title: "Change 1" } }),
              task("c", { title: "Task C", assignee: "Bo <bo@x.io>" }),
              task("d", { title: "Task D", change: { id: "c9", title: "Change 9" } }),
            ],
          }
        : url === "/api/hench/estimates" ? ESTIMATES
        : url === "/api/rex/people" ? { me: "Ann <ann@x.io>", people: [] }
        : url === "/api/status" ? {
            initialized: true,
            sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 5, modulesComplete: 6, modulesTotal: 6 },
            rex: { exists: true, layout: "v2", percentComplete: 0, stats: { total: 4, completed: 0, inProgress: 0, pending: 4, deferred: 0, blocked: 0 }, hasInProgress: false, hasPending: true, nextTaskTitle: null },
            hench: { configured: true, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
          }
        : url === "/api/rex/product" ? { layout: "v2", map: { areas: [{ id: "1", slug: "analysis", title: "Analysis page", capabilities: [], openChangeIds: ["c1"] }], constraints: [] } }
        : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }));
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    _resetPeopleForTests();
    vi.unstubAllGlobals();
  });

  it("lists your tasks, then the unassigned by product area, and counts those assigned to someone else", async () => {
    await act(async () => { render(h(UpNext, { navigateTo: vi.fn() }), root); });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect([...root.querySelectorAll(".ready-group-title")].map((e) => e.firstChild?.textContent)).toEqual(["Assigned to you", "Unassigned"]);
    const [mine, unassigned] = [...root.querySelectorAll<HTMLElement>(".ready-group")];
    expect([...mine!.querySelectorAll<HTMLElement>(".ready-row")].map((r) => r.dataset.taskId)).toEqual(["a"]);
    expect([...unassigned!.querySelectorAll(".ready-area-title")].map((e) => e.firstChild?.textContent)).toEqual(["Analysis page", "No product area"]);
    expect([...unassigned!.querySelectorAll<HTMLElement>(".ready-row")].map((r) => r.dataset.taskId)).toEqual(["b", "d"]);
    expect(root.querySelector(".ready-others")?.textContent).toBe("1 more ready task is assigned to someone else.");
  });

  it("says who each task is for, states the typical run once, and estimates only a tier with its own figure", async () => {
    await act(async () => { render(h(UpNext, { navigateTo: vi.fn() }), root); });
    for (let i = 0; i < 6; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const rows = [...root.querySelectorAll<HTMLElement>(".ready-row")];
    expect(rows.map((r) => r.querySelector(".ready-assignee")?.textContent)).toEqual(["Ann", "Unassigned", "Unassigned"]);
    expect(rows[0]!.querySelector(".ready-estimate")?.textContent).toBe("~30 min · ~120k tokens · ~$3.20");
    expect(rows[1]!.querySelector(".ready-estimate")).toBeNull();
    expect(root.querySelector(".run-typical")?.textContent).toBe("Typical run~10 min · ~41k tokens · ~$0.85");
    expect(root.querySelectorAll(".run-typical")).toHaveLength(1);
    // The tile names the list, so it draws no "Ready to run" heading of its own.
    expect(root.querySelector(".ready-title-head")).toBeNull();
  });
});
