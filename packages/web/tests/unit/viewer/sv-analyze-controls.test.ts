// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AnalyzeControls } from "../../../src/viewer/components/analyze-controls.js";
import { emptyJobTray, jobTrayWith, makeOperation } from "../../helpers/job-tray.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AnalyzeControls (SourceVision full-flow trigger)", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  function buttons(): HTMLButtonElement[] {
    return Array.from(root.querySelectorAll("button"));
  }

  it("renders both quick and full analysis triggers", () => {
    act(() => {
      render(h(AnalyzeControls, { jobs: emptyJobTray() }), root);
    });
    const labels = buttons().map((b) => b.textContent);
    expect(labels.some((l) => l?.includes("Re-analyze"))).toBe(true);
    expect(labels.some((l) => l?.includes("Full analysis"))).toBe(true);
  });

  it("full analysis POSTs full: true and refreshes the tray", async () => {
    const refreshed: number[] = [];
    fetchMock.mockResolvedValue(jsonResponse(202, { ok: true, startedAt: "t" }));

    act(() => {
      render(h(AnalyzeControls, {
        jobs: { operations: [], refresh: async () => { refreshed.push(1); }, stop: async () => {} },
      }), root);
    });
    const fullBtn = buttons().find((b) => b.textContent?.includes("Full analysis"))!;
    await act(async () => {
      fullBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/commands/sv-analyze", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ full: true, deep: false }),
    }));
    // The component no longer decides it is running — it asks the tray to
    // re-read, and the tray is what reports the run from then on.
    expect(refreshed).toHaveLength(1);
  });

  it("shows the full run as running when the tray reports it, with no poll of its own", () => {
    // Regression: this component ran a 3s setInterval against
    // /api/commands/sv-analyze/status, which meant the run was only visible
    // from whichever view had it mounted.
    act(() => {
      render(h(AnalyzeControls, {
        jobs: jobTrayWith([makeOperation({ detail: "Enrichment pass 3" })]),
      }), root);
    });

    const running = buttons().find((b) => b.textContent?.includes("Running full analysis"));
    expect(running).toBeTruthy();
    expect(running?.disabled).toBe(true);
    expect(root.textContent).toContain("Enrichment pass 3");
    expect(fetchMock.mock.calls.map((c) => String(c[0])))
      .not.toContain("/api/commands/sv-analyze/status");
  });

  it("reports a finished full run from the tray", () => {
    act(() => {
      render(h(AnalyzeControls, {
        jobs: jobTrayWith([makeOperation({ status: "done", finishedAt: "2026-08-26T10:05:00.000Z" })]),
      }), root);
    });
    expect(root.textContent).toContain("Full analysis complete");
  });

  it("surfaces an actionable error when the full run cannot start", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "sourcevision CLI not found" }));

    act(() => {
      render(h(AnalyzeControls, { jobs: emptyJobTray() }), root);
    });
    const fullBtn = buttons().find((b) => b.textContent?.includes("Full analysis"))!;
    await act(async () => {
      fullBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(root.querySelector('[role="alert"], .cmd-inline-result-err')?.textContent)
      .toContain("sourcevision CLI not found");
  });

  it("quick re-analyze still POSTs without full flag", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, output: "done" }));

    act(() => {
      render(h(AnalyzeControls, { jobs: emptyJobTray() }), root);
    });
    const quickBtn = buttons().find((b) => b.textContent?.includes("Re-analyze"))!;
    await act(async () => {
      quickBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ deep: false });
  });

  it("checking the deep toggle sends deep: true on both quick and full runs", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, output: "done" }));

    act(() => {
      render(h(AnalyzeControls, { jobs: emptyJobTray() }), root);
    });
    const deepToggle = root.querySelector<HTMLInputElement>(".overview-deep-toggle input[type=checkbox]")!;
    await act(async () => {
      deepToggle.click();
    });

    const quickBtn = buttons().find((b) => b.textContent?.includes("Re-analyze"))!;
    await act(async () => {
      quickBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ deep: true });
  });
});
