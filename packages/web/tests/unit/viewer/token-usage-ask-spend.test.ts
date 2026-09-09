// @vitest-environment jsdom
/**
 * Dashboard Ask spend in the token-usage view.
 *
 * The rollup can carry an ask's tokens and the view can still not show them —
 * that gap is the whole point of the task, since an ask was previously the one
 * kind of spend invisible in the view that reports spend. These tests mount the
 * real view over a stubbed `/api/token/utilization` and assert the ask reads as
 * its own line, next to the hench run it must not be confused with.
 *
 * @see packages/web/src/server/routes-token-usage.ts — where ask events enter
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TokenUsageView } from "../../../src/viewer/views/token-usage.js";

function pkg(input: number, output: number, calls: number) {
  return {
    inputTokens: input,
    outputTokens: output,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    calls,
  };
}

/** A utilization payload holding one hench run and one dashboard ask. */
function utilizationPayload() {
  const toolBreakdown = {
    rex: pkg(0, 0, 0),
    hench: pkg(5000, 2000, 1),
    sv: pkg(1200, 42, 1),
  };
  const usage = {
    packages: toolBreakdown,
    totalInputTokens: 6200,
    totalOutputTokens: 2042,
    totalCacheCreationTokens: 300,
    totalCacheReadTokens: 900,
    totalCalls: 2,
  };
  return {
    configured: { vendor: "claude", model: "claude-opus-5" },
    source: {
      rex: "missing (.rex/execution-log.jsonl)",
      hench: ".hench/runs/*.json",
      sourcevision: ".sourcevision/manifest.json",
      ask: ".sourcevision/ask-usage.jsonl",
    },
    weeklyBudget: { budget: null, source: "missing_budget" },
    weeklyBudgetValidationErrors: [],
    period: "day",
    window: { since: null, until: null },
    usage,
    cost: { total: "$0.05", totalRaw: 0.05, inputCost: 0.02, outputCost: 0.03, cacheWriteCost: 0, cacheReadCost: 0 },
    byVendorModel: [
      { vendor: "claude", model: "claude-opus-5", ...pkg(1200, 42, 1), toolBreakdown },
    ],
    trend: [],
    commands: [
      { command: "run", package: "hench", ...pkg(5000, 2000, 1) },
      { command: "ask", package: "sv", ...pkg(1200, 42, 1) },
    ],
    budget: { severity: "ok", warnings: [] },
    eventCount: 2,
  };
}

describe("token usage view — Ask spend", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/token/utilization")) {
        return { ok: true, status: 200, json: async () => utilizationPayload() };
      }
      // The per-item rollup and PRD are unrelated to ask spend; failing them
      // is non-fatal by design and keeps this test to one subject.
      return { ok: false, status: 404, json: async () => ({}) };
    }));
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function mount(): Promise<void> {
    await act(async () => {
      render(h(TokenUsageView, {}), root);
    });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  }

  /**
   * Rows of the Command Details table.
   *
   * Located by its heading rather than by `.token-table`, which the view uses
   * for more than one table — the vendor/model table is the first match and
   * would silently answer for this one.
   */
  function commandRows(): Array<{ pkg: string; command: string; calls: string }> {
    const section = Array.from(root.querySelectorAll(".token-section")).find(
      (el) => el.querySelector("h3")?.textContent === "Command Details",
    );
    const table = section?.querySelector("table");
    if (!table) return [];
    return Array.from(table.querySelectorAll("tbody tr")).map((tr) => {
      const cells = Array.from(tr.querySelectorAll("td")).map((td) => td.textContent?.trim() ?? "");
      return { pkg: cells[0] ?? "", command: cells[1] ?? "", calls: cells[5] ?? "" };
    });
  }

  it("shows the ask as its own command row", async () => {
    await mount();

    const ask = commandRows().find((r) => r.command === "ask");
    expect(ask).toBeDefined();
    expect(ask!.pkg).toBe("Sourcevision");
    expect(ask!.calls).toBe("1");
  });

  it("keeps it distinguishable from hench run spend", async () => {
    await mount();

    const rows = commandRows();
    // Two lines, not one merged total — the row a reader would use to tell
    // dashboard spend from agent spend.
    expect(rows.find((r) => r.command === "run")?.pkg).toBe("Hench");
    expect(rows.find((r) => r.command === "ask")?.pkg).toBe("Sourcevision");
  });

  it("counts the ask tokens in the totals the view reports", async () => {
    await mount();

    // 6200 input across both sources; the ask's 1200 is part of it rather than
    // being dropped on the way to the screen.
    expect(root.textContent).toContain("6,200");
  });
});
