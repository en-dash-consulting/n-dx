// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AdaptiveOptimizationView } from "../../../src/viewer/views/adaptive-optimization.js";

const ANALYSIS = {
  metrics: {
    timestamp: "2026-08-13T00:00:00Z",
    totalRuns: 42,
    recentSuccessRate: 0.85,
    recentAvgTurns: 18.2,
    recentAvgTokens: 52000,
    recentAvgDurationMs: 120000,
    recentTaskCount: 12,
    runsPerDay: 3.5,
    successRateTrend: 0.05,
    tokenUsageTrend: -0.1,
  },
  adjustments: [
    {
      id: "adj-1",
      category: "efficiency-tuning",
      priority: "high",
      title: "Lower max turns",
      description: "Recent runs finish well under the limit",
      rationale: "Average turns is 18 vs limit 50",
      configChanges: { maxTurns: 30 },
      autoApplicable: true,
      currentValue: 50,
      proposedValue: 30,
      configKey: "maxTurns",
    },
  ],
  notifications: [],
  settings: { enabled: false, windowSize: 20, minRunsRequired: 5, lockedKeys: ["maxTokens"] },
};

const HISTORY = {
  records: [
    {
      adjustmentId: "adj-0",
      title: "Raised token budget",
      category: "resource-scaling",
      configKey: "tokenBudget",
      decision: "applied",
      previousValue: 0,
      newValue: 200000,
      automatic: true,
      timestamp: "2026-08-12T00:00:00Z",
    },
  ],
  stats: { total: 1, applied: 1, dismissed: 0, overridden: 0, automatic: 1, manual: 0, byCategory: {} },
};

const SETTINGS = {
  settings: ANALYSIS.settings,
  overrides: { loopPauseMs: 5000 },
};

function routeMock(url: string): unknown {
  if (url.endsWith("/analysis")) return ANALYSIS;
  if (url.endsWith("/history")) return HISTORY;
  if (url.endsWith("/settings")) return SETTINGS;
  return { ok: true };
}

describe("AdaptiveOptimizationView", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => routeMock(url),
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function renderView() {
    act(() => {
      render(h(AdaptiveOptimizationView, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
  }

  it("renders metrics, adjustments, settings, and history from the API", async () => {
    await renderView();
    // Metrics
    expect(root.textContent).toContain("85%");
    expect(root.textContent).toContain("42");
    // Adjustment row with current → proposed
    expect(root.textContent).toContain("Lower max turns");
    expect(root.textContent).toContain("50");
    expect(root.textContent).toContain("30");
    // Settings + locked keys + overrides
    expect(root.textContent).toContain("maxTokens");
    expect(root.textContent).toContain("loopPauseMs");
    // History
    expect(root.textContent).toContain("Raised token budget");
    expect(root.textContent).toContain("applied");
  });

  it("applies an adjustment with the documented contract", async () => {
    await renderView();
    const applyBtn = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent === "Apply")!;
    await act(async () => {
      applyBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    const call = fetchMock.mock.calls.find(([u]) => String(u).endsWith("/apply"));
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call![1] as RequestInit).body));
    expect(body).toMatchObject({
      adjustmentId: "adj-1",
      configKey: "maxTurns",
      newValue: 30,
      title: "Lower max turns",
      category: "efficiency-tuning",
    });
  });

  it("dismisses an adjustment via /dismiss/:id", async () => {
    await renderView();
    const dismissBtn = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent === "Dismiss")!;
    await act(async () => {
      dismissBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/dismiss/adj-1"))).toBe(true);
  });

  it("toggles adaptive mode via POST /settings", async () => {
    await renderView();
    const toggle = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      toggle.checked = true;
      toggle.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 0));
    });
    const call = fetchMock.mock.calls.find(
      ([u, init]) => String(u).endsWith("/settings") && (init as RequestInit)?.method === "POST",
    );
    expect(call).toBeTruthy();
    expect(JSON.parse(String((call![1] as RequestInit).body))).toMatchObject({ enabled: true });
  });

  it("shows an error state when analysis cannot load", async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await renderView();
    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });
});
