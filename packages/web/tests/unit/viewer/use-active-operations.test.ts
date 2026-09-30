// @vitest-environment jsdom
/**
 * Tests for the useActiveOperations hook.
 *
 * Covers: singleton polling aggregation (running/done/failed/idle),
 * hench execution via WebSocket + mount catch-up fetch, and the
 * finished-state retention/dismissal window.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";

// ─── Mocks ───────────────────────────────────────────────────────────────────

let capturedPoll: (() => Promise<void>) | null = null;

vi.mock("../../../src/viewer/views/use-polling.js", () => ({
  usePolling: vi.fn((_key: string, cb: () => Promise<void>) => {
    capturedPoll = cb;
  }),
}));

let capturedOnMessage: ((msg: { type: string; state?: unknown }) => void) | null = null;

vi.mock("../../../src/viewer/hooks/use-gateway.js", () => ({
  createWSPipeline: vi.fn((opts: { onMessage: (msg: { type: string; state?: unknown }) => void }) => {
    capturedOnMessage = opts.onMessage;
    return { push: vi.fn(), dispose: vi.fn() };
  }),
}));

import {
  useActiveOperations,
  type ActiveOperation,
  type JobTray,
} from "../../../src/viewer/hooks/use-active-operations.js";
import { usePolling } from "../../../src/viewer/views/use-polling.js";

// ─── Harness ─────────────────────────────────────────────────────────────────

let hookResult: ActiveOperation[] = [];
let tray: JobTray | null = null;

function TestHarness() {
  tray = useActiveOperations();
  hookResult = tray.operations;
  return h("div", null, JSON.stringify(hookResult));
}

function idleWire() {
  return { running: false, startedAt: null, finishedAt: null, error: null };
}

/**
 * Let pending promise chains settle *inside* act().
 *
 * Wrapping render() alone is not enough for this hook: its sweep effect
 * depends on [bySingleton, byHench], two Maps replaced on every state update
 * (use-active-operations.ts:288). So every setState — from the mount catch-up
 * fetch, a poll tick, or a WebSocket message — re-commits with *changed* deps
 * and re-arms Preact's after-paint queue. A commit that lands outside act()
 * takes preact/hooks' afterNextFrame path, which schedules a real
 * requestAnimationFrame plus a 35ms setTimeout fallback; if the file ends
 * before that pair fires, it fires with jsdom gone and throws
 * "cancelAnimationFrame is not defined".
 *
 * The setTimeout(0) is a macrotask, so every already-queued microtask (the
 * fetch → json → setState chain) drains before it runs — deterministically,
 * not on a timing guess — and all of it happens while act() still holds
 * options.requestAnimationFrame, so the effects are flushed into act's queue
 * instead of a real timer pair.
 */
async function settleInAct(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("useActiveOperations", () => {
  let root: HTMLDivElement;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.clearAllMocks();
    capturedPoll = null;
    capturedOnMessage = null;
    tray = null;

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    // Unmount inside act() to keep it symmetric with the act()-wrapped
    // mount/updates above, so no commit in this file escapes act(). Unmount
    // itself commits no effects — it is act()'s coverage of every earlier
    // commit that keeps the real rAF/setTimeout(35) fallback from arming.
    act(() => { render(null, root); });
    if (root.parentNode) root.parentNode.removeChild(root);
    globalThis.fetch = originalFetch;
  });

  it("returns no operations when everything is idle", async () => {
    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedPoll).toBeInstanceOf(Function);

    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    expect(hookResult).toEqual([]);
  });

  it("registers polling with the correct source name and interval", async () => {
    act(() => { render(h(TestHarness, null), root); });
    expect(usePolling).toHaveBeenCalledWith("active-operations", expect.any(Function), 3_000);
    // The mount catch-up fetch is already in flight; settle it here so its
    // state update commits inside act() rather than landing in a later test.
    await settleInAct();
  });

  it("surfaces a running singleton action", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/sv-analyze/status") {
        return {
          ok: true,
          json: async () => ({ running: true, startedAt: "2026-08-26T10:00:00.000Z", finishedAt: null, recentOutput: "scanning...\nfound 12 files" }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedPoll).toBeInstanceOf(Function);

    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    expect(hookResult).toHaveLength(1);
    expect(hookResult[0]).toMatchObject({
      kind: "sv-analyze",
      status: "running",
      label: "Full codebase analysis",
      detail: "found 12 files",
    });
  });

  it("surfaces a failed singleton action", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/self-heal/status") {
        return {
          ok: true,
          json: async () => ({ running: false, startedAt: "2026-08-26T10:00:00.000Z", finishedAt: "2026-08-26T10:05:00.000Z", error: "build failed" }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedPoll).toBeInstanceOf(Function);

    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    expect(hookResult).toHaveLength(1);
    expect(hookResult[0]).toMatchObject({ kind: "self-heal", status: "failed", error: "build failed" });
  });

  it("fetches hench executions on mount", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return {
          ok: true,
          json: async () => ({
            executions: [
              { taskId: "t1", taskTitle: "Add dark mode toggle", status: "running", startedAt: "2026-08-26T10:00:00.000Z", lastOutput: "editing settings.ts" },
            ],
          }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();

    expect(hookResult.some((op) => op.kind === "hench")).toBe(true);

    const op = hookResult.find((o) => o.kind === "hench")!;
    expect(op).toMatchObject({ id: "hench:t1", label: "Add dark mode toggle", status: "running", detail: "editing settings.ts" });
  });

  it("updates hench state live from the WebSocket broadcast", async () => {
    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedOnMessage).toBeInstanceOf(Function);

    act(() => {
      capturedOnMessage!({
        type: "hench:task-execution-progress",
        state: { taskId: "t2", taskTitle: "Fix flaky test", status: "completed", startedAt: "2026-08-26T09:00:00.000Z", finishedAt: "2026-08-26T09:10:00.000Z" },
      });
    });
    act(() => { render(h(TestHarness, null), root); });

    // No settle here: t2's finishedAt is already past the retention window, so
    // the sweep effect arms a 0ms timer to drop it. act() has already committed
    // the broadcast synchronously, and pumping a macrotask would let that timer
    // fire and delete the very entry this test is about.
    expect(hookResult.some((op) => op.id === "hench:t2")).toBe(true);
    const op = hookResult.find((o) => o.id === "hench:t2")!;
    expect(op.status).toBe("done");
  });

  it("ignores WebSocket messages of other types", async () => {
    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedOnMessage).toBeInstanceOf(Function);

    act(() => { capturedOnMessage!({ type: "some:other-message" }); });
    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();

    expect(hookResult).toEqual([]);
  });

  it("drops a finished entry once past the retention window", async () => {
    capturedOnMessage = null;
    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedOnMessage).toBeInstanceOf(Function);

    // finishedAt is already older than FINISHED_RETENTION_MS (10s), so the
    // sweep effect's setTimeout fires with ~0ms delay — no fake-timer
    // juggling needed alongside the real microtask chain above.
    const finishedAt = new Date(Date.now() - 20_000).toISOString();
    act(() => {
      capturedOnMessage!({
        type: "hench:task-execution-progress",
        state: { taskId: "t3", taskTitle: "Done task", status: "completed", startedAt: "2026-08-26T09:00:00.000Z", finishedAt },
      });
    });
    act(() => { render(h(TestHarness, null), root); });
    // The sweep timer fires with ~0ms delay, so one settle covers both it and
    // the state update it triggers.
    await settleInAct();

    expect(hookResult.some((op) => op.id === "hench:t3")).toBe(false);
  });

  it("reports the self-heal loop's current iteration and phase", async () => {
    // Moved here from self-heal-live.test.ts along with the poll: the tray is
    // now the only reader of this output, and one reader of a stream owns its
    // parser. Phases arrive in loop order; the freshest line is the current one.
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/self-heal/status") {
        return {
          ok: true,
          json: async () => ({
            running: true,
            startedAt: "2026-08-26T10:00:00.000Z",
            finishedAt: null,
            iterations: 3,
            output: "iteration 2/3\nanalyzing zones\nphase: recommend",
          }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    const op = hookResult.find((o) => o.kind === "self-heal")!;
    expect(op.detail).toBe("iteration 2/3 · phase: recommend");
  });

  it("carries a stop target and a result link on every operation", async () => {
    // A tray row's Stop and its result link come off the operation, so a job
    // whose source table entry lacks either is a row that cannot be stopped
    // or whose "what did this produce" link goes nowhere.
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return {
          ok: true,
          json: async () => ({
            executions: [{ taskId: "t9", taskTitle: "A task", status: "running", startedAt: "2026-08-26T10:00:00.000Z" }],
          }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({ running: true, startedAt: "2026-08-26T10:00:00.000Z", finishedAt: null }),
      } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    expect(hookResult.length).toBeGreaterThan(0);
    for (const op of hookResult) {
      expect(op.stopUrl).toBeTruthy();
      expect(op.result.view).toBeTruthy();
      expect(op.result.label).toBeTruthy();
    }
    // Hench is per-run, so its stop must address the specific task.
    const hench = hookResult.find((o) => o.kind === "hench")!;
    expect(hench.stopUrl).toBe("/api/hench/execute/t9/terminate");
  });

  it("tracks the recommend job, counting what it produced", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/recommend/status") {
        return {
          ok: true,
          json: async () => ({
            running: false,
            startedAt: "2026-08-26T10:00:00.000Z",
            finishedAt: "2026-08-26T10:02:00.000Z",
            error: null,
            report: [{ id: "a" }, { id: "b" }],
          }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    const op = hookResult.find((o) => o.kind === "recommend")!;
    expect(op).toBeDefined();
    expect(op.status).toBe("done");
    expect(op.detail).toBe("2 recommendations found");
    expect(op.result).toEqual({ view: "suggestions", label: "View suggestions" });
  });

  it("stop POSTs to the operation's stop target and re-reads status", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method });
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/ci/status") {
        return {
          ok: true,
          json: async () => ({ running: true, startedAt: "2026-08-26T10:00:00.000Z", finishedAt: null }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    const op = hookResult.find((o) => o.kind === "ci")!;
    calls.length = 0;
    await act(async () => { await tray!.stop(op); });

    expect(calls[0]).toEqual({ url: "/api/commands/ci/stop", method: "POST" });
    // The stop endpoint answers before the child has exited, so only a
    // re-read shows the run as finished.
    expect(calls.some((c) => c.url === "/api/commands/ci/status")).toBe(true);
  });

  it("reports a stopped run as stopped rather than as a failure", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/reshape/status") {
        return {
          ok: true,
          json: async () => ({
            running: false,
            startedAt: "2026-08-26T10:00:00.000Z",
            finishedAt: "2026-08-26T10:01:00.000Z",
            error: null,
            stopped: true,
          }),
        } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    await act(async () => { await capturedPoll!(); });
    act(() => { render(h(TestHarness, null), root); });

    const op = hookResult.find((o) => o.kind === "reshape")!;
    expect(op.status).toBe("done");
    expect(op.stopped).toBe(true);
    expect(op.detail).toBe("Stopped");
  });

  it("handles fetch failure for a singleton source gracefully", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      if (String(url) === "/api/commands/ci/status") {
        throw new Error("network error");
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;

    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(capturedPoll).toBeInstanceOf(Function);

    await act(async () => {
      await expect(capturedPoll!()).resolves.not.toThrow();
    });
    act(() => { render(h(TestHarness, null), root); });
    await settleInAct();
    expect(hookResult).toEqual([]);
  });
});
