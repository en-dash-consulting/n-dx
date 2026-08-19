// @vitest-environment jsdom
/**
 * Tests for the WorkflowOptimizationView (Hench → Optimization) —
 * standard-styling regression added when the page was brought in line
 * with the shared dashboard UI systems (cmd-btn, stat-card, data-table,
 * filter-select).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { WorkflowOptimizationView } from "../../../src/viewer/views/workflow-optimization.js";

/** Poll until an assertion passes or timeout is reached. */
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

const ANALYSIS = {
  totalRuns: 12,
  timeRange: { earliest: "2026-08-01T00:00:00Z", latest: "2026-08-15T00:00:00Z" },
  stats: {
    successRate: 0.4,
    avgTurns: 14.2,
    avgTokensPerRun: 52000,
    avgDurationMs: 480000,
    failuresByStatus: { failed: 3, cancelled: 1 },
    troubleTaskIds: [],
    turnLimitHits: 2,
    budgetExceededCount: 0,
  },
  suggestions: [
    {
      id: "s1",
      category: "token-efficiency",
      priority: "high",
      title: "Reduce context size",
      description: "Runs are consuming excessive tokens.",
      rationale: "Average tokens per run is high.",
      impact: "Lower token spend per run.",
      configChanges: { "hench.maxTurns": 30 },
      autoApplicable: true,
    },
    {
      id: "s2",
      category: "config-tuning",
      priority: "low",
      title: "Tune turn limit",
      description: "Turn limit hits detected.",
      rationale: "Two runs hit the turn limit.",
      impact: "Fewer truncated runs.",
      autoApplicable: false,
    },
  ],
  decisionHistory: { total: 3, accepted: 1, rejected: 1, deferred: 1 },
};

describe("WorkflowOptimizationView", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubAnalysis(body: unknown = ANALYSIS) {
    fetchSpy.mockImplementation((url: string) => {
      if (String(url) === "/api/hench/workflow/analysis") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
  }

  async function mount() {
    render(h(WorkflowOptimizationView, null), root);
    await waitFor(() => {
      expect(root.querySelector(".wf-suggestions-section")).toBeTruthy();
    });
  }

  it("renders stats with the standard stat-grid/stat-card system", async () => {
    stubAnalysis();
    await mount();

    const grid = root.querySelector(".stat-grid")!;
    expect(grid).toBeTruthy();
    const cards = grid.querySelectorAll(".stat-card");
    expect(cards.length).toBeGreaterThanOrEqual(5);
    expect(grid.querySelector(".stat-card .value")?.textContent).toBe("12");
    expect(grid.querySelector(".stat-card .label")?.textContent).toBe("Total Runs");
    // Low success rate marks its card with the warn variant
    expect(grid.querySelector(".stat-card.wf-stat-warn")).toBeTruthy();
  });

  it("renders the header and category filter with standard classes", async () => {
    stubAnalysis();
    await mount();

    expect(root.querySelector(".wf-header.view-header")).toBeTruthy();
    expect(root.querySelector("select.filter-select")).toBeTruthy();
  });

  it("suggestion actions use the standard button system", async () => {
    stubAnalysis();
    await mount();

    const card = root.querySelector(".wf-suggestion-card")!;
    expect(card.querySelector(".link-btn")?.textContent).toContain("Details");
    expect(card.querySelector(".cmd-btn.cmd-btn-primary")?.textContent).toContain("Preview & Apply");
    const secondaries = card.querySelectorAll(".cmd-btn.cmd-btn-secondary");
    expect([...secondaries].some((b) => b.textContent === "Defer")).toBe(true);
    expect(card.querySelector(".cmd-btn.cmd-btn-danger")?.textContent).toBe("Dismiss");
  });

  it("non-auto-applicable suggestions have no Preview & Apply button", async () => {
    stubAnalysis();
    await mount();

    const cards = root.querySelectorAll(".wf-suggestion-card");
    expect(cards).toHaveLength(2);
    expect(cards[1].querySelector(".cmd-btn.cmd-btn-primary")).toBeNull();
  });

  it("preview panel renders a standard data-table with cmd-btn actions", async () => {
    stubAnalysis();
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/hench/workflow/analysis") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ANALYSIS) });
      }
      if (String(url) === "/api/hench/workflow/apply" && init?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ diff: [{ path: "hench.maxTurns", oldValue: 50, newValue: 30 }] }),
        });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
    await mount();

    (root.querySelector(".wf-suggestion-card .cmd-btn.cmd-btn-primary") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(root.querySelector(".wf-preview-overlay")).toBeTruthy();
    });
    expect(root.querySelector(".wf-preview-overlay table.data-table")).toBeTruthy();
    const actions = root.querySelector(".wf-preview-actions")!;
    expect(actions.querySelector(".cmd-btn.cmd-btn-primary")?.textContent).toContain("Apply");
    expect(actions.querySelector(".cmd-btn.cmd-btn-secondary")?.textContent).toBe("Cancel");
  });

  it("shows the empty state when there are no runs", async () => {
    stubAnalysis({ ...ANALYSIS, totalRuns: 0 });
    render(h(WorkflowOptimizationView, null), root);
    await waitFor(() => {
      expect(root.querySelector(".wf-empty")).toBeTruthy();
    });
  });
});
