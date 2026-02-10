/**
 * Token Usage Analytics dashboard view.
 *
 * Shows token consumption across packages (rex, hench, sourcevision),
 * grouped by command and time period, with budget status indicators
 * and trend visualization.
 */

import { h, Fragment } from "preact";
import { useState, useEffect, useMemo, useCallback } from "preact/hooks";
import { MetricCard } from "../components/data-display/health-gauge.js";
import { BarChart } from "../components/data-display/mini-charts.js";
import { BrandedHeader } from "../components/logos.js";

// ---------------------------------------------------------------------------
// Types (mirroring API response shapes)
// ---------------------------------------------------------------------------

interface PackageTokenUsage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

interface AggregateTokenUsage {
  packages: {
    rex: PackageTokenUsage;
    hench: PackageTokenUsage;
    sv: PackageTokenUsage;
  };
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

interface CostEstimate {
  total: string;
  totalRaw: number;
  inputCost: number;
  outputCost: number;
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

const PKG_COLORS: Record<string, string> = {
  hench: "var(--brand-teal)",
  rex: "var(--brand-purple)",
  sv: "var(--brand-orange)",
};

const PKG_LABELS: Record<string, string> = {
  hench: "Hench",
  rex: "Rex",
  sv: "Sourcevision",
};

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

  const maxTokens = Math.max(
    ...buckets.map((b) => b.usage.totalInputTokens + b.usage.totalOutputTokens),
    1,
  );

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
      // Bars (stacked: hench, rex, sv)
      buckets.map((bucket, i) => {
        const x = 60 + i * (barWidth + 8);
        const total = bucket.usage.totalInputTokens + bucket.usage.totalOutputTokens;
        const henchTotal = bucket.usage.packages.hench.inputTokens + bucket.usage.packages.hench.outputTokens;
        const rexTotal = bucket.usage.packages.rex.inputTokens + bucket.usage.packages.rex.outputTokens;
        const svTotal = bucket.usage.packages.sv.inputTokens + bucket.usage.packages.sv.outputTokens;

        const henchH = (henchTotal / maxTokens) * barArea;
        const rexH = (rexTotal / maxTokens) * barArea;
        const svH = (svTotal / maxTokens) * barArea;

        const baseY = paddingTop + barArea;

        // Label
        const periodLabel = bucket.period.length > 7
          ? bucket.period.slice(5) // strip year for day/week
          : bucket.period;

        return h("g", { key: bucket.period },
          // Hench bar (bottom)
          henchH > 0
            ? h("rect", {
                x,
                y: baseY - henchH,
                width: barWidth,
                height: henchH,
                rx: 2,
                fill: PKG_COLORS.hench,
                opacity: 0.85,
              },
                h("title", null, `Hench: ${fmtTokens(henchTotal)} tokens`),
              )
            : null,
          // Rex bar (middle)
          rexH > 0
            ? h("rect", {
                x,
                y: baseY - henchH - rexH,
                width: barWidth,
                height: rexH,
                rx: 2,
                fill: PKG_COLORS.rex,
                opacity: 0.85,
              },
                h("title", null, `Rex: ${fmtTokens(rexTotal)} tokens`),
              )
            : null,
          // SV bar (top)
          svH > 0
            ? h("rect", {
                x,
                y: baseY - henchH - rexH - svH,
                width: barWidth,
                height: svH,
                rx: 2,
                fill: PKG_COLORS.sv,
                opacity: 0.85,
              },
                h("title", null, `SV: ${fmtTokens(svTotal)} tokens`),
              )
            : null,
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
      (["hench", "rex", "sv"] as const).map((pkg) =>
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
  const total = usage.totalInputTokens + usage.totalOutputTokens;
  if (total === 0) return h("div", { class: "token-empty" }, "No token usage recorded");

  const pkgs = [
    { key: "hench" as const, total: usage.packages.hench.inputTokens + usage.packages.hench.outputTokens },
    { key: "rex" as const, total: usage.packages.rex.inputTokens + usage.packages.rex.outputTokens },
    { key: "sv" as const, total: usage.packages.sv.inputTokens + usage.packages.sv.outputTokens },
  ].filter((p) => p.total > 0);

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
  const [summary, setSummary] = useState<{ usage: AggregateTokenUsage; cost: CostEstimate; eventCount: number } | null>(null);
  const [commands, setCommands] = useState<CommandTokenUsage[]>([]);
  const [buckets, setBuckets] = useState<PeriodBucket[]>([]);
  const [budget, setBudget] = useState<BudgetCheckResult | null>(null);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (since) params.set("since", new Date(since).toISOString());
    if (until) params.set("until", new Date(until).toISOString());
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  }, [since, until]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryRes, commandsRes, bucketsRes, budgetRes] = await Promise.all([
        fetch(`/api/token/summary${queryString}`),
        fetch(`/api/token/by-command${queryString}`),
        fetch(`/api/token/by-period${queryString}&period=${period}`),
        fetch(`/api/token/budget${queryString}`),
      ]);

      if (!summaryRes.ok) throw new Error("Failed to fetch summary");

      const [summaryData, commandsData, bucketsData, budgetData] = await Promise.all([
        summaryRes.json(),
        commandsRes.json(),
        bucketsRes.json(),
        budgetRes.json(),
      ]);

      setSummary(summaryData);
      setCommands(commandsData.commands ?? []);
      setBuckets(bucketsData.buckets ?? []);
      setBudget(budgetData.budget ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [queryString, period]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter commands by package
  const filteredCommands = useMemo(() => {
    if (pkgFilter === "all") return commands;
    return commands.filter((c) => c.package === pkgFilter);
  }, [commands, pkgFilter]);

  // Chart data for command breakdown
  const commandChartData = useMemo(() => {
    return filteredCommands.slice(0, 10).map((c) => ({
      label: `${PKG_LABELS[c.package] ?? c.package}: ${c.command}`,
      value: c.inputTokens + c.outputTokens,
      color: PKG_COLORS[c.package] ?? "var(--accent)",
    }));
  }, [filteredCommands]);

  if (loading && !summary) {
    return h("div", { class: "loading" }, "Loading token usage data...");
  }

  if (error) {
    return h("div", { class: "token-error" },
      h("h3", null, "Error loading token data"),
      h("p", null, error),
      h("button", { class: "btn", onClick: fetchData }, "Retry"),
    );
  }

  const usage = summary?.usage;
  const cost = summary?.cost;

  return h("div", { class: "token-usage-container" },
    // Header
    h("div", { class: "token-header" },
      h(BrandedHeader, { product: "rex", title: "Rex", class: "branded-header-rex" }),
      h("h2", null, "Token Usage"),
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
            h("option", { value: "hench" }, "Hench"),
            h("option", { value: "rex" }, "Rex"),
            h("option", { value: "sv" }, "Sourcevision"),
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
            value: fmtTokens(usage.totalInputTokens + usage.totalOutputTokens),
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
                  h("th", { class: "num" }, "Total"),
                  h("th", { class: "num" }, "Calls"),
                ),
              ),
              h("tbody", null,
                filteredCommands.map((c) => {
                  const total = c.inputTokens + c.outputTokens;
                  return h("tr", { key: `${c.package}:${c.command}` },
                    h("td", null,
                      h("span", { class: "pkg-badge", style: `background: ${PKG_COLORS[c.package] ?? "var(--accent)"}` },
                        PKG_LABELS[c.package] ?? c.package,
                      ),
                    ),
                    h("td", null, c.command),
                    h("td", { class: "num" }, fmtNumber(c.inputTokens)),
                    h("td", { class: "num" }, fmtNumber(c.outputTokens)),
                    h("td", { class: "num" }, fmtNumber(total)),
                    h("td", { class: "num" }, fmtNumber(c.calls)),
                  );
                }),
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
