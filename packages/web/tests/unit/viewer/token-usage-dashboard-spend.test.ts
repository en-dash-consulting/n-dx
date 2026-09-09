// @vitest-environment jsdom
/**
 * The LLM Utilization view has to make two things visible that a typecheck
 * cannot check for: the dashboard's own spend as a bucket of its own, and cache
 * tokens as figures rather than as arithmetic folded into a total.
 *
 * Both were previously invisible for the same reason — the view's local mirror
 * of the API shape omitted the fields — so these assertions read the rendered
 * DOM rather than the component's props.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TokenUsageView } from "../../../src/viewer/views/token-usage.js";

// ---------------------------------------------------------------------------
// Fixture: one hench run and one dashboard ask, in the wire shape the server
// serves from GET /api/token/utilization.
// ---------------------------------------------------------------------------

function pkg(over: Partial<Record<string, number>> = {}) {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    calls: 0,
    ...over,
  };
}

const HENCH = pkg({ inputTokens: 5_000, outputTokens: 700, calls: 1 });
const ASK = pkg({
  inputTokens: 900,
  outputTokens: 60,
  cacheCreationTokens: 400,
  cacheReadTokens: 12_000,
  calls: 1,
});

const BREAKDOWN = { hench: HENCH, rex: pkg(), sv: pkg(), web: ASK };

const COST = {
  total: "$0.05",
  totalRaw: 0.05,
  inputCost: 0.0177,
  outputCost: 0.0114,
  cacheWriteCost: 0.0015,
  cacheReadCost: 0.0036,
};

const UTILIZATION = {
  configured: { vendor: "claude", model: "claude-opus-5" },
  source: {
    rex: "missing (.rex/execution-log.jsonl)",
    hench: ".hench/runs/*.json",
    sourcevision: "missing (.sourcevision/manifest.json)",
    dashboard: ".n-dx-web-usage.jsonl",
  },
  period: "day",
  window: { since: null, until: null },
  usage: {
    packages: BREAKDOWN,
    totalInputTokens: 5_900,
    totalOutputTokens: 760,
    totalCacheCreationTokens: 400,
    totalCacheReadTokens: 12_000,
    totalCalls: 2,
  },
  cost: COST,
  byVendorModel: [
    {
      vendor: "local",
      model: "qwen-3-coder",
      ...ASK,
      toolBreakdown: { hench: pkg(), rex: pkg(), sv: pkg(), web: ASK },
    },
  ],
  trend: [
    {
      period: "2026-03-01",
      totalTokens: 19_060,
      byVendorModel: [],
      toolBreakdown: BREAKDOWN,
      estimatedCost: COST,
    },
  ],
  commands: [
    { command: "run", package: "hench", ...HENCH },
    { command: "ask", package: "web", ...ASK },
  ],
  budget: { severity: "ok", warnings: [] },
  eventCount: 2,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

describe("LLM Utilization view — dashboard spend", () => {
  let root: HTMLDivElement;

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/token/utilization")) return Promise.resolve(jsonResponse(UTILIZATION));
        if (url.startsWith("/api/hench/task-usage")) return Promise.resolve(jsonResponse({ rollup: {} }));
        if (url.startsWith("/data/prd.json")) return Promise.resolve(jsonResponse({ items: [] }));
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }),
    );

    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => {
      render(h(TokenUsageView, null), root);
    });
    await settle();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  /** Row cells of the Command Details table, keyed by command name. */
  function commandRow(command: string): string[] {
    const rows = Array.from(root.querySelectorAll<HTMLTableRowElement>("table.token-table tr"));
    const row = rows.find((r) => r.cells[1]?.textContent === command);
    if (!row) throw new Error(`no command row for "${command}"`);
    return Array.from(row.cells).map((c) => c.textContent ?? "");
  }

  it("labels the dashboard bucket rather than folding it into Sourcevision", () => {
    const badges = Array.from(root.querySelectorAll(".pkg-badge")).map((b) => b.textContent);
    expect(badges).toContain("Dashboard");
    // The donut names it too, so the share of spend is legible at a glance.
    const donutNames = Array.from(root.querySelectorAll(".pkg-name")).map((n) => n.textContent);
    expect(donutNames).toContain("Dashboard");
    expect(donutNames).toContain("Hench");
  });

  it("offers the dashboard as its own package filter", () => {
    const options = Array.from(root.querySelectorAll<HTMLOptionElement>("select.filter-input option"))
      .map((o) => o.value);
    expect(options).toEqual(["all", "hench", "rex", "sv", "web"]);
  });

  it("keeps the ask row distinguishable from the hench run row", () => {
    const ask = commandRow("ask");
    const run = commandRow("run");
    expect(ask[0]).toBe("Dashboard");
    expect(run[0]).toBe("Hench");
    expect(ask[2]).toBe("900");
    expect(run[2]).toBe("5,000");
  });

  it("reports the ask's cache tokens as figures rather than hiding them", () => {
    const ask = commandRow("ask");
    // Input, Output, Cache Write, Cache Read, Total, Calls.
    expect(ask[4]).toBe("400");
    expect(ask[5]).toBe("12,000");
    // The row total includes cache — otherwise it would disagree with the cost
    // column, which has always charged for it.
    expect(ask[6]).toBe("13,360");
  });

  it("gives cache tokens their own headline figures", () => {
    const metrics = Array.from(root.querySelectorAll(".overview-metrics .metric-card"))
      .map((c) => c.textContent ?? "");
    expect(metrics.some((m) => m.includes("Cache Write Tokens") && m.includes("400"))).toBe(true);
    expect(metrics.some((m) => m.includes("Cache Read Tokens") && m.includes("12.0k"))).toBe(true);
    // Total Tokens now counts every class: 5900 + 760 + 400 + 12000.
    expect(metrics.some((m) => m.includes("Total Tokens") && m.includes("19.1k"))).toBe(true);
  });

  it("names the ledger as the dashboard usage source", () => {
    expect(root.textContent).toContain(".n-dx-web-usage.jsonl");
  });

  it("prices cache writes and reads as their own cost lines", () => {
    const labels = Array.from(root.querySelectorAll(".cost-item .cost-label")).map((l) => l.textContent);
    expect(labels).toContain("Cache writes");
    expect(labels).toContain("Cache reads");
  });

  it("stacks the dashboard bucket without overlapping the others in the trend chart", () => {

    const rects = Array.from(root.querySelectorAll<SVGRectElement>("svg.period-chart rect"));
    // hench + web have tokens; rex and sv are zero and emit no rect.
    expect(rects).toHaveLength(2);

    const spans = rects
      .map((r) => ({
        y: Number(r.getAttribute("y")),
        height: Number(r.getAttribute("height")),
      }))
      .sort((a, b) => b.y - a.y);

    // Each segment starts where the one below it ended: a stack, not a pile.
    expect(spans[1].y + spans[1].height).toBeCloseTo(spans[0].y, 5);
    for (const span of spans) expect(span.height).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Backwards compatibility
// ---------------------------------------------------------------------------

/**
 * The viewer ships as a static bundle, so it can be loaded against an older
 * server or against captured JSON. The cache fields and the `web` bucket are
 * therefore optional in its wire mirror — and this is the case that keeps that
 * optionality honest: reading `.toFixed` off an absent cost, or summing an
 * absent bucket, throws inside render and blanks the entire page rather than
 * degrading one figure.
 */
describe("LLM Utilization view — payload without the dashboard fields", () => {
  let root: HTMLDivElement;

  const LEGACY = {
    configured: { vendor: "openai", model: "gpt-5" },
    source: { rex: "ok", hench: "ok", sourcevision: "ok" },
    period: "day",
    window: { since: null, until: null },
    usage: {
      packages: {
        rex: { inputTokens: 2_000, outputTokens: 500, calls: 3 },
        hench: { inputTokens: 1_000, outputTokens: 300, calls: 2 },
        sv: { inputTokens: 500, outputTokens: 100, calls: 1 },
      },
      totalInputTokens: 3_500,
      totalOutputTokens: 900,
      totalCalls: 6,
    },
    cost: { total: "$0.25", totalRaw: 0.25, inputCost: 0.18, outputCost: 0.07 },
    byVendorModel: [{ vendor: "openai", model: "gpt-5", inputTokens: 3_500, outputTokens: 900, calls: 6, toolBreakdown: {} }],
    trend: [{ period: "2026-03-01", totalTokens: 4_400, byVendorModel: [], toolBreakdown: {}, estimatedCost: { total: "$0.25", totalRaw: 0.25, inputCost: 0.18, outputCost: 0.07 } }],
    commands: [{ command: "run", package: "hench", inputTokens: 1_000, outputTokens: 300, calls: 2 }],
    budget: { severity: "ok", warnings: [] },
    eventCount: 6,
  };

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input);
        if (url.startsWith("/api/token/utilization")) return Promise.resolve(jsonResponse(LEGACY));
        if (url.startsWith("/api/hench/task-usage")) return Promise.resolve(jsonResponse({ rollup: {} }));
        if (url.startsWith("/data/prd.json")) return Promise.resolve(jsonResponse({ items: [] }));
        return Promise.resolve(new Response("Not found", { status: 404 }));
      }),
    );

    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => {
      render(h(TokenUsageView, null), root);
    });
    await settle();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  it("still renders, treating the absent fields as zero", () => {
    // Rendered at all — the point of the case.
    expect(root.querySelector(".token-usage-container")).not.toBeNull();
    expect(root.textContent).toContain("LLM Utilization");

    const metrics = Array.from(root.querySelectorAll(".overview-metrics .metric-card"))
      .map((c) => c.textContent ?? "");
    // Total falls back to input + output, and cache reads as zero rather than
    // as "undefined" or NaN.
    expect(metrics.some((m) => m.includes("Total Tokens") && m.includes("4.4k"))).toBe(true);
    expect(metrics.some((m) => m.includes("Cache Write Tokens") && m.includes("0"))).toBe(true);
    expect(root.textContent).not.toContain("NaN");
    expect(root.textContent).not.toContain("undefined");
  });

  it("omits the dashboard source row instead of showing an empty one", () => {
    const labels = Array.from(root.querySelectorAll(".token-source-item .cost-label"))
      .map((l) => l.textContent);
    expect(labels).toContain("Sourcevision source");
    expect(labels).not.toContain("Dashboard source");
  });
});
