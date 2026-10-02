// @vitest-environment jsdom
/**
 * Work's Active Tasks panel shows the Live feed's liveness verdict and links to
 * Live; it has no control that ends a run — Live is the one place that does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ActiveTasksPanel, type ActiveRun } from "../../../src/viewer/components/active-tasks-panel.js";
import { runStatus } from "../../../src/viewer/views/live-task-model.js";

const run = (over: Partial<ActiveRun> = {}): ActiveRun => ({
  id: "r1", taskId: "t1", taskTitle: "Fix the thing", startedAt: new Date().toISOString(),
  lastActivityAt: new Date().toISOString(), status: "running", turns: 2, model: "sonnet", ...over,
});

describe("ActiveTasksPanel verdicts", () => {
  let root: HTMLDivElement;
  let live: unknown;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("WebSocket", class { onmessage = null; onopen = null; onclose = null; close() {} });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).includes("/api/live")) return { ok: true, status: 200, json: async () => live };
      return { ok: true, status: 200, json: async () => ({ executions: [] }) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function mount(runs: ActiveRun[]) {
    const navigateTo = vi.fn();
    act(() => { render(h(ActiveTasksPanel, { runs, navigateTo }), root); });
    await act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });
    return navigateTo;
  }

  it("shows the verdict badge with its reason and a Manage in Live link, and no end controls", async () => {
    live = {
      runs: [{
        runId: "r1", taskId: "t1", taskTitle: "Fix the thing", branch: null, worktree: { key: "main", isAnchor: true },
        startedAt: null, stale: true, lastProgress: null, liveness: "orphaned", livenessReason: "pid 42 is gone", canEnd: true,
      }],
      jobs: [], counts: { running: 1, stale: 1, jobs: 0 },
    };
    const navigateTo = await mount([run()]);
    const badge = root.querySelector(".live-verdict-orphaned")!;
    expect(badge.textContent).toBe("Not running");
    expect(badge.getAttribute("title")).toBe("pid 42 is gone");
    expect(root.textContent).not.toContain("Possibly stuck");

    const link = root.querySelector<HTMLAnchorElement>(".active-task-live-link")!;
    expect(link.textContent).toBe("Manage in Live");
    expect(link.getAttribute("href")).toMatch(/\/live\/task\/t1$/);
    act(() => { link.click(); });
    expect(navigateTo).toHaveBeenCalledWith("live-task", { taskId: "t1" });

    expect([...root.querySelectorAll("button")].map((b) => b.textContent ?? "")).not.toContain("End");
    expect(root.querySelector(".active-task-end-btn")).toBeNull();
  });

  it("falls back to the stale badge when the feed has no verdict yet", async () => {
    live = null;
    await mount([run({ lastActivityAt: undefined })]);
    expect(root.textContent).toContain("Possibly stuck");
    expect(root.querySelector(".active-task-live-link")).not.toBeNull();
  });
});

describe("the task page status chip", () => {
  it("reads a run no process is executing as not running, not as stuck-but-live", () => {
    const base = { status: "running", stale: true };
    expect(runStatus(base, { liveness: "orphaned" })).toEqual({ label: "Not running", mod: "orphaned" });
    expect(runStatus(base, { liveness: "unknown" })).toEqual({ label: "Unverified", mod: "unknown" });
    expect(runStatus(base, { liveness: "live" })).toEqual({ label: "stuck", mod: "stuck" });
    expect(runStatus({ status: "running", stale: false }, null)).toEqual({ label: "running", mod: "running" });
    expect(runStatus({ status: "failed", stale: false }, { liveness: "orphaned" })).toEqual({ label: "failed", mod: "failed" });
  });
});
