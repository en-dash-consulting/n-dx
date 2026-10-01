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
  stuckRuns,
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
    expect(stuckRuns(s).map((r) => r.runId)).toEqual(["r2"]);
    expect(runningItems(s).map((i) => i.key)).toEqual(["run:r1"]);
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

  it("links each card to its item's Live page", async () => {
    body = snapshot({ runs: [run()], jobs: [job({ id: "analyze:server", kind: "analyze", worktree: null })] });
    await mount();
    const hrefs = [...root.querySelectorAll<HTMLAnchorElement>(".live-card-link")].map((a) => a.getAttribute("href"));
    expect(hrefs.some((x) => x?.endsWith("/live/task/t1"))).toBe(true);
    expect(hrefs.some((x) => x?.endsWith("/live/analyze"))).toBe(true);
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
