// @vitest-environment jsdom
/**
 * The finished-run summary: its pure reading (live-summary-model.ts) and what
 * the page renders for the acceptance criteria — the summary and metrics from
 * the existing run route, the other three tabs still reachable, and Re-run
 * switching the page to the new run.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import type { LiveTaskRun, LiveTaskSnapshot, RunRecordSummary } from "../../../src/viewer/hooks/use-live-task.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { LiveTaskView } from "../../../src/viewer/views/live-task.js";
import { commitLinkUrl } from "../../../src/viewer/utils/commit-link.js";
import {
  NOT_RECORDED,
  fileChanges,
  followUpDescription,
  followUpParentId,
  retryCount,
  runCommits,
  runMetrics,
  workCounts,
} from "../../../src/viewer/views/live-summary-model.js";

function run(over: Partial<LiveTaskRun> = {}): LiveTaskRun {
  return {
    runId: "r1", status: "completed",
    startedAt: "2026-10-01T10:00:00.000Z", finishedAt: "2026-10-01T10:04:30.000Z",
    lastActivityAt: "2026-10-01T10:04:29.000Z", heartbeatAgeMs: null, stale: false, turns: 7,
    tokens: { input: 10_000, output: 2_000, cacheCreationInput: 1_500, cacheReadInput: 50_000, total: 63_500 },
    costUsd: 0.42, tokensPerSecond: null, model: "claude-sonnet-4-5", vendor: "claude", weight: "standard",
    worktreeRoot: "/repo", branch: "feat/x", startHead: "abcdef0123456789", pid: null, startedFrom: null,
    resetDeferred: false, outcome: "Added the summary tab", review: null, reviewPlan: null,
    reviewSpend: null, reviewReport: null, logTail: ["line a"], ...over,
  };
}

function snapshot(over: Partial<LiveTaskSnapshot> = {}): LiveTaskSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    taskId: "t1",
    task: {
      id: "t1", title: "Fix the thing", description: "Do it well", status: "completed", priority: "high",
      acceptanceCriteria: ["first"],
      epicChain: [{ id: "e", title: "Epic", itemType: "epic" }, { id: "f", title: "Feature", itemType: "feature" }],
    },
    runs: [run()],
    maxTurns: 50,
    ...over,
  };
}

function record(over: Partial<RunRecordSummary> = {}): RunRecordSummary {
  return {
    status: "completed",
    summary: "Added the summary tab",
    turns: 7,
    retryAttempts: 2,
    spawnBreakdown: { "plan-mode": 1, retry: 1 },
    structuredSummary: {
      filesChanged: ["a.ts", "b.css"],
      fileChangesWithStatus: ["M\ta.ts", "A\tb.css"],
      counts: { filesRead: 12, filesChanged: 2, commandsExecuted: 5, testsRun: 1, toolCallsTotal: 34 },
    },
    commits: [{ sha: "0123456789abcdef0123", subject: "feat(web): add the summary tab" }],
    uncommittedPaths: [],
    ...over,
  };
}

describe("reading a finished run's record", () => {
  it("lists the tool-call tallies in a fixed order, and nothing at all without a summary", () => {
    expect(workCounts(record()).map((c) => [c.label, c.value])).toEqual([
      ["Files changed", 2], ["Files read", 12], ["Commands run", 5], ["Test runs", 1], ["Tool calls", 34],
    ]);
    expect(workCounts({})).toEqual([]);
    expect(workCounts(null)).toEqual([]);
  });

  it("reads file changes from git's status list, and falls back to bare paths", () => {
    expect(fileChanges(record())).toEqual([{ status: "M", path: "a.ts" }, { status: "A", path: "b.css" }]);
    expect(fileChanges(record({ structuredSummary: { filesChanged: ["only.ts"] } })))
      .toEqual([{ status: "?", path: "only.ts" }]);
    // A path containing a tab keeps every field past the status.
    expect(fileChanges(record({ structuredSummary: { fileChangesWithStatus: ["M\tdir\tx.ts"] } })))
      .toEqual([{ status: "M", path: "dir\tx.ts" }]);
    expect(fileChanges(null)).toEqual([]);
  });

  it("counts retries from either field and says so when neither was recorded", () => {
    expect(retryCount({ retryAttempts: 3 })).toBe(3);
    // One spawn is the first attempt, so zero retries.
    expect(retryCount({ spawnCount: 1 })).toBe(0);
    expect(retryCount({ spawnCount: 4 })).toBe(3);
    expect(retryCount({})).toBeNull();
    expect(retryCount(null)).toBeNull();
  });

  it("gives wall time, turns, retries, tool calls, tokens by class, cost and files changed", () => {
    const rows = runMetrics(run(), record());
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Wall time", "4m 30s"],
      ["Turns", "7"],
      ["Retries", "2"],
      ["Tool calls", "34"],
      ["Input tokens", "10.0k"],
      ["Output tokens", "2.0k"],
      ["Cache write tokens", "1.5k"],
      ["Cache read tokens", "50.0k"],
      ["Estimated cost", "$0.42"],
      ["Files changed", "2"],
    ]);
    expect(rows.find((r) => r.key === "retries")?.title).toBe("plan-mode: 1\nretry: 1");
    expect(rows.find((r) => r.key === "files")?.title).toBe("a.ts\nb.css");
  });

  it("distinguishes a number the record does not carry from a measured zero", () => {
    const rows = runMetrics(run({ turns: null, finishedAt: null }), {});
    const value = (key: string) => rows.find((r) => r.key === key)?.value;
    expect(value("wall")).toBe(NOT_RECORDED);
    expect(value("turns")).toBe(NOT_RECORDED);
    expect(value("retries")).toBe(NOT_RECORDED);
    expect(value("tools")).toBe(NOT_RECORDED);
    expect(value("files")).toBe(NOT_RECORDED);
    expect(runMetrics(run(), record({ structuredSummary: { counts: { toolCallsTotal: 0 } } }))
      .find((r) => r.key === "tools")?.value).toBe("0");
  });

  it("keeps only commits with a sha, and shortens them for display", () => {
    expect(runCommits(record())).toEqual([
      { sha: "0123456789abcdef0123", shortSha: "0123456789", subject: "feat(web): add the summary tab" },
    ]);
    expect(runCommits({ commits: [{ subject: "no sha" }] })).toEqual([]);
    expect(runCommits(null)).toEqual([]);
  });

  it("links a commit on an https remote and on git's scp form, and nowhere without one", () => {
    expect(commitLinkUrl("abc", "https://github.com/o/r.git")).toBe("https://github.com/o/r/commit/abc");
    expect(commitLinkUrl("abc", "https://gitlab.com/group/project.git")).toBe("https://gitlab.com/group/project/commit/abc");
    // The scp form is not a URL; without the rewrite it produced a dead link.
    expect(commitLinkUrl("abc", "git@github.com:o/r.git")).toBe("https://github.com/o/r/commit/abc");
    expect(commitLinkUrl("abc", null)).toBeNull();
    expect(commitLinkUrl("abc", "/srv/git/r.git")).toBeNull();
    expect(commitLinkUrl("", "https://github.com/o/r.git")).toBeNull();
  });

  it("files a follow-up under the task's own parent, and names what it follows", () => {
    expect(followUpParentId(snapshot().task!.epicChain)).toBe("f");
    expect(followUpParentId([])).toBeNull();
    expect(followUpDescription("Fix the thing", "r1", " do the rest ")).toBe(
      'do the rest\n\nFollow-up from run r1 of "Fix the thing".',
    );
  });
});

describe("the finished run's page", () => {
  let root: HTMLDivElement;
  let body: LiveTaskSnapshot;
  let runBody: RunRecordSummary;
  let calls: Array<{ url: string; init?: RequestInit }>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    history.replaceState(null, "", "/live/task/t1");
    body = snapshot();
    runBody = record();
    calls = [];
    clearProjectMetadataCache();
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, init });
      if (u.startsWith("/api/live/task/")) return { ok: true, status: 200, json: async () => body };
      if (u.includes("/events")) return { ok: true, status: 200, json: async () => ({ available: true, events: [], next: 0, more: false }) };
      if (u.includes("/log")) return { ok: true, status: 200, json: async () => ({ content: "full log\n", next: 9, reset: false, more: false }) };
      if (/^\/api\/hench\/runs\/[^/]+$/.test(u)) return { ok: true, status: 200, json: async () => runBody };
      if (u === "/api/project") return { ok: true, status: 200, json: async () => ({ name: "n-dx", git: { remoteUrl: "https://github.com/o/r.git" } }) };
      if (u === "/api/rex/items") return { ok: true, status: 201, json: async () => ({ ok: true, id: "new-1", title: "Follow up on this" }) };
      return { ok: true, status: 200, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    clearProjectMetadataCache();
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

  const tabs = () => [...root.querySelectorAll("[role=tab]")].map((t) => t.textContent);
  const clickTab = async (label: string) => {
    const tab = [...root.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((t) => t.textContent?.startsWith(label))!;
    await act(async () => { tab.click(); await flush(); });
    await act(async () => { await flush(); });
  };

  it("opens on Summary and shows the record's work summary, metrics and commit", async () => {
    await mount();
    expect(tabs()).toEqual(["Summary", "Work", "Log"]);
    // The record comes from the route the Work view already uses — no new server data.
    expect(calls.some((c) => c.url === "/api/hench/runs/r1")).toBe(true);
    const panel = root.querySelector("#live-task-panel")!;
    expect(panel.querySelector(".live-summary")).not.toBeNull();
    expect(panel.textContent).toContain("Added the summary tab");
    expect(panel.textContent).toContain("Tool calls");
    expect(panel.textContent).toContain("34");
    expect(panel.textContent).toContain("4m 30s");
    expect(panel.textContent).toContain("$0.42");
    expect([...panel.querySelectorAll(".live-summary-file")].map((f) => f.textContent))
      .toEqual(["Ma.ts", "Ab.css"]);
    const commit = [...panel.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent === "0123456789")!;
    expect(commit.href).toBe("https://github.com/o/r/commit/0123456789abcdef0123");
  });

  it("keeps Work, Log and Review open for the finished run", async () => {
    body = snapshot({
      runs: [run({
        reviewPlan: { model: "claude-opus-5", modelSource: "flag", optional: false },
        reviewReport: {
          taskId: "t1", fixesApplied: true, summary: "Attacked the diff.",
          findings: [
            { title: "Race on save", location: "a.ts:3", severity: "high", verdict: "must-fix", scenario: "two writers", action: "fixed", itemId: null, note: null, disposition: "fixed", reason: null },
            { title: "Missing log", location: null, severity: "low", verdict: "should-fix", scenario: null, action: "captured", itemId: "item-9", note: null, disposition: "offered", reason: null },
          ],
        },
      })],
    });
    await mount();
    expect(tabs()).toEqual(["Summary", "Work", "Log", "Review"]);
    // The summary says what the review found and what was done about it.
    const summary = root.querySelector(".live-summary")!;
    expect(summary.textContent).toContain("1 fixed");
    expect(summary.textContent).toContain("captured to the PRD");
    expect(summary.textContent).toContain("Race on save");

    await clickTab("Work");
    expect(root.querySelector("#live-task-panel .live-work")).not.toBeNull();
    expect(root.querySelector(".live-log-lines")?.textContent).toBe("line a");

    await clickTab("Log");
    expect([...root.querySelectorAll(".live-logrow-text")].map((r) => r.textContent)).toEqual(["full log"]);

    await clickTab("Review");
    expect(root.querySelectorAll(".live-finding")).toHaveLength(2);
  });

  it("says so rather than showing zeroes when the record has no work summary", async () => {
    runBody = { status: "completed", summary: "Did a thing" };
    await mount();
    const panel = root.querySelector("#live-task-panel")!;
    expect(panel.textContent).toContain("No work summary was recorded for this run.");
    expect(panel.textContent).toContain(NOT_RECORDED);
    expect(panel.querySelector(".live-summary-commits")).toBeNull();
  });

  it("re-runs the task and switches the page to the new run", async () => {
    await mount();
    expect(root.textContent).toContain("Re-run");
    const caret = [...root.querySelectorAll<HTMLButtonElement>(".start-task-caret")][0]!;
    await act(async () => { caret.click(); await flush(); });
    // The next snapshot has the new run; the page must stop showing the old one.
    body = snapshot({
      task: { ...snapshot().task!, status: "in_progress" },
      runs: [run({ runId: "r2", status: "running", finishedAt: null, pid: 99, startedFrom: "dashboard", outcome: null }), run()],
    });
    const startNow = [...root.querySelectorAll<HTMLButtonElement>("[role=menuitem]")].find((b) => b.textContent === "Start now")!;
    await act(async () => { startNow.click(); await flush(); });
    await act(async () => { await flush(); });

    const post = calls.find((c) => c.url === "/api/hench/execute");
    expect(post?.init?.method).toBe("POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ taskId: "t1" });
    // The new run is the one on show: its id is in the URL, it is running, and
    // the Summary tab is gone with it.
    expect(location.search).toBe("?run=r2");
    expect(tabs()).toEqual(["Work", "Log"]);
    expect(root.querySelector(".live-task-status")?.textContent).toContain("running");
  });

  it("files a follow-up under the task's parent and links the item it created", async () => {
    const navigateTo = await mount();
    const capture = [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Capture follow-up")!;
    await act(async () => { capture.click(); await flush(); });
    const note = root.querySelector<HTMLTextAreaElement>(".live-capture-note")!;
    await act(async () => {
      note.value = "Follow up on this\nand the detail";
      note.dispatchEvent(new Event("input"));
      await flush();
    });
    const add = [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Add to the PRD")!;
    await act(async () => { add.click(); await flush(); });
    await act(async () => { await flush(); });

    const post = calls.find((c) => c.url === "/api/rex/items")!;
    expect(post.init?.method).toBe("POST");
    expect(JSON.parse(String(post.init?.body))).toEqual({
      title: "Follow up on this",
      parentId: "f",
      description: 'Follow up on this\nand the detail\n\nFollow-up from run r1 of "Fix the thing".',
    });
    const link = root.querySelector<HTMLAnchorElement>(".live-capture-done a")!;
    await act(async () => { link.click(); });
    expect(navigateTo).toHaveBeenCalledWith("prd", { taskId: "new-1" });
  });

  it("shows the summary from the snapshot alone when the record cannot be read", async () => {
    const base = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<unknown>;
    vi.stubGlobal("fetch", vi.fn(async (u: string, i?: RequestInit) =>
      /^\/api\/hench\/runs\/[^/]+$/.test(String(u))
        ? { ok: false, status: 404, json: async () => ({ error: 'Run "r1" not found' }) }
        : base(String(u), i)));
    await mount();
    const panel = root.querySelector("#live-task-panel")!;
    expect(panel.textContent).toContain('Run "r1" not found');
    // The snapshot's own facts are still there.
    expect(panel.textContent).toContain("Added the summary tab");
    expect(panel.textContent).toContain("$0.42");
  });
});
