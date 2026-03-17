// @vitest-environment jsdom
/**
 * Tests for the AnalyzePanel component.
 *
 * Covers: initial rendering, analysis trigger, proposal display,
 * selection controls, acceptance flow, and error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AnalyzePanel } from "../../../src/viewer/components/prd-tree/analyze-panel.js";

/**
 * Flush microtasks and Preact batched updates.
 * Multiple ticks are needed because Preact defers useEffect via setTimeout,
 * and async callbacks (fetch chains) need additional microtask cycles.
 */
async function flush() {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => setTimeout(r, 0));
  }
}

function makeProposal(title = "Test Epic", featureCount = 1, taskCount = 1) {
  return {
    epic: { title, source: "test" },
    features: Array.from({ length: featureCount }, (_, fi) => ({
      title: `Feature ${fi + 1}`,
      source: "test",
      tasks: Array.from({ length: taskCount }, (_, ti) => ({
        title: `Task ${ti + 1}`,
        source: "test",
        sourceFile: "test.ts",
        priority: "medium",
      })),
    })),
  };
}

describe("AnalyzePanel", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    if (root.parentNode) root.parentNode.removeChild(root);
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders initial panel with title and run button", () => {
    // Mock /api/rex/proposals returning empty
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ proposals: [] }), { status: 200 }));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    expect(root.querySelector(".rex-analyze-title")?.textContent).toBe("Analyze Project");
    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    expect(runBtn).not.toBeNull();
    expect(runBtn!.textContent).toBe("Run Analysis");
  });

  it("renders skip LLM checkbox", () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ proposals: [] }), { status: 200 }));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    const label = root.querySelector(".rex-analyze-checkbox-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain("Skip LLM");
  });

  it("shows spinner while analysis is running", async () => {
    // First call: pending proposals check (empty)
    // Second call: analyze endpoint (never resolves during test)
    let resolveAnalyze: (v: Response) => void;
    const analyzePromise = new Promise<Response>((r) => { resolveAnalyze = r; });

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [] }), { status: 200 }))
      .mockReturnValueOnce(analyzePromise);

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    // Click run
    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    act(() => { runBtn!.click(); });

    expect(root.querySelector(".rex-analyze-progress")).not.toBeNull();
    expect(root.querySelector(".rex-analyze-spinner")).not.toBeNull();
    expect(runBtn!.disabled).toBe(true);

    // Resolve to prevent hanging
    resolveAnalyze!(new Response(JSON.stringify({ proposals: [] }), { status: 200 }));
  });

  it("displays proposals after analysis completes", async () => {
    const proposals = [makeProposal("My Epic", 2, 1)];

    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals }), { status: 200 }));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    // Click run analysis
    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    await act(async () => {
      runBtn!.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Should show proposal list
    expect(root.querySelector(".rex-analyze-proposals")).not.toBeNull();
    expect(root.textContent).toContain("My Epic");
    expect(root.textContent).toContain("2 features, 2 tasks");
  });

  it("shows empty state when no proposals found", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [] }), { status: 200 }));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    await act(async () => {
      runBtn!.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(root.querySelector(".rex-analyze-empty")).not.toBeNull();
    expect(root.textContent).toContain("No new proposals");
  });

  it("shows error when analysis fails", async () => {
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "Server error" }), { status: 500 }));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    await act(async () => {
      runBtn!.click();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(root.querySelector(".rex-analyze-error")).not.toBeNull();
    expect(root.textContent).toContain("Server error");
  });

  it("loads pending proposals on first render", async () => {
    vi.useRealTimers();
    const proposals = [makeProposal("Pending Epic")];
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ proposals }), { status: 200 }));

    render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
    // Extra flushes needed: the previous test leaves Preact in fake-timer mode
    // and the first real-timer render needs additional cycles to settle.
    await flush();
    await flush();
    await flush();

    expect(root.textContent).toContain("Pending Epic");
    vi.useFakeTimers();
  });

  it("shows selection controls when proposals are displayed", async () => {
    vi.useRealTimers();
    const proposals = [makeProposal("Epic A"), makeProposal("Epic B")];
    fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ proposals }), { status: 200 }));

    render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
    await flush();
    await flush();
    await flush();

    expect(root.querySelector(".rex-analyze-selection")).not.toBeNull();
    expect(root.textContent).toContain("2 of 2 selected");

    const selectAllBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-select-btn");
    expect(selectAllBtn).not.toBeNull();
    vi.useFakeTimers();
  });
});
