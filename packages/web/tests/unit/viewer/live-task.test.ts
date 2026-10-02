// @vitest-environment jsdom
/**
 * The running-task page: its pure reading (live-task-model.ts) and what it
 * renders for the acceptance criteria — the step stream, a run recorded before
 * the event stream, the run picker and its URL, Stop and Mark stuck, and the
 * finished notice.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { LiveTaskRun, LiveTaskSnapshot, RunEventLine } from "../../../src/viewer/hooks/use-live-task.js";
import { LiveTaskView } from "../../../src/viewer/views/live-task.js";
import {
  afterRunItems,
  criteriaRows,
  editedFiles,
  hasReview,
  headerChips,
  readRunParam,
  runPosition,
  selectRun,
  stepRows,
  tokensPerSecond,
  withRunParam,
} from "../../../src/viewer/views/live-task-model.js";

function run(over: Partial<LiveTaskRun> = {}): LiveTaskRun {
  return {
    runId: "r2", status: "running", startedAt: "2026-10-01T10:00:00.000Z", finishedAt: null,
    lastActivityAt: "2026-10-01T10:09:50.000Z", heartbeatAgeMs: 10_000, stale: false, turns: 4,
    tokens: { input: 10_000, output: 2_000, cacheCreationInput: 0, cacheReadInput: 50_000, total: 62_000 },
    costUsd: 0.42, tokensPerSecond: null, model: "claude-sonnet-4-5", vendor: "claude", weight: "standard",
    worktreeRoot: "/repo-feat", branch: "feat/x", startHead: "abcdef0123456789", pid: 4242, startedFrom: "terminal", resetDeferred: false,
    outcome: null, review: null, reviewPlan: null, reviewSpend: null, reviewReport: null, logTail: ["line a", "line b"], ...over,
  };
}

function snapshot(over: Partial<LiveTaskSnapshot> = {}): LiveTaskSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    taskId: "t1",
    task: {
      id: "t1", title: "Fix the thing", description: "Do it well", status: "in_progress", priority: "high",
      acceptanceCriteria: ["first", "second"],
      epicChain: [{ id: "e", title: "Epic", level: "epic" }, { id: "f", title: "Feature", level: "feature" }],
    },
    runs: [run(), run({ runId: "r1", status: "failed", finishedAt: "2026-10-01T09:30:00.000Z", startedAt: "2026-10-01T09:00:00.000Z", pid: null, startedFrom: null, outcome: "Tests failed" })],
    maxTurns: 50,
    ...over,
  };
}

const ev = (seq: number, kind: string, summary: string, extra: Partial<RunEventLine> = {}): RunEventLine =>
  ({ seq, kind, at: "2026-10-01T10:00:05.000Z", summary, ...extra });

describe("reading the task page", () => {
  it("defaults to the running run, honours the URL's run, and falls back to the newest", () => {
    const s = snapshot();
    expect(selectRun(s.runs, null)?.runId).toBe("r2");
    expect(selectRun(s.runs, "r1")?.runId).toBe("r1");
    expect(selectRun(s.runs, "gone")?.runId).toBe("r2");
    const finished = [run({ runId: "b", status: "completed" }), run({ runId: "a", status: "failed" })];
    expect(selectRun(finished, null)?.runId).toBe("b");
    expect(selectRun([], null)).toBeNull();
  });

  it("numbers runs from the first and keeps other query parameters", () => {
    const s = snapshot();
    expect(runPosition(s.runs, "r2")).toEqual({ n: 2, m: 2 });
    expect(runPosition(s.runs, "r1")).toEqual({ n: 1, m: 2 });
    expect(withRunParam("?x=1", "r1")).toBe("?x=1&run=r1");
    expect(withRunParam("?run=r1", null)).toBe("");
    expect(readRunParam("?run=r9")).toBe("r9");
  });

  it("renders one row per event and marks the newest current while running", () => {
    const events = [ev(1, "brief_loaded", "Brief loaded"), ev(2, "gate", "Test gate failed", { ok: false }), ev(3, "files_read", "Read 3 files", { detail: "a, b, c" })];
    const rows = stepRows(events, true);
    expect(rows.map((r) => r.status)).toEqual(["info", "fail", "active"]);
    expect(rows.map((r) => r.current)).toEqual([false, false, true]);
    expect(rows[2].detail).toBe("a, b, c");
    expect(stepRows(events, false).some((r) => r.current)).toBe(false);
  });

  it("counts edited files once each", () => {
    expect(editedFiles([ev(1, "file_edited", "Edited a", { detail: "a.ts" }), ev(2, "file_edited", "Edited a", { detail: "a.ts" }), ev(3, "file_edited", "b", { detail: "b.ts" })]))
      .toEqual(["a.ts", "b.ts"]);
  });

  it("builds the header chips", () => {
    const s = snapshot();
    const now = Date.parse("2026-10-01T10:10:00.000Z");
    const labels = headerChips(s.runs[0], s.task, s.maxTurns, now).map((c) => c.label);
    expect(labels).toEqual([
      "Epic › Feature", "high", "turn 4 of 50", "62.0k tokens · 3.3 tok/s", "claude · claude-sonnet-4-5 · standard", "heartbeat 10 s ago",
    ]);
    expect(tokensPerSecond(run({ tokensPerSecond: 42 }), now)).toBe(42);
    expect(headerChips(run({ stale: true, heartbeatAgeMs: 600_000 }), null, null, now).find((c) => c.key === "heartbeat")).toMatchObject({ warn: true });
  });

  it("reads criteria as met only once the task is completed", () => {
    expect(criteriaRows(snapshot().task).map((c) => c.met)).toEqual([false, false]);
    expect(criteriaRows({ ...snapshot().task!, status: "completed" }).map((c) => c.met)).toEqual([true, true]);
  });

  it("lists the gates, and the review only when the run has one", () => {
    expect(afterRunItems(run(), []).map((i) => i.key)).toEqual(["gates"]);
    expect(hasReview(run(), [ev(1, "review_started", "Review started")])).toBe(true);
    const reviewed = run({ review: { failed: null, detail: null, findings: 3, unresolved: 1 } });
    expect(afterRunItems(reviewed, [ev(1, "gate", "Test gate passed", { ok: true })])).toEqual([
      { key: "gates", label: "Tests and completion gates", state: "ok", detail: "Test gate passed" },
      { key: "review", label: "Adversarial review", state: "ok", detail: "3 findings, 1 unresolved" },
    ]);
  });
});

describe("the rendered page", () => {
  let root: HTMLDivElement;
  let body: LiveTaskSnapshot;
  let eventsBody: Record<string, unknown>;
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    history.replaceState(null, "", "/live/task/t1");
    body = snapshot();
    eventsBody = { available: true, events: [ev(1, "brief_loaded", "Brief loaded"), ev(2, "file_edited", "Edited a.ts (+3 −1)", { detail: "a.ts" })], next: 2, more: false };
    calls = [];
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      const u = String(url);
      if (u.startsWith("/api/live/task/")) return { ok: true, status: 200, json: async () => body };
      if (u.includes("/events")) return { ok: true, status: 200, json: async () => eventsBody };
      if (u.includes("/log")) return { ok: true, status: 200, json: async () => ({ content: "full log\n", next: 9, reset: false, more: false }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function flush() {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  }

  async function mount(navigateTo = vi.fn()) {
    act(() => { render(h(LiveTaskView, { taskId: "t1", navigateTo }), root); });
    await act(async () => { await flush(); });
    await act(async () => { await flush(); });
    return navigateTo;
  }

  it("shows the header, the step stream with the current step, and the log tail", async () => {
    await mount();
    expect(root.querySelector(".live-task-title")?.textContent).toBe("Fix the thing");
    expect(root.textContent).toContain("run 2 of 2");
    expect(root.textContent).toContain("turn 4 of 50");
    const steps = [...root.querySelectorAll(".live-step")];
    expect(steps.map((s) => s.querySelector(".live-step-summary")?.textContent)).toEqual(["Brief loaded", "Edited a.ts (+3 −1)"]);
    expect(steps[1].getAttribute("aria-current")).toBe("step");
    expect(root.querySelector(".live-log-lines")?.textContent).toBe("line a\nline b");
    // The URL records the run shown, even when it was the default.
    expect(location.search).toBe("?run=r2");
    // Side column facts.
    expect(root.textContent).toContain("pid 4242 · started from a terminal");
    expect(root.textContent).toContain("abcdef0123");
    expect(root.textContent).toContain("$0.42");
  });

  it("follows new events with the cursor it was given", async () => {
    await mount();
    expect(calls.some((c) => c.url === "/api/hench/runs/r2/events?after=0")).toBe(true);
  });

  it("explains a run recorded before the event stream instead of an empty tab", async () => {
    eventsBody = { available: false, events: [], next: 0, more: false };
    await mount();
    expect(root.querySelector(".live-steps")).toBeNull();
    expect(root.textContent).toContain("Step detail unavailable for this run");
    expect(root.querySelector(".live-task-legacy")?.textContent).toContain("62.0k");
  });

  it("switches runs with the picker without a reload and records the run in the URL", async () => {
    await mount();
    const picker = root.querySelector<HTMLSelectElement>(".live-task-picker")!;
    expect(picker).not.toBeNull();
    await act(async () => {
      picker.value = "r1";
      picker.dispatchEvent(new Event("change"));
      await flush();
    });
    await act(async () => { await flush(); });
    expect(location.search).toBe("?run=r1");
    expect(calls.some((c) => c.url === "/api/hench/runs/r1/events?after=0")).toBe(true);
    expect(root.textContent).toContain("run 1 of 2");
    // Finished: the page says so and links to Work's run detail.
    expect(root.querySelector(".live-task-finished")?.textContent).toContain("Open its run detail in Work");
  });

  it("opens the run named in the URL", async () => {
    history.replaceState(null, "", "/live/task/t1?run=r1");
    const navigateTo = await mount();
    const link = root.querySelector<HTMLAnchorElement>(".live-task-finished a")!;
    await act(async () => { link.click(); });
    expect(navigateTo).toHaveBeenCalledWith("hench-runs", { runId: "r1" });
    // A finished run offers no Stop.
    expect([...root.querySelectorAll("button")].some((b) => b.textContent === "Stop")).toBe(false);
  });

  it("asks before stopping, then uses the terminate route", async () => {
    await mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const stop = () => [...root.querySelectorAll("button")].find((b) => b.textContent === "Stop")!;
    await act(async () => { stop().click(); await flush(); });
    expect(calls.some((c) => c.url.includes("/terminate"))).toBe(false);
    await act(async () => { stop().click(); await flush(); });
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0]).toContain("pid 4242");
    const post = calls.find((c) => c.url.includes("/terminate"));
    expect(post?.url).toBe("/api/hench/execute/t1/terminate");
    expect(post?.init?.method).toBe("POST");
  });

  async function stopWith(terminateBody: Record<string, unknown>, runOverrides: Partial<LiveTaskRun> = {}) {
    body = snapshot({ runs: [run(runOverrides)] });
    const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) =>
      String(u).includes("/terminate")
        ? { ok: true, status: 200, json: async () => terminateBody }
        : base(u, i)));
    await mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    confirm.mockClear();
    const stop = [...root.querySelectorAll("button")].find((b) => b.textContent === "Stop")!;
    await act(async () => { stop.click(); await flush(); });
    return { notice: root.querySelector(".live-notice")?.textContent, question: confirm.mock.calls[0][0] };
  }

  it("says the process was not signalled when the server only marked the record", async () => {
    const { notice } = await stopWith({ terminated: true, method: "disk-mark" });
    expect(notice).toBe("Marked terminated; the process was not signalled (pid 4242)");
  });

  it("reports Stopped when a signal was sent", async () => {
    const { notice } = await stopWith({ terminated: true, signalSent: true, method: "pid-signal" });
    expect(notice).toBe("Stopped");
  });

  it("promises a stop signal only when the run has a recorded pid", async () => {
    const withPid = await stopWith({ signalSent: true });
    expect(withPid.question).toContain("is sent a stop signal");
    render(null, root);
    const noPid = await stopWith({ method: "disk-mark" }, { pid: null });
    expect(noPid.question).toContain("no stop signal can be sent");
  });

  it("offers Mark stuck only for a stale run", async () => {
    await mount();
    const mark = () => [...root.querySelectorAll("button")].find((b) => b.textContent === "Mark stuck");
    expect(mark()).toBeUndefined();
    render(null, root);
    body = snapshot({ runs: [run({ stale: true, heartbeatAgeMs: 600_000 })] });
    await mount();
    expect(mark()).toBeDefined();
  });

  it("asks before marking stuck, then uses the existing route", async () => {
    body = snapshot({ runs: [run({ stale: true, heartbeatAgeMs: 600_000 })] });
    await mount();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    const mark = () => [...root.querySelectorAll("button")].find((b) => b.textContent === "Mark stuck")!;
    await act(async () => { mark().click(); await flush(); });
    expect(calls.some((c) => c.url.includes("/mark-stuck"))).toBe(false);
    await act(async () => { mark().click(); await flush(); });
    expect(confirm).toHaveBeenCalledTimes(2);
    const post = calls.find((c) => c.url.includes("/mark-stuck"));
    expect(post?.url).toBe("/api/hench/runs/r2/mark-stuck");
    expect(post?.init?.method).toBe("POST");
  });

  it("shows a Review tab only for a run with a review", async () => {
    await mount();
    const tabs = () => [...root.querySelectorAll("[role=tab]")].map((t) => t.textContent);
    expect(tabs()).toEqual(["Work", "Log"]);
    render(null, root);
    body = snapshot({ runs: [run({ review: { failed: null, detail: null, findings: 2, unresolved: 0 } })] });
    await mount();
    expect(tabs()).toEqual(["Work", "Log", "Review"]);
  });

  it("shows the Review tab from the start for a run launched with --review, marked waiting", async () => {
    body = snapshot({ runs: [run({ reviewPlan: { model: "claude-opus-5", modelSource: "vendor-default", optional: false } })] });
    await mount();
    const tabs = [...root.querySelectorAll("[role=tab]")].map((t) => t.textContent);
    expect(tabs).toEqual(["Work", "Log", "Review · waiting"]);
    expect(root.querySelector(".live-stages")?.textContent).toContain("Review");
    expect(root.textContent).toContain("Review is a gate");
  });

  it("lists the findings once the report exists, with a PRD link for a captured one", async () => {
    body = snapshot({
      runs: [run({
        reviewPlan: { model: "claude-opus-5", modelSource: "flag", optional: false },
        reviewReport: {
          taskId: "t1", fixesApplied: true, summary: "Attacked the diff.",
          findings: [
            { title: "Race on save", location: "a.ts:3", severity: "high", verdict: "must-fix", scenario: "two writers", action: "fixed", itemId: null, note: null, disposition: "fixed", reason: null },
            { title: "Missing log", location: null, severity: "low", verdict: "should-fix", scenario: null, action: "captured", itemId: "item-9", note: null, disposition: "offered", reason: null },
            { title: "Style", location: null, severity: "low", verdict: "not-worth-fixing", scenario: null, action: "dropped", itemId: null, note: null, disposition: "dropped", reason: null },
          ],
        },
      })],
    });
    eventsBody = { available: true, events: [ev(1, "review_started", "Adversarial review started on claude-opus-5", { detail: "fresh session" })], next: 1, more: false };
    const navigateTo = await mount();
    await act(async () => { [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((t) => t.textContent?.startsWith("Review"))!.click(); await flush(); });
    expect(root.querySelectorAll(".live-finding")).toHaveLength(3);
    expect(root.querySelector(".live-findings-dropped")?.textContent).toContain("1 dropped finding");
    expect(root.querySelector(".live-sev-high")?.textContent).toBe("high");
    expect(root.textContent).toContain("must fix");
    expect(root.textContent).toContain("captured to the PRD");
    const link = [...root.querySelectorAll<HTMLAnchorElement>(".live-finding-item a")][0]!;
    await act(async () => { link.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "item-9" });
    expect(root.textContent).toContain("fresh session");
    expect(root.textContent).toContain("--review-model");
  });

  it("says why when the review never ran, instead of an empty list", async () => {
    body = snapshot({
      runs: [run({
        status: "failed", finishedAt: "2026-10-01T10:05:00.000Z", pid: null, startedFrom: null,
        reviewPlan: { model: "claude-opus-5", modelSource: "vendor-default", optional: false },
        review: { failed: "spawn-failed", detail: "claude: command not found", findings: null, unresolved: null },
      })],
    });
    await mount();
    await act(async () => { [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((t) => t.textContent?.startsWith("Review"))!.click(); await flush(); });
    expect(root.querySelector(".live-review-reason")?.textContent).toContain("spawn-failed: claude: command not found");
    expect(root.querySelector(".live-finding")).toBeNull();
  });

  it("opens the full log from the tail's link", async () => {
    await mount();
    const link = [...root.querySelectorAll("a")].find((a) => a.textContent === "Open the log")!;
    await act(async () => { link.click(); await flush(); });
    await act(async () => { await flush(); });
    expect([...root.querySelectorAll(".live-logrow-text")].map((r) => r.textContent)).toEqual(["full log"]);
    expect(root.querySelector(".live-log-source")?.textContent).toContain("1 line");
  });
});
