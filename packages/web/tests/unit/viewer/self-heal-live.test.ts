// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SelfHealPanel } from "../../../src/viewer/views/commands.js";

function running(output: string) {
  return {
    running: true, startedAt: "2026-08-14T10:00:00Z", finishedAt: null,
    iterations: 3, output, error: null, stopped: false,
  };
}

describe("SelfHealPanel live progress and stop control", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.useFakeTimers();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** Confirm the destructive-action gate, then start the loop. */
  async function startLoop(statusBody: unknown) {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/self-heal/status")) return { ok: true, status: 200, json: async () => statusBody };
      if (u.endsWith("/self-heal/stop")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
      if (u.endsWith("/self-heal") && init?.method === "POST") {
        return { ok: true, status: 202, json: async () => ({ ok: true, startedAt: "t" }) };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);

    act(() => {
      render(h(SelfHealPanel, null), root);
    });
    const proceed = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("I understand"))!;
    await act(async () => {
      proceed.click();
    });
    const start = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent?.match(/Start|Run/))!;
    await act(async () => {
      start.click();
      await vi.advanceTimersByTimeAsync(10);
    });
  }

  it("shows the current iteration and phase parsed from loop output", async () => {
    // Phases arrive in loop order; the freshest line is the current phase.
    await startLoop(running("iteration 2/3\nanalyzing zones\nphase: recommend"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(root.textContent).toContain("iteration 2/3");
    expect(root.textContent?.toLowerCase()).toContain("recommend");
  });

  it("offers a Stop control while running and POSTs the stop endpoint", async () => {
    await startLoop(running("iteration 1/3"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    const stopBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Stop");
    expect(stopBtn).toBeTruthy();

    await act(async () => {
      stopBtn!.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock.mock.calls.some(
      ([u, init]) => String(u).endsWith("/self-heal/stop") && (init as RequestInit)?.method === "POST",
    )).toBe(true);
  });

  it("reports an operator stop as stopped, not as a failure", async () => {
    await startLoop({
      running: false, startedAt: "t", finishedAt: "t2",
      iterations: 3, output: "iteration 1/3", error: null, stopped: true,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500);
    });
    expect(root.textContent?.toLowerCase()).toContain("stopped");
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
});
