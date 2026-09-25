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

import { useActiveOperations, type ActiveOperation } from "../../../src/viewer/hooks/use-active-operations.js";
import { usePolling } from "../../../src/viewer/views/use-polling.js";

// ─── Harness ─────────────────────────────────────────────────────────────────

let hookResult: ActiveOperation[] = [];

function TestHarness() {
  hookResult = useActiveOperations();
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

    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url) === "/api/hench/execute/status") {
        return { ok: true, json: async () => ({ executions: [] }) } as Response;
      }
      return { ok: true, json: async () => idleWire() } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    // Unmount inside act() to flush Preact's after-paint effect queue
    // synchronously — an unflushed mount effect otherwise leaves a real
    // requestAnimationFrame/setTimeout fallback pending past teardown.
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
