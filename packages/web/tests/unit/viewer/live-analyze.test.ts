// @vitest-environment jsdom
/**
 * The Live analysis page: its pure reading (live-analyze-model.ts) and what it
 * renders for the acceptance criteria — each phase against the previous run's
 * time, no estimate without a previous run, Stop for both kinds of start, and
 * a failed or stopped run naming its phase and error.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { AnalyzeProgressFile, LiveAnalyzeSnapshot } from "../../../src/viewer/hooks/use-live-analyze.js";
import { LIVE_ANALYZE_POLL_RUNNING_MS } from "../../../src/viewer/hooks/use-live-analyze.js";
import { LiveAnalyzeView } from "../../../src/viewer/views/live-analyze.js";
import {
  analyzeTitle,
  barSegments,
  cacheReuse,
  classRows,
  failureSummary,
  fileRows,
  formatMs,
  headerChips,
  narrationLine,
  passRows,
  phaseRows,
  phaseTimeLabel,
  runState,
  runningNotes,
} from "../../../src/viewer/views/live-analyze-model.js";

const START = "2026-10-01T10:00:00.000Z";
const NOW = Date.parse("2026-10-01T10:03:00.000Z");

function progress(over: Partial<AnalyzeProgressFile> = {}): AnalyzeProgressFile {
  return {
    pid: 4242, status: "running", mode: "generative", scope: null, startedAt: START, updatedAt: "2026-10-01T10:02:59.000Z",
    command: "sv analyze --full",
    phase: { index: 4, name: "zones", total: 6 },
    phases: [
      { index: 1, name: "inventory", startedAt: START, endedAt: "2026-10-01T10:00:20.000Z", durationMs: 20_000, outcome: "ok" },
      { index: 2, name: "imports", startedAt: "2026-10-01T10:00:20.000Z", endedAt: "2026-10-01T10:00:50.000Z", durationMs: 30_000, outcome: "ok" },
      { index: 3, name: "classifications", startedAt: "2026-10-01T10:00:50.000Z", endedAt: "2026-10-01T10:01:00.000Z", durationMs: 10_000, outcome: "ok" },
      { index: 4, name: "zones", startedAt: "2026-10-01T10:01:00.000Z" },
    ],
    pass: { number: 2, label: "LLM cross-zone relationships" },
    batch: { label: "enrich", done: 3, total: 8 },
    judgmentCache: { hits: 12, misses: 28 },
    llm: {
      calls: 7, inputTokens: 90_000, outputTokens: 10_000, durationMs: 60_000,
      byTaskClass: {
        naming: { calls: 3, inputTokens: 30_000, outputTokens: 3_000, durationMs: 20_000, vendor: "claude", model: "claude-sonnet-4-5" },
        enrich: { calls: 4, inputTokens: 60_000, outputTokens: 7_000, durationMs: 40_000, vendor: "claude", model: "claude-sonnet-4-5" },
      },
    },
    running: true, stale: false,
    previous: { at: "2026-09-30T10:00:00.000Z", durationMs: 250_000, phases: { inventory: 25_000, imports: 28_000, zones: 120_000 } },
    ...over,
  };
}

function snapshot(over: Partial<LiveAnalyzeSnapshot> = {}): LiveAnalyzeSnapshot {
  return {
    generatedAt: new Date(NOW).toISOString(),
    worktree: { key: "feat", name: "repo-feat", path: "/repo-feat", branch: "feat/x", isAnchor: false, isServed: true },
    progress: progress(),
    startedFrom: "dashboard",
    output: { available: true, lines: ["[phase 1] inventory", "[phase 4] zones"] },
    llm: { vendor: "claude", model: "claude-sonnet-4-5" },
    costUsd: 0.41,
    modules: [
      { name: "inventory", status: "complete", startedAt: START, completedAt: "2026-10-01T10:00:20.000Z", error: null },
      { name: "imports", status: "complete", startedAt: START, completedAt: "2026-09-30T10:00:50.000Z", error: null },
      { name: "zones", status: "running", startedAt: "2026-10-01T10:01:00.000Z", completedAt: null, error: null },
    ],
    results: { inventory: "1,204 files · TypeScript 812", imports: "3,100 import edges · 2 circular dependencies" },
    enrichmentPass: null,
    narration: null,
    recent: [{ at: "2026-09-30T10:00:00.000Z", mode: "generative", durationMs: 250_000, calls: 9, costUsd: 0.5 }],
    ...over,
  };
}

describe("reading phases", () => {
  it("shows each phase's time against the previous run's, counting the running one", () => {
    const rows = phaseRows(snapshot(), NOW);
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "done", "active", "pending", "pending"]);
    expect(rows[0].previousMs).toBe(25_000);
    expect(phaseTimeLabel(rows[0])).toBe("20s · last 25s");
    // Zones began at 10:01:00; it is 10:03:00.
    expect(rows[3].durationMs).toBe(120_000);
    expect(phaseTimeLabel(rows[3])).toBe("2m 0s · last 2m 0s");
    // Imports ran; classifications had no previous timing.
    expect(phaseTimeLabel(rows[2])).toBe("10s");
    // Not started, with a previous time to compare to later.
    expect(phaseTimeLabel(rows[4])).toBeNull();
    expect(rows[0].result).toBe("1,204 files · TypeScript 812");
  });

  it("marks the callgraph optional, and a failure there as tolerated on a completed run", () => {
    const failedCallgraph = progress({
      running: false, status: "complete", phase: null,
      phases: [...progress().phases.slice(0, 3).map((p) => p), { index: 6, name: "callgraph", startedAt: START, durationMs: 1000, outcome: "failed" }],
    });
    const rows = phaseRows(snapshot({ progress: failedCallgraph }), NOW);
    const call = rows.find((r) => r.name === "callgraph")!;
    expect(call.optional).toBe(true);
    expect(call.state).toBe("failed");
    expect(call.tolerated).toBe(true);
    expect(barSegments(rows).at(-1)).toBe("pending");
  });

  it("leaves unreached phases of a finished run as not run, not waiting", () => {
    const done = progress({ running: false, status: "complete", phase: null, phases: progress().phases.slice(0, 3) });
    expect(phaseRows(snapshot({ progress: done }), NOW).map((r) => r.state)).toEqual(["done", "done", "done", "skipped", "skipped", "skipped"]);
  });

  it("formats durations", () => {
    expect(formatMs(4_000)).toBe("4s");
    expect(formatMs(250_000)).toBe("4m 10s");
    expect(formatMs(3_900_000)).toBe("1h 5m");
  });
});

describe("reading passes", () => {
  it("lists passes 0 to 4 under zones, with the current pass's batch and earlier passes done", () => {
    const rows = passRows(snapshot());
    expect(rows.map((r) => r.state)).toEqual(["done", "done", "active", "pending", "pending"]);
    expect(rows[2].batch).toEqual({ label: "enrich", done: 3, total: 8 });
    expect(rows[1].batch).toBeNull();
  });

  it("adds a pass outside 0 to 4 as the active one", () => {
    const rows = passRows(snapshot({ progress: progress({ pass: { number: 7, label: "judged cascade" }, batch: null }) }));
    expect(rows.at(-1)).toMatchObject({ number: 7, label: "judged cascade", state: "active" });
  });

  it("shows the passes zones.json records once zones has finished, and none for a fast run", () => {
    const zonesDone = progress({
      phase: null, pass: null, batch: null,
      phases: progress().phases.map((p) => (p.name === "zones" ? { ...p, endedAt: START, durationMs: 1, outcome: "ok" as const } : p)),
    });
    expect(passRows(snapshot({ progress: zonesDone, enrichmentPass: 3 })).map((r) => r.state)).toEqual(["done", "done", "done", "done", "pending"]);
    expect(passRows(snapshot({ progress: { ...zonesDone, mode: "fast" } }))).toEqual([]);
    expect(passRows(snapshot({ progress: progress({ phases: progress().phases.slice(0, 3) }) }))).toEqual([]);
  });
});

describe("reading the header", () => {
  it("titles by mode", () => {
    expect(analyzeTitle(progress({ mode: "fast" }))).toBe("Fast analysis");
    expect(analyzeTitle(progress({ mode: "cascade" }))).toBe("Deep analysis");
    expect(analyzeTitle(null)).toBe("Sourcevision analysis");
  });

  it("gives the estimate only while running and only with a previous run", () => {
    expect(headerChips(snapshot()).map((c) => c.key)).toEqual(["estimate", "worktree", "from", "model", "cost"]);
    expect(headerChips(snapshot()).find((c) => c.key === "estimate")?.label).toBe("estimate 4m 10s (last deep run)");
    const none = headerChips(snapshot({ progress: progress({ previous: null }) }));
    expect(none.some((c) => c.key === "estimate")).toBe(false);
    const finished = headerChips(snapshot({ progress: progress({ running: false, status: "complete" }) }));
    expect(finished.some((c) => c.key === "estimate")).toBe(false);
  });

  it("omits the model and cost for a fast run", () => {
    const keys = headerChips(snapshot({ progress: progress({ mode: "fast" }) })).map((c) => c.key);
    expect(keys).not.toContain("model");
    expect(keys).not.toContain("cost");
  });
});

describe("reading how it ended", () => {
  const failed = (over: Partial<AnalyzeProgressFile>) => progress({
    running: false, status: "failed", phase: null, pass: null, batch: null,
    phases: progress().phases.map((p) => (p.name === "zones" ? { ...p, endedAt: START, durationMs: 5000, outcome: "failed" as const } : p)),
    ...over,
  });

  it("names the phase and the error line of a failed run", () => {
    const s = snapshot({ progress: failed({ error: "Phase 4 failed: rate limited" }) });
    expect(runState(s.progress)).toBe("failed");
    expect(failureSummary(s, phaseRows(s, NOW))).toEqual({ phase: "Zones", error: "Phase 4 failed: rate limited", stopped: false });
  });

  it("calls a stop a stop, in the phase it was in", () => {
    const s = snapshot({ progress: failed({ error: "Stopped (SIGTERM)" }) });
    expect(runState(s.progress)).toBe("stopped");
    expect(failureSummary(s, phaseRows(s, NOW))).toMatchObject({ phase: "Zones", stopped: true });
  });

  it("reports a process that vanished as interrupted, in its open phase", () => {
    const s = snapshot({ progress: progress({ running: false, stale: true, status: "interrupted" }) });
    const summary = failureSummary(s, phaseRows(s, NOW));
    expect(runState(s.progress)).toBe("interrupted");
    expect(summary?.phase).toBe("Zones");
    expect(summary?.error).toContain("without recording");
  });

  it("has nothing to say about a run that is going or finished well", () => {
    expect(failureSummary(snapshot(), phaseRows(snapshot(), NOW))).toBeNull();
    const ok = snapshot({ progress: progress({ running: false, status: "complete" }) });
    expect(failureSummary(ok, phaseRows(ok, NOW))).toBeNull();
  });
});

describe("reading the side column", () => {
  it("lists model calls by task class, slowest first, and judgment reuse", () => {
    expect(classRows(progress()).map((c) => [c.name, c.calls, c.tokens])).toEqual([["enrich", 4, "67.0k"], ["naming", 3, "33.0k"]]);
    expect(cacheReuse(progress())?.label).toBe("12 of 40 reused (30%)");
    expect(cacheReuse(progress({ judgmentCache: { hits: 0, misses: 0 } }))).toBeNull();
  });

  it("says which files this run wrote and which are the previous run's", () => {
    const rows = fileRows(snapshot());
    expect(rows.find((r) => r.file === "inventory.json")?.state).toBe("written");
    expect(rows.find((r) => r.file === "imports.json")?.state).toBe("previous");
    expect(rows.find((r) => r.file === "zones.json")?.state).toBe("pending");
    expect(rows.find((r) => r.file === "callgraph.json")?.state).toBe("pending");
  });

  it("carries the notes while running, narration included except for a fast run", () => {
    expect(runningNotes(snapshot()).join(" ")).toContain("previous run");
    expect(runningNotes(snapshot()).join(" ")).toContain("ndx ci");
    expect(runningNotes(snapshot()).join(" ")).toContain("narrated in the background");
    expect(runningNotes(snapshot({ progress: progress({ mode: "fast" }) })).join(" ")).not.toContain("narrated");
    expect(narrationLine({ status: "pending", zones: 3, reason: null })).toBe("Narrating 3 zones in the background.");
    expect(narrationLine(null)).toBeNull();
  });
});

describe("the rendered page", () => {
  let root: HTMLDivElement;
  let body: LiveAnalyzeSnapshot;
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    history.replaceState(null, "", "/live/analyze");
    body = snapshot();
    calls = [];
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url) === "/api/live/analyze") return { ok: true, status: 200, json: async () => body };
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  async function mount(navigateTo = vi.fn()) {
    act(() => { render(h(LiveAnalyzeView, { navigateTo }), root); });
    await act(async () => { await flush(); });
    await act(async () => { await flush(); });
    return navigateTo;
  }

  it("shows the title, chips, six labelled segments, the phases with their times, and the output", async () => {
    await mount();
    expect(root.querySelector(".live-task-title")?.textContent).toBe("Deep analysis");
    expect(root.querySelector(".live-analyze-command")?.textContent).toBe("sv analyze --full");
    expect(root.textContent).toContain("estimate 4m 10s");
    expect(root.textContent).toContain("feat/x");
    expect(root.textContent).toContain("started from the dashboard");
    expect([...root.querySelectorAll(".live-analyze-seg-label")].map((n) => n.textContent))
      .toEqual(["Inventory", "Imports", "Classifications", "Zones", "Components", "Call graph"]);
    const phases = [...root.querySelectorAll(".live-analyze-phase")];
    expect(phases).toHaveLength(6);
    expect(phases[0].textContent).toContain("20s · last 25s");
    expect(phases[0].textContent).toContain("1,204 files");
    expect(phases[3].getAttribute("aria-current")).toBe("step");
    expect(phases[5].textContent).toContain("optional");
    // Zones expands into its passes with the current batch.
    expect(phases[3].textContent).toContain("Pass 2 · Cross-zone relationships");
    expect(phases[3].textContent).toContain("enrich 3 of 8");
    expect(root.querySelector(".live-analyze-output")?.textContent).toBe("[phase 1] inventory\n[phase 4] zones");
    expect(root.querySelector(".live-analyze-table")?.textContent).toContain("enrich");
    expect(root.textContent).toContain("12 of 40 reused");
  });

  it("hides the estimate when there is no previous run", async () => {
    body = snapshot({ progress: progress({ previous: null }) });
    await mount();
    expect(root.textContent).not.toContain("estimate");
    expect(root.querySelector(".live-analyze-phase")?.textContent).toContain("20s");
    expect(root.querySelector(".live-analyze-phase")?.textContent).not.toContain("last");
  });

  it("stops a dashboard run through the command route, after asking", async () => {
    await mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const stop = () => [...root.querySelectorAll("button")].find((b) => b.textContent === "Stop analysis")!;
    await act(async () => { stop().click(); await flush(); });
    expect(calls.some((c) => c.url.includes("/stop"))).toBe(false);
    await act(async () => { stop().click(); await flush(); });
    expect(confirm).toHaveBeenCalledTimes(2);
    const post = calls.find((c) => c.url.includes("/stop"));
    expect(post?.url).toBe("/api/commands/sv-analyze/stop");
    expect(post?.init?.method).toBe("POST");
  });

  it("stops a terminal run by the pid it recorded", async () => {
    body = snapshot({ startedFrom: "terminal", output: { available: false, lines: [] } });
    await mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const stop = [...root.querySelectorAll("button")].find((b) => b.textContent === "Stop analysis")!;
    await act(async () => { stop.click(); await flush(); });
    expect(confirm.mock.calls[0][0]).toContain("pid 4242");
    expect(calls.find((c) => c.url.includes("/stop"))?.url).toBe("/api/live/analyze/stop");
    expect(root.textContent).toContain("its output is in that terminal");
  });

  it("says a failed run failed, in which phase, with its error, and links to the Analysis stage", async () => {
    body = snapshot({
      startedFrom: null,
      progress: progress({
        running: false, status: "failed", phase: null, pass: null, batch: null, error: "Phase 4 failed: rate limited", endedAt: "2026-10-01T10:02:00.000Z",
        phases: progress().phases.map((p) => (p.name === "zones" ? { ...p, endedAt: START, durationMs: 5000, outcome: "failed" as const } : p)),
      }),
    });
    const navigateTo = await mount();
    const notice = root.querySelector(".live-task-finished")!;
    expect(notice.textContent).toContain("This analysis failed.");
    expect(notice.textContent).toContain("stopped in the Zones phase");
    expect(notice.textContent).toContain("Phase 4 failed: rate limited");
    // No Stop on a finished run.
    expect([...root.querySelectorAll("button")].some((b) => b.textContent === "Stop analysis")).toBe(false);
    await act(async () => { notice.querySelector("a")!.click(); });
    expect(navigateTo).toHaveBeenCalledWith("analyze");
  });

  it("says a finished run finished and links to the Analysis stage", async () => {
    body = snapshot({
      startedFrom: null,
      progress: progress({ running: false, status: "complete", phase: null, pass: null, batch: null, endedAt: "2026-10-01T10:04:10.000Z", phases: progress().phases.map((p) => ({ ...p, endedAt: START, durationMs: 1, outcome: "ok" as const })) }),
    });
    await mount();
    expect(root.querySelector(".live-task-finished")?.textContent).toContain("This analysis finished.");
  });

  it("invites a first analysis when none has run", async () => {
    body = snapshot({ progress: null, startedFrom: null, modules: [], results: {}, recent: [] });
    await mount();
    expect(root.textContent).toContain("No analysis has run in this worktree yet");
  });

  it("refetches within the polling interval while running", async () => {
    vi.useFakeTimers();
    await mount();
    const before = calls.filter((c) => c.url === "/api/live/analyze").length;
    await act(async () => { vi.advanceTimersByTime(LIVE_ANALYZE_POLL_RUNNING_MS + 50); await flush(); });
    expect(calls.filter((c) => c.url === "/api/live/analyze").length).toBeGreaterThan(before);
    expect(LIVE_ANALYZE_POLL_RUNNING_MS).toBeLessThanOrEqual(2000);
  });
});
