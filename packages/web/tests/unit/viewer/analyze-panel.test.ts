// @vitest-environment jsdom
/**
 * Tests for the AnalyzePanel component.
 *
 * Covers: initial rendering, analysis trigger, proposal display,
 * selection controls, acceptance flow, and error handling.
 *
 * POST /api/rex/analyze starts a background job (see routes-rex-analysis.ts —
 * `rex analyze` is a genuine multi-minute LLM operation on a real project, so
 * the client polls GET /api/rex/analyze/status instead of awaiting one
 * long-lived fetch). Every test below reflects that: a POST returning 202,
 * followed by a status poll returning the final { running: false, report }.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AnalyzePanel } from "../../../src/viewer/components/prd-tree/analyze-panel.js";

/**
 * Poll until an assertion passes or timeout is reached.
 * Replaces fixed flush() counts that flake in slower CI environments.
 */
async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
  fn(); // Final attempt — let it throw
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

const NO_PENDING = () => new Response(JSON.stringify({ proposals: [] }), { status: 200 });
const NOT_RUNNING_STATUS = () => new Response(
  JSON.stringify({ running: false, finishedAt: null, report: null, output: "", error: null }),
  { status: 200 },
);
const STARTED_202 = () => new Response(
  JSON.stringify({ ok: true, startedAt: new Date().toISOString(), message: "started" }),
  { status: 202 },
);
function finishedWithProposals(proposals: unknown[]) {
  return new Response(
    JSON.stringify({ running: false, finishedAt: new Date().toISOString(), report: { proposals }, output: "", error: null }),
    { status: 200 },
  );
}
function finishedWithError(error: string) {
  return new Response(
    JSON.stringify({ running: false, finishedAt: new Date().toISOString(), report: null, output: "", error }),
    { status: 200 },
  );
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

  /** Mount with no pending proposals and no analysis already running. */
  function mockIdleMount() {
    fetchSpy
      .mockResolvedValueOnce(NO_PENDING())       // GET /api/rex/proposals
      .mockResolvedValueOnce(NOT_RUNNING_STATUS()); // GET /api/rex/analyze/status
  }

  it("renders initial panel with title and run button", () => {
    mockIdleMount();

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
    mockIdleMount();

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });

    const label = root.querySelector(".rex-analyze-checkbox-label");
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain("Skip LLM");
  });

  it("shows spinner while analysis is running", async () => {
    mockIdleMount();
    // POST /api/rex/analyze — never resolves during this test.
    let resolveStart: (v: Response) => void;
    const startPromise = new Promise<Response>((r) => { resolveStart = r; });
    fetchSpy.mockReturnValueOnce(startPromise);

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    act(() => { runBtn!.click(); });

    expect(root.querySelector(".rex-analyze-progress")).not.toBeNull();
    expect(root.querySelector(".rex-analyze-spinner")).not.toBeNull();
    expect(runBtn!.disabled).toBe(true);

    // Resolve to prevent hanging.
    resolveStart!(STARTED_202());
  });

  it("displays proposals after analysis completes", async () => {
    mockIdleMount();
    const proposals = [makeProposal("My Epic", 2, 1)];
    fetchSpy
      .mockResolvedValueOnce(STARTED_202())               // POST /api/rex/analyze
      .mockResolvedValueOnce(finishedWithProposals(proposals)); // poll tick

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    await act(async () => {
      runBtn!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000); // first poll tick
    });

    expect(root.querySelector(".rex-analyze-proposals")).not.toBeNull();
    expect(root.textContent).toContain("My Epic");
    expect(root.textContent).toContain("2 features, 2 tasks");
  });

  it("shows empty state when no proposals found", async () => {
    mockIdleMount();
    fetchSpy
      .mockResolvedValueOnce(STARTED_202())
      .mockResolvedValueOnce(finishedWithProposals([]));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    await act(async () => {
      runBtn!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(root.querySelector(".rex-analyze-empty")).not.toBeNull();
    expect(root.textContent).toContain("No new proposals");
  });

  it("shows error when analysis fails", async () => {
    mockIdleMount();
    fetchSpy
      .mockResolvedValueOnce(STARTED_202())
      .mockResolvedValueOnce(finishedWithError("Server error"));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    const runBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-btn-run");
    await act(async () => {
      runBtn!.click();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(2000);
    });

    expect(root.querySelector(".rex-analyze-error")).not.toBeNull();
    expect(root.textContent).toContain("Server error");
  });

  it("resumes polling an analysis already running when the panel mounts", async () => {
    // Pending-proposals check comes back empty, but the status check finds
    // a job already in flight (e.g. the operator reloaded mid-analysis).
    fetchSpy
      .mockResolvedValueOnce(NO_PENDING())
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ running: true, finishedAt: null, report: null, output: "", error: null }),
        { status: 200 },
      ))
      .mockResolvedValueOnce(finishedWithProposals([makeProposal("Resumed Epic")]));

    act(() => {
      render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);
      vi.advanceTimersByTime(0);
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    // Spinner shows without ever clicking "Run Analysis".
    expect(root.querySelector(".rex-analyze-progress")).not.toBeNull();

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

    expect(root.textContent).toContain("Resumed Epic");
  });

  it("loads pending proposals on first render", async () => {
    vi.useRealTimers();
    const proposals = [makeProposal("Pending Epic")];
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals }), { status: 200 }))
      .mockResolvedValueOnce(NOT_RUNNING_STATUS());

    render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);

    await waitFor(() => {
      expect(root.textContent).toContain("Pending Epic");
    });
    vi.useFakeTimers();
  });

  it("shows selection controls when proposals are displayed", async () => {
    vi.useRealTimers();
    const proposals = [makeProposal("Epic A"), makeProposal("Epic B")];
    fetchSpy
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposals }), { status: 200 }))
      .mockResolvedValueOnce(NOT_RUNNING_STATUS());

    render(h(AnalyzePanel, { onPrdChanged: vi.fn() }), root);

    await waitFor(() => {
      expect(root.querySelector(".rex-analyze-selection")).not.toBeNull();
    });
    expect(root.textContent).toContain("2 of 2 selected");

    const selectAllBtn = root.querySelector<HTMLButtonElement>(".rex-analyze-select-btn");
    expect(selectAllBtn).not.toBeNull();
    vi.useFakeTimers();
  });
});
