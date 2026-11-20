// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { agentLabel, remainingLine, runFraction, UpNext } from "../../../src/viewer/views/work-now.js";
import { estimateBasis, estimateFor, estimateLine, formatDuration, type RunEstimates } from "../../../src/viewer/components/run-estimate.js";

const ESTIMATES: RunEstimates = {
  windowDays: 30,
  overall: { runs: 12, durationMs: 10 * 60_000, tokens: 41_000, costUsd: 0.85 },
  byTier: { heavy: { runs: 4, durationMs: 30 * 60_000, tokens: 120_000, costUsd: 3.2 } },
};

describe("run estimates", () => {
  it("uses a tier's own figure, else the overall one", () => {
    expect(estimateFor(ESTIMATES, "heavy")?.durationMs).toBe(30 * 60_000);
    expect(estimateFor(ESTIMATES, "light")).toBe(ESTIMATES.overall);
    expect(estimateFor(ESTIMATES, null)).toBe(ESTIMATES.overall);
    expect(estimateFor(null, "heavy")).toBeNull();
  });

  it("reads as one approximate line, with its basis in the tooltip", () => {
    expect(estimateLine(ESTIMATES.overall!)).toBe("~10 min · ~41k tokens · ~$0.85");
    expect(estimateLine({ ...ESTIMATES.overall!, costUsd: null })).toBe("~10 min · ~41k tokens");
    expect(estimateBasis(ESTIMATES.byTier["heavy"]!, ESTIMATES, "heavy")).toBe("Median of 4 finished heavy runs in the last 30 days");
    expect(estimateBasis(ESTIMATES.overall!, ESTIMATES, "light")).toBe("Median of 12 finished runs in the last 30 days");
  });

  it("formats durations from seconds to hours", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(12 * 60_000)).toBe("12 min");
    expect(formatDuration(80 * 60_000)).toBe("1 h 20 min");
  });
});

describe("Running now", () => {
  const now = Date.parse("2026-11-20T12:00:00.000Z");
  const started = new Date(now - 4 * 60_000).toISOString();

  it("names the agent by vendor and model", () => {
    expect(agentLabel({ vendor: "claude", model: "sonnet" })).toBe("claude · sonnet");
    expect(agentLabel({ vendor: null, model: null })).toBe("Agent");
  });

  it("measures a run against a typical one, capped at the median", () => {
    expect(runFraction(started, 10 * 60_000, now)).toBeCloseTo(0.4);
    expect(runFraction(started, 2 * 60_000, now)).toBe(1);
    expect(runFraction(null, 10 * 60_000, now)).toBeNull();
    expect(remainingLine(started, 10 * 60_000, now)).toBe("about 6 min left");
    expect(remainingLine(started, 2 * 60_000, now)).toBe("longer than usual");
  });
});

describe("Up next", () => {
  let root: HTMLDivElement;
  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.startsWith("/api/hench/ready")
        ? {
            dir: "/repo",
            total: 2,
            tasks: [
              { id: "a", title: "Task A", status: "pending", priority: "high", parentChain: [], criteriaCount: 1, resume: false, assignee: "Ann <ann@x.io>", tier: "heavy" },
              { id: "b", title: "Task B", status: "pending", priority: null, parentChain: [], criteriaCount: 0, resume: false, assignee: null, tier: null },
            ],
          }
        : url === "/api/hench/estimates" ? ESTIMATES : {};
      return { ok: true, status: 200, json: async () => body } as Response;
    }));
  });
  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  it("says who each task is for, states the typical run once, and estimates only a tier with its own figure", async () => {
    await act(async () => { render(h(UpNext, { navigateTo: vi.fn() }), root); });
    for (let i = 0; i < 4; i++) await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    const rows = [...root.querySelectorAll<HTMLElement>(".ready-row")];
    expect(rows.map((r) => r.querySelector(".ready-assignee")?.textContent)).toEqual(["Ann", "Unassigned"]);
    expect(rows[0]!.querySelector(".ready-estimate")?.textContent).toBe("~30 min · ~120k tokens · ~$3.20");
    expect(rows[1]!.querySelector(".ready-estimate")).toBeNull();
    expect(root.querySelector(".run-typical")?.textContent).toBe("Typical run~10 min · ~41k tokens · ~$0.85");
    expect(root.querySelectorAll(".run-typical")).toHaveLength(1);
    // The tile names the list, so it draws no "Ready to run" heading of its own.
    expect(root.querySelector(".ready-title-head")).toBeNull();
  });
});
