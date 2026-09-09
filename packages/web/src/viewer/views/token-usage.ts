/**
 * LLM Utilization dashboard view.
 *
 * Shows token consumption across packages (rex, hench, sourcevision) and the
 * dashboard's own spend, grouped by command and time period, with budget status
 * indicators and trend visualization.
 *
 * ## Dashboard spend
 *
 * The `web` package is the dashboard itself — today the SourceVision Ask panel.
 * It is rendered as its own colour, its own donut slice, and its own filter
 * option rather than being folded into Sourcevision, because "what did the
 * dashboard cost me?" is the question this view exists to answer about itself.
 * The server-side ledger is `src/server/dashboard-usage.ts`.
 *
 * ## Cache tokens
 *
 * Cache-creation and cache-read counts are shown, not folded away. The server
 * has always reported and priced them (`estimateCost` charges cache writes at
 * 1.25x input and reads at 0.1x), but this view used to type its rows without
 * the fields and total only input + output — so the headline "Total Tokens"
 * disagreed with the "Est. Cost" beside it, and on a cache-heavy run most of
 * the bill had no visible line. Consistent with the hench/rex decision to
 * report cache tokens rather than hide them.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import { MetricCard, BarChart } from "../visualization/index.js";
import { BrandedHeader } from "../components/index.js";
import { usePolling } from "../hooks/index.js";
import { TOKEN_USAGE_POLL_KEY, USAGE_POLL_INTERVAL_MS } from "../usage/constants.js";

// ---------------------------------------------------------------------------
// Types (mirroring API response shapes)
// ---------------------------------------------------------------------------

/** Package keys the server aggregates by; `web` is the dashboard itself. */
type TokenPackage = "hench" | "rex" | "sv" | "web";

/** Render order, shared by the chart stack, the donut, and the legend. */
const TOKEN_PACKAGES: readonly TokenPackage[] = ["hench", "rex", "sv", "web"];

/**
 * Wire shapes below are `as`-cast from `res.json()`, so they describe what the
 * server sends rather than anything the runtime enforces. Fields added after
 * the first release are therefore **optional**: the viewer is built and
 * deployed as a static artifact, so it can be paired with an older server or
 * with captured JSON, and one absent number must not blank the whole page.
 * Absent always means "this source reported nothing", which reads as zero.
 */
interface PackageTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  calls: number;
}

type ToolBreakdown = Partial<Record<TokenPackage, PackageTokenUsage>>;

interface AggregateTokenUsage {
  packages: ToolBreakdown;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens?: number;
  totalCacheReadTokens?: number;
  totalCalls: number;
}

interface CostEstimate {
  total: string;
  totalRaw: number;
  inputCost: number;
  outputCost: number;
  cacheWriteCost?: number;
  cacheReadCost?: number;
}

interface CommandTokenUsage extends PackageTokenUsage {
  command: string;
  package: string;
}

interface PeriodBucket {
  period: string;
  usage: AggregateTokenUsage;
  estimatedCost: CostEstimate;
}

interface VendorModelUsage extends PackageTokenUsage {
  vendor: string;
  model: string;
  toolBreakdown: ToolBreakdown;
}

interface UtilizationResponse {
  configured: { vendor: string; model: string };
  source: { rex: string; hench: string; sourcevision: string; dashboard?: string };
  period: TimePeriod;
  window: { since: string | null; until: string | null };
  usage: AggregateTokenUsage;
  cost: CostEstimate;
  byVendorModel: VendorModelUsage[];
  trend: Array<{
    period: string;
    totalTokens: number;
    byVendorModel: VendorModelUsage[];
    toolBreakdown: ToolBreakdown;
    estimatedCost: CostEstimate;
  }>;
  commands: CommandTokenUsage[];
  budget: BudgetCheckResult;
  eventCount: number;
}

type BudgetSeverity = "ok" | "warning" | "exceeded";

interface BudgetDimension {
  used: number;
  budget: number;
  percent: number;
  severity: BudgetSeverity;
}

interface BudgetCheckResult {
  severity: BudgetSeverity;
  tokens?: BudgetDimension;
  cost?: BudgetDimension;
  warnings: string[];
}

type TimePeriod = "day" | "week" | "month";

/** Per-PRD-item token rollup, mirroring the rex `get_token_usage` MCP tool's
 * self/descendants/total shape. Wire shape served by GET /api/hench/task-usage
 * (field `rollup`), which is the same data the PRD tree view renders per node —
 * this table is the aggregate view across every item at once. */
interface ItemUsageRollupWire {
  self: { totalTokens: number; runCount: number };
  descendants: { totalTokens: number; runCount: number };
  total: { totalTokens: number; runCount: number };
  duration: { totalMs: number; runningMs: number; isRunning: boolean };
}

interface ItemUsageRow extends ItemUsageRollupWire {
  id: string;
  title: string;
  level: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function fmtNumber(n: number): string {
  return n.toLocaleString();
}

function fmtWindow(since: string | null, until: string | null): string {
  return `${since ? new Date(since).toLocaleDateString() : "start"} → ${until ? new Date(until).toLocaleDateString() : "now"}`;
}

interface PrdItemNode {
  id: string;
  title: string;
  level: string;
  children?: PrdItemNode[];
}

/** Flatten the PRD tree into an id → { title, level } map for join with the token rollup. */
function flattenPrdTitles(items: PrdItemNode[]): Map<string, { title: string; level: string }> {
  const out = new Map<string, { title: string; level: string }>();
  const stack = [...items];
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.set(node.id, { title: node.title, level: node.level });
    if (node.children) stack.push(...node.children);
  }
  return out;
}

function fmtItemDuration(ms: number): string {
  if (ms <= 0) return "—";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m`;
  return `${(mins / 60).toFixed(1)}h`;
}

const PKG_COLORS: Record<string, string> = {
  hench: "var(--brand-teal)",
  rex: "var(--brand-purple)",
  sv: "var(--brand-orange)",
  web: "var(--brand-green)",
};

const PKG_LABELS: Record<string, string> = {
  hench: "Hench",
  rex: "Rex",
  sv: "Sourcevision",
  web: "Dashboard",
};

/**
 * Every token a package consumed, cache included.
 *
 * Summing only input + output would leave the largest component of a
 * cache-heavy bill out of the chart while `estimateCost` still charged for it.
 */
function pkgTotal(usage: PackageTokenUsage | undefined): number {
  if (!usage) return 0;
  return (
    usage.inputTokens
    + usage.outputTokens
    + (usage.cacheCreationTokens ?? 0)
    + (usage.cacheReadTokens ?? 0)
  );
}

/** Same sum over the whole-project aggregate. */
function aggregateTotal(usage: AggregateTokenUsage): number {
  return (
    usage.totalInputTokens
    + usage.totalOutputTokens
    + (usage.totalCacheCreationTokens ?? 0)
    + (usage.totalCacheReadTokens ?? 0)
  );
}

/** Sum one field across every package in a breakdown. */
function sumBreakdown(breakdown: ToolBreakdown, field: keyof PackageTokenUsage): number {
  let total = 0;
  for (const pkg of TOKEN_PACKAGES) total += breakdown[pkg]?.[field] ?? 0;
  return total;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Budget status indicator bar. */
function BudgetIndicator({ label, dim }: { label: string; dim: BudgetDimension }) {
  const pct = Math.min(dim.percent, 100);
  const barClass = dim.severity === "exceeded" ? "budget-bar-exceeded"
    : dim.severity === "warning" ? "budget-bar-warning"
    : "budget-bar-ok";

  return h("div", { class: "budget-indicator" },
    h("div", { class: "budget-header" },
      h("span", { class: "budget-label" }, label),
      h("span", { class: `budget-pct budget-${dim.severity}` },
        `${dim.percent.toFixed(0)}%`
      ),
    ),
    h("div", { class: "budget-track" },
      h("div", {
        class: `budget-fill ${barClass}`,
        style: `width: ${pct}%`,
      }),
      dim.severity !== "ok"
        ? h("div", { class: "budget-threshold", style: "left: 80%" })
        : null,
    ),
    h("div", { class: "budget-detail" },
      label === "Tokens"
        ? `${fmtNumber(dim.used)} / ${fmtNumber(dim.budget)}`
        : `$${dim.used.toFixed(2)} / $${dim.budget.toFixed(2)}`
    ),
  );
}

/** Stacked area chart for time period data. */
function PeriodChart({ buckets }: { buckets: PeriodBucket[] }) {
  if (buckets.length === 0) {
    return h("div", { class: "token-empty" }, "No data for the selected period");
  }

  const maxTokens = Math.max(...buckets.map((b) => aggregateTotal(b.usage)), 1);

  const barWidth = Math.max(20, Math.min(60, 600 / buckets.length));
  const chartWidth = Math.max(600, buckets.length * (barWidth + 8) + 80);
  const chartHeight = 220;
  const paddingTop = 20;
  const paddingBottom = 40;
  const barArea = chartHeight - paddingTop - paddingBottom;

  return h("div", { class: "period-chart-container" },
    h("svg", {
      viewBox: `0 0 ${chartWidth} ${chartHeight}`,
      class: "period-chart",
      preserveAspectRatio: "xMinYMin meet",
    },
      // Y-axis labels
      [0, 0.25, 0.5, 0.75, 1].map((frac) => {
        const y = paddingTop + barArea * (1 - frac);
        const val = fmtTokens(maxTokens * frac);
        return h(Fragment, { key: `y-${frac}` },
          h("line", {
            x1: 55,
            x2: chartWidth,
            y1: y,
            y2: y,
            stroke: "var(--border)",
            "stroke-dasharray": "3,3",
            opacity: 0.5,
          }),
          h("text", {
            x: 50,
            y: y + 4,
            "text-anchor": "end",
            class: "chart-axis-label",
          }, val),
        );
      }),
      // Bars, stacked bottom-up in TOKEN_PACKAGES order. Driven by the array
      // rather than one hand-placed rect per package: the offset arithmetic
      // (`baseY - a - b - c`) is where a fourth package silently overlaps a
      // third if a stack is extended by copy-paste.
      buckets.map((bucket, i) => {
        const x = 60 + i * (barWidth + 8);
        const total = aggregateTotal(bucket.usage);
        const baseY = paddingTop + barArea;
        let stacked = 0;

        // Label
        const periodLabel = bucket.period.length > 7
          ? bucket.period.slice(5) // strip year for day/week
          : bucket.period;

        return h("g", { key: bucket.period },
          TOKEN_PACKAGES.map((pkg) => {
            const pkgTokens = pkgTotal(bucket.usage.packages[pkg]);
            const height = (pkgTokens / maxTokens) * barArea;
            if (height <= 0) return null;
            const y = baseY - stacked - height;
            stacked += height;
            return h("rect", {
              key: pkg,
              x,
              y,
              width: barWidth,
              height,
              rx: 2,
              fill: PKG_COLORS[pkg],
              opacity: 0.85,
            },
              h("title", null, `${PKG_LABELS[pkg]}: ${fmtTokens(pkgTokens)} tokens`),
            );
          }),
          // X-axis label
          h("text", {
            x: x + barWidth / 2,
            y: baseY + 16,
            "text-anchor": "middle",
            class: "chart-axis-label",
            transform: buckets.length > 14
              ? `rotate(-45, ${x + barWidth / 2}, ${baseY + 16})`
              : undefined,
          }, periodLabel),
          // Total tooltip
          h("title", null, `${bucket.period}: ${fmtTokens(total)} tokens (${bucket.estimatedCost.total})`),
        );
      }),
    ),
    // Legend
    h("div", { class: "chart-legend" },
      TOKEN_PACKAGES.map((pkg) =>
        h("span", { key: pkg, class: "legend-item" },
          h("span", { class: "legend-dot", style: `background: ${PKG_COLORS[pkg]}` }),
          PKG_LABELS[pkg],
        )
      ),
    ),
  );
}

/** Package breakdown donut. */
function PackageBreakdown({ usage }: { usage: AggregateTokenUsage }) {
  const total = aggregateTotal(usage);
  if (total === 0) return h("div", { class: "token-empty" }, "No token usage recorded");

  const pkgs = TOKEN_PACKAGES
    .map((key) => ({ key, total: pkgTotal(usage.packages[key]) }))
    .filter((p) => p.total > 0);

  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 60;
  const strokeWidth = 20;

  // Calculate arc segments
  let startAngle = -Math.PI / 2;
  const arcs = pkgs.map((pkg) => {
    const fraction = pkg.total / total;
    const endAngle = startAngle + fraction * 2 * Math.PI;
    const largeArc = fraction > 0.5 ? 1 : 0;

    const x1 = cx + radius * Math.cos(startAngle);
    const y1 = cy + radius * Math.sin(startAngle);
    const x2 = cx + radius * Math.cos(endAngle - 0.001); // slight offset to avoid zero-length arc
    const y2 = cy + radius * Math.sin(endAngle - 0.001);

    const d = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`;
    startAngle = endAngle;

    return { ...pkg, d, fraction };
  });

  return h("div", { class: "pkg-breakdown" },
    h("svg", {
      viewBox: `0 0 ${size} ${size}`,
      width: size,
      height: size,
      class: "donut-chart",
    },
      arcs.map((arc) =>
        h("path", {
          key: arc.key,
          d: arc.d,
          fill: "none",
          stroke: PKG_COLORS[arc.key],
          "stroke-width": strokeWidth,
          "stroke-linecap": "round",
        },
          h("title", null, `${PKG_LABELS[arc.key]}: ${fmtTokens(arc.total)} (${(arc.fraction * 100).toFixed(0)}%)`),
        ),
      ),
      // Center text
      h("text", {
        x: cx,
        y: cy - 6,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        class: "donut-total",
      }, fmtTokens(total)),
      h("text", {
        x: cx,
        y: cy + 12,
        "text-anchor": "middle",
        class: "donut-label",
      }, "tokens"),
    ),
    // Package details
    h("div", { class: "pkg-details" },
      pkgs.map((pkg) =>
        h("div", { key: pkg.key, class: "pkg-row" },
          h("span", { class: "legend-dot", style: `background: ${PKG_COLORS[pkg.key]}` }),
          h("span", { class: "pkg-name" }, PKG_LABELS[pkg.key]),
          h("span", { class: "pkg-tokens" }, fmtTokens(pkg.total)),
          h("span", { class: "pkg-pct" }, `${((pkg.total / total) * 100).toFixed(0)}%`),
        ),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Main view
// ---------------------------------------------------------------------------

export function TokenUsageView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<TimePeriod>("day");
  const [since, setSince] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [pkgFilter, setPkgFilter] = useState<string>("all");

  // API data
  const [utilization, setUtilization] = useState<UtilizationResponse | null>(null);
  const [commands, setCommands] = useState<CommandTokenUsage[]>([]);
  const [buckets, setBuckets] = useState<PeriodBucket[]>([]);
  const [budget, setBudget] = useState<BudgetCheckResult | null>(null);
  const [itemRows, setItemRows] = useState<ItemUsageRow[]>([]);
  const [showAllItems, setShowAllItems] = useState(false);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    if (since) params.set("since", new Date(since).toISOString());
    if (until) params.set("until", new Date(until).toISOString());
    params.set("period", period);
    return params;
  }, [since, until, period]);

  const fetchItemRollup = useCallback(async () => {
    try {
      const [taskUsageRes, prdRes] = await Promise.all([
        fetch("/api/hench/task-usage"),
        fetch("/data/prd.json"),
      ]);
      if (!taskUsageRes.ok) return;
      const taskUsageData = await taskUsageRes.json() as { rollup?: Record<string, ItemUsageRollupWire> };
      const rollup = taskUsageData.rollup ?? {};

      const titles = prdRes.ok
        ? flattenPrdTitles(((await prdRes.json()) as { items?: PrdItemNode[] }).items ?? [])
        : new Map<string, { title: string; level: string }>();

      const rows: ItemUsageRow[] = Object.entries(rollup)
        .filter(([, r]) => r.total.totalTokens > 0)
        .map(([id, r]) => ({
          id,
          title: titles.get(id)?.title ?? id,
          level: titles.get(id)?.level ?? "item",
          ...r,
        }))
        .sort((a, b) => b.total.totalTokens - a.total.totalTokens);

      setItemRows(rows);
    } catch {
      // Non-fatal — the rest of the view still renders without per-item data
    }
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/token/utilization?${queryParams.toString()}`);
      if (!res.ok) throw new Error("Failed to fetch utilization data");
      const data = await res.json() as UtilizationResponse;

      setUtilization(data);
      fetchItemRollup();
      setCommands(data.commands ?? []);
      setBudget(data.budget ?? null);
      setBuckets(
        (data.trend ?? []).map((bucket) => {
          const usage: AggregateTokenUsage = {
            packages: bucket.toolBreakdown,
            totalInputTokens: sumBreakdown(bucket.toolBreakdown, "inputTokens"),
            totalOutputTokens: sumBreakdown(bucket.toolBreakdown, "outputTokens"),
            totalCacheCreationTokens: sumBreakdown(bucket.toolBreakdown, "cacheCreationTokens"),
            totalCacheReadTokens: sumBreakdown(bucket.toolBreakdown, "cacheReadTokens"),
            totalCalls: sumBreakdown(bucket.toolBreakdown, "calls"),
          };
          return {
            period: bucket.period,
            usage,
            estimatedCost: bucket.estimatedCost,
          };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [queryParams, fetchItemRollup]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh usage data on a 10-second polling interval.
  // Automatically suspended when the tab is backgrounded via the
  // centralized polling manager.
  usePolling(TOKEN_USAGE_POLL_KEY, fetchData, USAGE_POLL_INTERVAL_MS);

  // Filter commands by package
  const filteredCommands = useMemo(() => {
    if (pkgFilter === "all") return commands;
    return commands.filter((c) => c.package === pkgFilter);
  }, [commands, pkgFilter]);

  // Chart data for command breakdown
  const commandChartData = useMemo(() => {
    return filteredCommands.slice(0, 10).map((c) => ({
      label: `${PKG_LABELS[c.package] ?? c.package}: ${c.command}`,
      value: pkgTotal(c),
      color: PKG_COLORS[c.package] ?? "var(--accent)",
    }));
  }, [filteredCommands]);

  if (loading && !utilization) {
    return h("div", { class: "loading" }, "Loading token usage data...");
  }

  if (error) {
    return h("div", { class: "token-error" },
      h("h3", null, "Error loading token data"),
      h("p", null, error),
      h("button", { class: "btn", onClick: fetchData }, "Retry"),
    );
  }

  const usage = utilization?.usage;
  const cost = utilization?.cost;

  return h("div", { class: "token-usage-container" },
    // Header
    h("div", { class: "token-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", null, "LLM Utilization"),
      h("div", { class: "token-controls" },
        // Date range filters
        h("label", { class: "filter-label" }, "From:",
          h("input", {
            type: "date",
            class: "filter-input",
            value: since,
            onInput: (e: Event) => setSince((e.target as HTMLInputElement).value),
          }),
        ),
        h("label", { class: "filter-label" }, "To:",
          h("input", {
            type: "date",
            class: "filter-input",
            value: until,
            onInput: (e: Event) => setUntil((e.target as HTMLInputElement).value),
          }),
        ),
        // Package filter
        h("label", { class: "filter-label" }, "Package:",
          h("select", {
            class: "filter-input",
            value: pkgFilter,
            onChange: (e: Event) => setPkgFilter((e.target as HTMLSelectElement).value),
          },
            h("option", { value: "all" }, "All"),
            ...TOKEN_PACKAGES.map((pkg) =>
              h("option", { key: pkg, value: pkg }, PKG_LABELS[pkg]),
            ),
          ),
        ),
        since || until
          ? h("button", {
              class: "btn btn-small",
              onClick: () => { setSince(""); setUntil(""); },
            }, "Clear")
          : null,
      ),
    ),

    // Usage metadata
    utilization
      ? h("div", { class: "token-section" },
          h("h3", null, "Usage Source & Window"),
          h("div", { class: "token-source-grid" },
            h("div", { class: "token-source-item" },
              h("span", { class: "cost-label" }, "Configured"),
              h("code", { class: "cost-value" }, `${utilization.configured.vendor}/${utilization.configured.model}`),
            ),
            h("div", { class: "token-source-item" },
              h("span", { class: "cost-label" }, "Window"),
              h("span", { class: "cost-value" }, fmtWindow(utilization.window.since, utilization.window.until)),
            ),
            h("div", { class: "token-source-item" },
              h("span", { class: "cost-label" }, "Rex source"),
              h("code", null, utilization.source.rex),
            ),
            h("div", { class: "token-source-item" },
              h("span", { class: "cost-label" }, "Hench source"),
              h("code", null, utilization.source.hench),
            ),
            h("div", { class: "token-source-item" },
              h("span", { class: "cost-label" }, "Sourcevision source"),
              h("code", null, utilization.source.sourcevision),
            ),
            // Omitted rather than blank when the server predates the ledger:
            // an empty <code> reads as "no source", which is a different claim.
            utilization.source.dashboard
              ? h("div", { class: "token-source-item" },
                  h("span", { class: "cost-label" }, "Dashboard source"),
                  h("code", null, utilization.source.dashboard),
                )
              : null,
          ),
        )
      : null,

    // Budget warnings
    budget && budget.severity !== "ok"
      ? h("div", { class: `budget-alert budget-alert-${budget.severity}` },
          h("strong", null, budget.severity === "exceeded" ? "Budget Exceeded" : "Budget Warning"),
          ...budget.warnings.map((w, i) => h("p", { key: i }, w)),
        )
      : null,

    // Summary metrics row
    usage
      ? h("div", { class: "overview-metrics token-metrics" },
          h(MetricCard, {
            value: fmtTokens(aggregateTotal(usage)),
            label: "Total Tokens",
          }),
          h(MetricCard, {
            value: cost?.total ?? "$0.00",
            label: "Est. Cost",
            color: "var(--brand-green)",
          }),
          h(MetricCard, {
            value: usage.totalCalls,
            label: "API Calls",
            color: "var(--brand-purple)",
          }),
          h(MetricCard, {
            value: fmtTokens(usage.totalInputTokens),
            label: "Input Tokens",
          }),
          h(MetricCard, {
            value: fmtTokens(usage.totalOutputTokens),
            label: "Output Tokens",
          }),
          h(MetricCard, {
            value: fmtTokens(usage.totalCacheCreationTokens ?? 0),
            label: "Cache Write Tokens",
          }),
          h(MetricCard, {
            value: fmtTokens(usage.totalCacheReadTokens ?? 0),
            label: "Cache Read Tokens",
          }),
        )
      : null,

    // Budget indicators
    budget && (budget.tokens || budget.cost)
      ? h("div", { class: "token-section" },
          h("h3", null, "Budget Status"),
          h("div", { class: "budget-indicators" },
            budget.tokens
              ? h(BudgetIndicator, { label: "Tokens", dim: budget.tokens })
              : null,
            budget.cost
              ? h(BudgetIndicator, { label: "Cost", dim: budget.cost })
              : null,
          ),
        )
      : null,

    // Vendor/model totals
    utilization && utilization.byVendorModel.length > 0
      ? h("div", { class: "token-section" },
          h("h3", null, "Totals By Vendor/Model"),
          h("div", { class: "token-table-wrapper" },
            h("table", { class: "token-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "Vendor"),
                  h("th", null, "Model"),
                  h("th", { class: "num" }, "Input Tokens"),
                  h("th", { class: "num" }, "Output Tokens"),
                  h("th", { class: "num" }, "Cache Write"),
                  h("th", { class: "num" }, "Cache Read"),
                  h("th", { class: "num" }, "Total"),
                  h("th", { class: "num" }, "Calls"),
                ),
              ),
              h("tbody", null,
                utilization.byVendorModel.map((row) =>
                  h("tr", { key: `${row.vendor}:${row.model}` },
                    h("td", null, row.vendor),
                    h("td", null, row.model),
                    h("td", { class: "num" }, fmtNumber(row.inputTokens)),
                    h("td", { class: "num" }, fmtNumber(row.outputTokens)),
                    h("td", { class: "num" }, fmtNumber(row.cacheCreationTokens ?? 0)),
                    h("td", { class: "num" }, fmtNumber(row.cacheReadTokens ?? 0)),
                    h("td", { class: "num" }, fmtNumber(pkgTotal(row))),
                    h("td", { class: "num" }, fmtNumber(row.calls)),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,

    // Time period chart
    h("div", { class: "token-section" },
      h("div", { class: "section-header-row" },
        h("h3", null, "Usage Over Time"),
        h("div", { class: "period-toggle" },
          (["day", "week", "month"] as TimePeriod[]).map((p) =>
            h("button", {
              key: p,
              class: `toggle-btn ${period === p ? "active" : ""}`,
              onClick: () => setPeriod(p),
            }, p.charAt(0).toUpperCase() + p.slice(1)),
          ),
        ),
      ),
      h(PeriodChart, { buckets }),
    ),

    // Two-column layout: package breakdown + command breakdown
    h("div", { class: "overview-columns" },
      // Left: Package donut
      usage
        ? h("div", { class: "overview-col" },
            h("h3", null, "By Package"),
            h(PackageBreakdown, { usage }),
          )
        : null,

      // Right: Command breakdown
      commandChartData.length > 0
        ? h("div", { class: "overview-col" },
            h("h3", null, "By Command"),
            h(BarChart, { data: commandChartData }),
          )
        : h("div", { class: "overview-col" },
            h("h3", null, "By Command"),
            h("div", { class: "token-empty" }, "No command data available"),
          ),
    ),

    // Detailed command table
    filteredCommands.length > 0
      ? h("div", { class: "token-section" },
          h("h3", null, "Command Details"),
          h("div", { class: "token-table-wrapper" },
            h("table", { class: "token-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "Package"),
                  h("th", null, "Command"),
                  h("th", { class: "num" }, "Input Tokens"),
                  h("th", { class: "num" }, "Output Tokens"),
                  h("th", { class: "num" }, "Cache Write"),
                  h("th", { class: "num" }, "Cache Read"),
                  h("th", { class: "num" }, "Total"),
                  h("th", { class: "num" }, "Calls"),
                ),
              ),
              h("tbody", null,
                filteredCommands.map((c) =>
                  h("tr", { key: `${c.package}:${c.command}` },
                    h("td", null,
                      h("span", { class: "pkg-badge", style: `background: ${PKG_COLORS[c.package] ?? "var(--accent)"}` },
                        PKG_LABELS[c.package] ?? c.package,
                      ),
                    ),
                    h("td", null, c.command),
                    h("td", { class: "num" }, fmtNumber(c.inputTokens)),
                    h("td", { class: "num" }, fmtNumber(c.outputTokens)),
                    h("td", { class: "num" }, fmtNumber(c.cacheCreationTokens ?? 0)),
                    h("td", { class: "num" }, fmtNumber(c.cacheReadTokens ?? 0)),
                    h("td", { class: "num" }, fmtNumber(pkgTotal(c))),
                    h("td", { class: "num" }, fmtNumber(c.calls)),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,

    // Per-PRD-item rollup (self/descendants/total) — the get_token_usage MCP
    // tool's aggregate view. The tree view shows this per node; this is the
    // whole-project table sorted by total consumption.
    itemRows.length > 0
      ? h("div", { class: "token-section" },
          h("div", { class: "section-header-row" },
            h("h3", null, "Tokens by PRD Item"),
            itemRows.length > 15
              ? h("button", {
                  class: "btn btn-small",
                  onClick: () => setShowAllItems((v) => !v),
                }, showAllItems ? "Show top 15" : `Show all ${itemRows.length}`)
              : null,
          ),
          h("div", { class: "token-table-wrapper" },
            h("table", { class: "token-table" },
              h("thead", null,
                h("tr", null,
                  h("th", null, "Item"),
                  h("th", null, "Level"),
                  h("th", { class: "num" }, "Self"),
                  h("th", { class: "num" }, "Descendants"),
                  h("th", { class: "num" }, "Total"),
                  h("th", { class: "num" }, "Runs"),
                  h("th", { class: "num" }, "Duration"),
                ),
              ),
              h("tbody", null,
                (showAllItems ? itemRows : itemRows.slice(0, 15)).map((row) =>
                  h("tr", { key: row.id },
                    h("td", null, row.title),
                    h("td", null, row.level),
                    h("td", { class: "num" }, fmtTokens(row.self.totalTokens)),
                    h("td", { class: "num" }, fmtTokens(row.descendants.totalTokens)),
                    h("td", { class: "num" }, fmtTokens(row.total.totalTokens)),
                    h("td", { class: "num" }, fmtNumber(row.total.runCount)),
                    h("td", { class: "num" },
                      fmtItemDuration(row.duration.totalMs),
                      row.duration.isRunning ? h("span", { class: "budget-warning" }, " ●") : null,
                    ),
                  ),
                ),
              ),
            ),
          ),
        )
      : null,

    // Cost breakdown
    cost && usage
      ? h("div", { class: "token-section" },
          h("h3", null, "Cost Breakdown"),
          h("div", { class: "cost-breakdown" },
            h("div", { class: "cost-item" },
              h("span", { class: "cost-label" }, "Input tokens"),
              h("span", { class: "cost-value" }, `$${cost.inputCost.toFixed(4)}`),
              h("span", { class: "cost-detail" }, `${fmtNumber(usage.totalInputTokens)} tokens @ $3/M`),
            ),
            h("div", { class: "cost-item" },
              h("span", { class: "cost-label" }, "Output tokens"),
              h("span", { class: "cost-value" }, `$${cost.outputCost.toFixed(4)}`),
              h("span", { class: "cost-detail" }, `${fmtNumber(usage.totalOutputTokens)} tokens @ $15/M`),
            ),
            // Priced by the server all along; the breakdown simply never named
            // them, so the line items did not add up to the total beneath them.
            h("div", { class: "cost-item" },
              h("span", { class: "cost-label" }, "Cache writes"),
              h("span", { class: "cost-value" }, `$${(cost.cacheWriteCost ?? 0).toFixed(4)}`),
              h("span", { class: "cost-detail" }, `${fmtNumber(usage.totalCacheCreationTokens ?? 0)} tokens @ $3.75/M`),
            ),
            h("div", { class: "cost-item" },
              h("span", { class: "cost-label" }, "Cache reads"),
              h("span", { class: "cost-value" }, `$${(cost.cacheReadCost ?? 0).toFixed(4)}`),
              h("span", { class: "cost-detail" }, `${fmtNumber(usage.totalCacheReadTokens ?? 0)} tokens @ $0.30/M`),
            ),
            h("div", { class: "cost-item cost-total" },
              h("span", { class: "cost-label" }, "Total estimated"),
              h("span", { class: "cost-value" }, cost.total),
            ),
          ),
        )
      : null,

    // Loading overlay for refresh
    loading ? h("div", { class: "token-loading-overlay" }, "Refreshing...") : null,
  );
}
