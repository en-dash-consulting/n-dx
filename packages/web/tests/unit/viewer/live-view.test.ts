// @vitest-environment jsdom
/**
 * The Live overview: how it reads `/api/live` (pure model) and what it renders
 * for the states the acceptance criteria name — stuck runs, mixed running
 * cards, long jobs, and the idle state with its two actions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { LiveSnapshot } from "../../../src/viewer/hooks/use-live.js";
import { LiveView } from "../../../src/viewer/views/live.js";
import {
  formatBytes,
  isIdle,
  machineTiles,
  phaseSegments,
  runningItems,
  stopAllPrompt,
  stoppableRuns,
  attentionRuns,
  canEndRun,
  endableDeadRuns,
  reconcileNotice,
  updatedLabel,
  worktreeRows,
} from "../../../src/viewer/views/live-model.js";

const WORKTREE = { key: "main", name: "repo", path: "/repo", branch: "main", isAnchor: true, isServed: true };
const OTHER = { key: "feat", name: "repo-feat", path: "/repo-feat", branch: "feat/x", isAnchor: false, isServed: false };

function run(over: Record<string, unknown> = {}) {
  return {
    runId: "r1", taskId: "t1", taskTitle: "Fix the thing", epicChain: [{ id: "e", title: "Epic", level: "epic" }, { id: "f", title: "Feature", level: "feature" }],
    status: "running", branch: "feat/x", worktree: WORKTREE, startedAt: "2026-10-01T10:00:00.000Z", finishedAt: null,
    turns: 4, tokens: { input: 1000, output: 500, cacheCreationInput: 0, cacheReadInput: 0, total: 1500 },
    model: "sonnet", vendor: "claude", criteriaTotal: 3, stale: false, lastProgress: "Editing a.ts", lastActivityAt: null,
    heartbeatAgeMs: 1000, ...over,
  };
}

function job(over: Record<string, unknown> = {}) {
  return { id: "sv-analyze:main", kind: "sv-analyze", worktree: WORKTREE, startedAt: "2026-10-01T10:05:00.000Z", detail: null, progress: null, ...over };
}

function snapshot(over: Record<string, unknown> = {}): LiveSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    runs: [], jobs: [],
    queue: { next: [{ id: "n1", title: "Next up", priority: "high", epicChain: [] }], starting: [] },
    machine: {
      slots: { inUse: 1, max: 3, available: 2 },
      memory: { freeBytes: 8 * 1024 ** 3, totalBytes: 16 * 1024 ** 3, floorBytes: 2 * 1024 ** 3, belowFloor: false },
      llm: { vendor: "claude", model: "sonnet" },
      worktrees: { total: 4, withLiveRun: 1 },
      spend: { todayUsd: 1.5, todayTokens: 1000, inFlightUsd: 0.25, inFlightTokens: 100 },
    },
    recent: [],
    counts: { running: 0, stale: 0, jobs: 0 },
    ...over,
  } as unknown as LiveSnapshot;
}

describe("reading the snapshot", () => {
  it("separates stuck runs from running ones", () => {
    const s = snapshot({ runs: [run(), run({ runId: "r2", stale: true })] });
    expect(attentionRuns(s).map((r) => r.runId)).toEqual(["r2"]);
    expect(runningItems(s).map((i) => i.key)).toEqual(["run:r1"]);
  });

  it("lists orphaned and unknown runs from every worktree as needing attention, with their reasons", () => {
    const s = snapshot({
      runs: [
        run({ liveness: "live" }),
        run({ runId: "r2", worktree: OTHER, liveness: "orphaned", livenessReason: "pid 9 is gone", canEnd: true }),
        run({ runId: "r3", liveness: "unknown", livenessReason: "no pid recorded", canEnd: true }),
        run({ runId: "r4", worktree: OTHER, liveness: "foreign", livenessReason: "other host", canEnd: false }),
      ],
    });
    expect(attentionRuns(s).map((r) => r.runId)).toEqual(["r2", "r3"]);
    expect(runningItems(s).map((i) => i.key).sort()).toEqual(["run:r1", "run:r4"]);
    expect(endableDeadRuns(s).map((r) => r.runId)).toEqual(["r2"]);
  });

  it("offers a single End for orphaned and unknown runs only — never foreign", () => {
    expect(canEndRun(run({ liveness: "orphaned", canEnd: true }) as never)).toBe(true);
    expect(canEndRun(run({ liveness: "unknown", canEnd: true }) as never)).toBe(true);
    expect(canEndRun(run({ liveness: "foreign", canEnd: false }) as never)).toBe(false);
    expect(canEndRun(run({ liveness: "live", canEnd: false }) as never)).toBe(false);
  });

  it("summarises a reconcile answer", () => {
    expect(reconcileNotice({ ended: 2, failed: 0, worktrees: [] })).toBe("Ended 2 runs");
    expect(reconcileNotice({ ended: 1, failed: 1, worktrees: [{ outcomes: [{ skipped: "x" }] }] }))
      .toBe("Ended 1 run · 1 changed and were left alone · 1 could not be written");
  });

  it("interleaves runs and jobs, newest first", () => {
    const s = snapshot({ runs: [run()], jobs: [job()] });
    expect(runningItems(s).map((i) => i.key)).toEqual(["job:sv-analyze:main", "run:r1"]);
  });

  it("is idle only with no run, job or starting execution — a stuck run is not idle", () => {
    expect(isIdle(snapshot())).toBe(true);
    expect(isIdle(snapshot({ runs: [run({ stale: true })] }))).toBe(false);
    expect(isIdle(snapshot({ jobs: [job()] }))).toBe(false);
    const starting = { taskId: "t", taskTitle: "T", startedAt: "x", worktree: WORKTREE };
    expect(isIdle(snapshot({ queue: { next: [], starting: [starting] } }))).toBe(false);
  });

  it("builds six phase segments: done, active, pending", () => {
    expect(phaseSegments({ phase: { index: 3, name: "zones", total: 6 }, batch: null }))
      .toEqual(["done", "done", "active", "pending", "pending", "pending"]);
    expect(phaseSegments(null)).toEqual(Array(6).fill("pending"));
  });

  it("flags memory under the floor and a full slot set", () => {
    const m = snapshot().machine;
    expect(machineTiles(m, 0, 0).some((t) => t.warn)).toBe(false);
    const tight = { ...m, slots: { ...m.slots, available: 0 }, memory: { ...m.memory, belowFloor: true } };
    expect(machineTiles(tight, 0, 0).filter((t) => t.warn).map((t) => t.key)).toEqual(["slots", "memory"]);
  });

  it("lists worktrees with something live and counts the idle rest", () => {
    const s = snapshot({ runs: [run(), run({ runId: "r2", worktree: OTHER, stale: true })], machine: { ...snapshot().machine, worktrees: { total: 5, withLiveRun: 2 } } });
    const { rows, idle } = worktreeRows(s);
    expect(rows.map((r) => r.worktree.key).sort()).toEqual(["feat", "main"]);
    expect(rows.find((r) => r.worktree.key === "feat")?.stuck).toBe(1);
    expect(idle).toBe(3);
  });

  it("counts only the served worktree's runs as stoppable", () => {
    const s = snapshot({ runs: [run(), run({ runId: "r2", worktree: OTHER })], jobs: [job()] });
    expect(stoppableRuns(s).map((r) => r.runId)).toEqual(["r1"]);
    expect(stoppableRuns(snapshot({ runs: [run({ worktree: OTHER })], jobs: [job()] }))).toEqual([]);
    expect(stopAllPrompt(1)).toContain("Stop 1 run in this worktree");
    expect(stopAllPrompt(3)).toContain("Stop 3 runs in this worktree");
    expect(stopAllPrompt(3)).toContain("other worktrees are not affected");
  });

  it("formats bytes and the age of the answer", () => {
    expect(formatBytes(8 * 1024 ** 3)).toBe("8.0 GB");
    expect(formatBytes(512 * 1024 ** 2)).toBe("512 MB");
    expect(updatedLabel("2026-10-01T10:00:00.000Z", Date.parse("2026-10-01T10:00:07.400Z"))).toBe("updated 7 s ago");
  });
});

describe("the rendered page", () => {
  let root: HTMLDivElement;
  let body: LiveSnapshot;
  let calls: Array<{ url: string; init?: RequestInit }>;
  const jobs = { refresh: vi.fn(async () => {}), operations: [] } as never;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    body = snapshot();
    calls = [];
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes("/api/live")) return { ok: true, status: 200, json: async () => body };
      if (String(url).includes("/api/hench/throttle")) return { ok: true, status: 200, json: async () => ({ paused: false }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  // The fetch mock resolves on the microtask queue, so draining it is enough —
  // no timer is the barrier.
  async function flush() {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }

  async function mount(navigateTo = vi.fn()) {
    act(() => { render(h(LiveView, { navigateTo, analyzedAt: null, jobs }), root); });
    await act(async () => { await flush(); });
    return navigateTo;
  }

  it("shows idle with Start working and both analysis options when nothing runs", async () => {
    await mount();
    expect(root.querySelector(".live-idle")).not.toBeNull();
    expect(root.textContent).toContain("Start working");
    expect(root.textContent).toContain("Run analysis (fast)");
    expect(root.textContent).toContain("Run analysis (deep)");
    expect(root.querySelector(".live-cards")).toBeNull();
  });

  it("disables Stop all when every live run is in another worktree, and names the count otherwise", async () => {
    const stopAll = () => root.querySelector<HTMLButtonElement>(".live-stop-all")!;
    body = snapshot({ runs: [run({ worktree: OTHER })], jobs: [job()] });
    await mount();
    expect(stopAll().disabled).toBe(true);

    render(null, root);
    body = snapshot({ runs: [run(), run({ runId: "r2", worktree: OTHER })] });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    await mount();
    expect(stopAll().disabled).toBe(false);
    await act(async () => { stopAll().click(); await flush(); });
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("Stop 1 run in this worktree"));
  });

  it("starts the next task through the execute route", async () => {
    await mount();
    const start = [...root.querySelectorAll("button")].find((b) => b.textContent === "Start working")!;
    await act(async () => { start.click(); await flush(); });
    const post = calls.find((c) => c.url.includes("/api/hench/execute"));
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toMatchObject({ taskId: "n1" });
  });

  it("runs a fast analysis and a deep one", async () => {
    await mount();
    const press = async (label: string) => {
      const b = [...root.querySelectorAll("button")].find((x) => x.textContent === label)!;
      await act(async () => { b.click(); await flush(); });
    };
    await press("Run analysis (fast)");
    await press("Run analysis (deep)");
    const bodies = calls.filter((c) => c.url.includes("/api/commands/sv-analyze")).map((c) => JSON.parse(String(c.init?.body)));
    expect(bodies).toEqual([{}, { full: true, deep: true }]);
  });

  it("lists stuck runs under Needs attention, not Running now, and marks them stuck via the existing route", async () => {
    body = snapshot({ runs: [run(), run({ runId: "r2", taskTitle: "Stuck one", stale: true, worktree: OTHER })] });
    await mount();
    const attention = root.querySelector(".live-attention")!;
    expect(attention.textContent).toContain("Stuck one");
    const running = root.querySelector("#live-running-h")!.parentElement!;
    expect(running.textContent).toContain("Fix the thing");
    expect(running.textContent).not.toContain("Stuck one");
    expect(root.querySelector(".live-idle")).toBeNull();

    const mark = [...attention.querySelectorAll("button")].find((b) => b.textContent === "Mark stuck")!;
    await act(async () => { mark.click(); await flush(); });
    const post = calls.find((c) => c.url.includes("/mark-stuck"));
    expect(post?.url).toBe("/api/hench/runs/r2/mark-stuck");
    expect(post?.init?.method).toBe("POST");
    // Another worktree's run is addressed by header, not by the URL.
    expect((post?.init?.headers as Record<string, string>)["X-Ndx-Workspace"]).toBe("feat");
  });

  describe("dead runs", () => {
    const dead = (id: string, over: Record<string, unknown> = {}) =>
      run({ runId: id, taskTitle: `Dead ${id}`, liveness: "orphaned", livenessReason: `pid of ${id} is gone`, canEnd: true, ...over });
    const reconcileCalls = () => calls.filter((c) => c.url.includes("/api/hench/runs/reconcile"));
    const button = (label: string) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);

    it("shows each verdict badge and reason under Needs attention, from every worktree", async () => {
      body = snapshot({ runs: [run(), dead("d1"), dead("d2", { worktree: OTHER }), run({ runId: "u1", taskTitle: "Unsure", liveness: "unknown", livenessReason: "no lock file", canEnd: true })] });
      await mount();
      const attention = root.querySelector(".live-attention")!;
      expect(attention.textContent).toContain("Dead d1");
      expect(attention.textContent).toContain("Dead d2");
      expect(attention.textContent).toContain("pid of d2 is gone");
      expect(attention.textContent).toContain("Not running");
      expect(attention.textContent).toContain("Unverified");
      expect(attention.textContent).toContain("no lock file");
      expect(root.querySelector("#live-running-h")!.parentElement!.textContent).not.toContain("Dead d1");
    });

    it("End N dead runs confirms, then ends only the orphaned runs through the reconcile route", async () => {
      body = snapshot({ runs: [dead("d1"), dead("d2", { worktree: OTHER }), run({ runId: "u1", liveness: "unknown", canEnd: true })] });
      const confirm = vi.fn(() => true);
      vi.stubGlobal("confirm", confirm);
      await mount();
      expect(button("End 2 dead runs")).toBeDefined();
      await act(async () => { button("End 2 dead runs")!.click(); await flush(); });
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("End 2 dead runs"));
      expect(reconcileCalls()).toHaveLength(1);
      expect(JSON.parse(String(reconcileCalls()[0].init?.body))).toEqual({ runIds: ["d1", "d2"] });
    });

    it("ends nothing when the confirm is declined", async () => {
      body = snapshot({ runs: [dead("d1")] });
      vi.stubGlobal("confirm", vi.fn(() => false));
      await mount();
      await act(async () => { button("End 1 dead run")!.click(); await flush(); });
      expect(reconcileCalls()).toHaveLength(0);
    });

    it("ends an unknown run one at a time, after a confirm that shows the reason", async () => {
      body = snapshot({ runs: [run({ runId: "u1", taskTitle: "Unsure", liveness: "unknown", livenessReason: "no lock file", canEnd: true })] });
      const confirm = vi.fn(() => true);
      vi.stubGlobal("confirm", confirm);
      await mount();
      expect(root.querySelector(".live-end-dead")).toBeNull();
      await act(async () => { button("End run")!.click(); await flush(); });
      expect(confirm).toHaveBeenCalledWith(expect.stringContaining("no lock file"));
      expect(JSON.parse(String(reconcileCalls()[0].init?.body))).toEqual({ runIds: ["u1"], includeUnknown: true });
    });

    it("an unknown run is not ended when its confirm is declined", async () => {
      body = snapshot({ runs: [run({ runId: "u1", liveness: "unknown", livenessReason: "no lock file", canEnd: true })] });
      vi.stubGlobal("confirm", vi.fn(() => false));
      await mount();
      await act(async () => { button("End run")!.click(); await flush(); });
      expect(reconcileCalls()).toHaveLength(0);
    });

    it("shows a foreign run with its reason but no end action", async () => {
      body = snapshot({ runs: [run({ runId: "f1", taskTitle: "Elsewhere", stale: true, liveness: "foreign", livenessReason: "started on host-b", canEnd: false })] });
      await mount();
      const attention = root.querySelector(".live-attention")!;
      expect(attention.textContent).toContain("Other machine");
      expect(attention.textContent).toContain("started on host-b");
      expect(button("End run")).toBeUndefined();
      expect(button("Mark stuck")).toBeUndefined();
      expect(attention.querySelector(".live-end-dead")).toBeNull();
    });
  });

  it("links each card to its item's Live page", async () => {
    body = snapshot({ runs: [run()], jobs: [job({ id: "analyze:server", kind: "analyze", worktree: null })] });
    await mount();
    const hrefs = [...root.querySelectorAll<HTMLAnchorElement>(".live-card-link")].map((a) => a.getAttribute("href"));
    expect(hrefs.some((x) => x?.endsWith("/live/task/t1"))).toBe(true);
    expect(hrefs.some((x) => x?.endsWith("/live/analyze"))).toBe(true);
  });

  it("links a finished run to its own worktree's run detail", async () => {
    body = snapshot({
      runs: [run()],
      recent: [
        run({ runId: "served", status: "completed", finishedAt: "2026-10-01T10:30:00.000Z" }),
        run({ runId: "other", status: "completed", worktree: OTHER, finishedAt: "2026-10-01T10:31:00.000Z" }),
      ],
    });
    await mount();
    const hrefs = [...root.querySelectorAll<HTMLAnchorElement>(".live-recent a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toHaveLength(2);
    expect(hrefs.find((x) => x?.endsWith("/hench-runs/served"))).not.toContain("/w/");
    expect(hrefs.find((x) => x?.endsWith("/hench-runs/other"))).toContain("/w/feat/hench-runs/other");
  });

  it("shows a six-segment bar for a sourcevision analysis and the last output line for other jobs", async () => {
    body = snapshot({
      jobs: [
        job({ progress: { phase: { index: 4, name: "zones", total: 6 }, batch: null, pass: { number: 2, label: "relationships" } } }),
        job({ id: "ci:main", kind: "ci", detail: "running lint" }),
      ],
    });
    await mount();
    expect(root.querySelectorAll(".live-phase").length).toBe(6);
    expect(root.querySelector(".live-phase-active")).not.toBeNull();
    expect(root.textContent).toContain("zones · pass 2 relationships");
    expect(root.textContent).toContain("running lint");
  });

  it("collapses idle worktrees and lists the queue", async () => {
    body = snapshot({ runs: [run()] });
    await mount();
    // The pause control appears once the throttle state has been read.
    await act(async () => { await flush(); });
    expect(root.textContent).toContain("3 more idle");
    expect(root.textContent).toContain("Next up");
    expect(root.textContent).toContain("Pause loop after current");
  });
});
