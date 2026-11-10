// @vitest-environment jsdom
/**
 * The Spend tile's folded summary: total, the latest period, budget use and
 * the top three places the tokens went.
 *
 * @see src/viewer/views/spend-summary.ts
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SpendSummary, spendLines, type SpendReply } from "../../../src/viewer/views/spend-summary.js";

const REPLY: SpendReply = {
  cost: { total: "$12.40" },
  trend: [{ period: "2026-11-09", estimatedCost: { total: "$3.00" } }, { period: "2026-11-10", estimatedCost: { total: "$1.25" } }],
  commands: [
    { command: "run", package: "hench", inputTokens: 600_000, outputTokens: 400_000 },
    { command: "analyze", package: "sv", inputTokens: 200_000 },
    { command: "plan", package: "rex", inputTokens: 50_000 },
    { command: "ask", package: "web", inputTokens: 1_000 },
  ],
  budget: { severity: "warning", cost: { used: 8.5, budget: 10, percent: 85 } },
};

describe("spendLines", () => {
  it("states the total, the latest period, budget use and the top three in plain labels", () => {
    expect(spendLines(REPLY)).toEqual({
      total: "$12.40",
      latest: { period: "2026-11-10", total: "$1.25" },
      budget: { label: "85% of the cost budget used", tone: "warning" },
      top: [
        { label: "Agent runs: run", share: 1_000_000 / 1_251_000, tokens: "1.0M" },
        { label: "Analysis: analyze", share: 200_000 / 1_251_000, tokens: "200.0k" },
        { label: "Planning: plan", share: 50_000 / 1_251_000, tokens: "50.0k" },
      ],
    });
  });

  it("says nothing about a budget or a period it was not given", () => {
    expect(spendLines({})).toEqual({ total: "$0.00", latest: null, budget: null, top: [] });
  });
});

describe("SpendSummary", () => {
  let root: HTMLDivElement | undefined;
  afterEach(() => { if (root) { render(null, root); root.remove(); } vi.unstubAllGlobals(); });

  it("draws the headline, the budget chip and a bar per top command", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => REPLY })));
    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => { render(h(SpendSummary, null), root!); });
    await act(async () => {});
    expect(root.querySelector(".tile-sum-headline")?.textContent).toBe("$12.40 estimated spend · $1.25 on 2026-11-10");
    expect(root.querySelector(".tile-sum-chip--warning")?.textContent).toBe("85% of the cost budget used");
    expect([...root.querySelectorAll(".tile-sum-bar-label")].map((e) => e.textContent)).toEqual(["Agent runs: run", "Analysis: analyze", "Planning: plan"]);
  });
});
