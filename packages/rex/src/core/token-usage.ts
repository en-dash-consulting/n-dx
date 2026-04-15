/**
 * Token usage aggregation across all n-dx packages.
 *
 * Reads token data from:
 * - Rex execution log (`analyze_token_usage` events in .rex/execution-log.jsonl)
 * - Hench run records (.hench/runs/*.json)
 * - Sourcevision manifest (.sourcevision/manifest.json `tokenUsage` field)
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_DIRS } from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Aggregated token usage for a single package. */
export interface PackageTokenUsage {
  /** Total input tokens. */
  inputTokens: number;
  /** Total output tokens. */
  outputTokens: number;
  /** Number of LLM calls. */
  calls: number;
}

/** Combined token usage across all packages. */
export interface AggregateTokenUsage {
  /** Per-package breakdown. */
  packages: {
    rex: PackageTokenUsage;
    hench: PackageTokenUsage;
    sv: PackageTokenUsage;
  };
  /** Total tokens across all packages. */
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCalls: number;
}

/** Time-based filter options for token usage queries. */
export interface TokenUsageFilter {
  /** Only include usage on or after this ISO timestamp. */
  since?: string;
  /** Only include usage on or before this ISO timestamp. */
  until?: string;
}

/** Token usage for a single command. */
export interface CommandTokenUsage extends PackageTokenUsage {
  /** Command name (e.g. "analyze", "run", "smart-add"). */
  command: string;
  /** Package this command belongs to. */
  package: "rex" | "hench" | "sv";
}

/** Valid time period groupings. */
export type TimePeriod = "day" | "week" | "month";

/** Token usage for a single time bucket. */
export interface PeriodBucket {
  /** Period label (e.g. "2026-01-15", "2026-W03", "2026-01"). */
  period: string;
  /** Aggregate usage for this period. */
  usage: AggregateTokenUsage;
  /** Estimated cost for this period. */
  estimatedCost: CostEstimate;
}

/** Minimal rex execution-log entry shape used by token analytics. */
export interface TokenUsageLogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptyPackageUsage(): PackageTokenUsage {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

function isInRange(timestamp: string, filter: TokenUsageFilter): boolean {
  if (filter.since && timestamp < filter.since) return false;
  if (filter.until && timestamp > filter.until) return false;
  return true;
}

function normalizeEventMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ---------------------------------------------------------------------------
// Rex token usage from execution log
// ---------------------------------------------------------------------------

/**
 * Extract rex token usage from execution log entries.
 *
 * Looks for `analyze_token_usage` events whose `detail` field
 * contains JSON-serialized AnalyzeTokenUsage data.
 */
export function extractRexTokenUsage(
  logEntries: TokenUsageLogEntry[],
  filter: TokenUsageFilter = {},
): PackageTokenUsage {
  const usage = emptyPackageUsage();

  for (const entry of logEntries) {
    if (entry.event !== "analyze_token_usage") continue;
    if (!entry.detail) continue;
    if (!isInRange(entry.timestamp, filter)) continue;

    try {
      const data = JSON.parse(entry.detail) as {
        calls?: number;
        inputTokens?: number;
        outputTokens?: number;
      };
      if (typeof data.calls === "number") usage.calls += data.calls;
      if (typeof data.inputTokens === "number") usage.inputTokens += data.inputTokens;
      if (typeof data.outputTokens === "number") usage.outputTokens += data.outputTokens;
    } catch {
      // Malformed detail — skip
    }
  }

  return usage;
}

// ---------------------------------------------------------------------------
// Hench token usage from run records
// ---------------------------------------------------------------------------

/** Timestamped token event used internally for grouping and command breakdown. */
export interface TokenEvent {
  timestamp: string;
  command: string;
  package: "rex" | "hench" | "sv";
  inputTokens: number;
  outputTokens: number;
  calls: number;
  vendor?: string;
  model?: string;
}

/** Minimal shape of a hench RunRecord for token extraction. */
interface HenchRunSummary {
  startedAt: string;
  model?: string;
  tokenUsage: { input: number; output: number };
  turnTokenUsage?: Array<{
    input: number;
    output: number;
    vendor?: string;
    model?: string;
  }>;
}

/**
 * Read hench run files and aggregate token usage.
 *
 * Reads `.hench/runs/*.json` files directly to avoid coupling to the
 * hench package's internal modules.
 */
export async function extractHenchTokenUsage(
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<PackageTokenUsage> {
  const usage = emptyPackageUsage();
  const runsDir = join(projectDir, PROJECT_DIRS.HENCH, "runs");

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return usage;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(runsDir, file), "utf-8");
      const run = JSON.parse(raw) as HenchRunSummary;

      if (!run.startedAt || !run.tokenUsage) continue;
      if (!isInRange(run.startedAt, filter)) continue;

      usage.calls += 1; // Each run counts as one aggregate call
      usage.inputTokens += run.tokenUsage.input ?? 0;
      usage.outputTokens += run.tokenUsage.output ?? 0;
    } catch {
      // Invalid run file — skip
    }
  }

  return usage;
}

// ---------------------------------------------------------------------------
// Sourcevision token usage from manifest
// ---------------------------------------------------------------------------

/** Minimal shape of a sourcevision manifest for token extraction. */
interface SvManifest {
  analyzedAt?: string;
  tokenUsage?: {
    calls?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Read sourcevision manifest and extract token usage.
 *
 * Reads `.sourcevision/manifest.json` and extracts the `tokenUsage` field
 * that is persisted after each analyze run.
 */
export async function extractSvTokenUsage(
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<PackageTokenUsage> {
  const usage = emptyPackageUsage();
  const manifestPath = join(projectDir, PROJECT_DIRS.SOURCEVISION, "manifest.json");

  try {
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as SvManifest;

    if (!manifest.tokenUsage) return usage;
    if (manifest.analyzedAt && !isInRange(manifest.analyzedAt, filter)) return usage;

    usage.calls += manifest.tokenUsage.calls ?? 0;
    usage.inputTokens += manifest.tokenUsage.inputTokens ?? 0;
    usage.outputTokens += manifest.tokenUsage.outputTokens ?? 0;
  } catch {
    // Missing or invalid manifest — skip
  }

  return usage;
}

// ---------------------------------------------------------------------------
// Token event extraction (for command and time-period breakdown)
// ---------------------------------------------------------------------------

/**
 * Extract individual token events from the rex execution log.
 * Maps event types to their originating commands.
 */
export function extractRexTokenEvents(
  logEntries: TokenUsageLogEntry[],
  filter: TokenUsageFilter = {},
): TokenEvent[] {
  const events: TokenEvent[] = [];

  /** Map log event types to human-readable command names. */
  const EVENT_COMMAND_MAP: Record<string, string> = {
    analyze_token_usage: "analyze",
    smart_add_token_usage: "smart-add",
  };

  for (const entry of logEntries) {
    const command = EVENT_COMMAND_MAP[entry.event];
    if (!command) continue;
    if (!entry.detail) continue;
    if (!isInRange(entry.timestamp, filter)) continue;

    try {
      const data = JSON.parse(entry.detail) as {
        calls?: number;
        inputTokens?: number;
        outputTokens?: number;
        vendor?: string;
        model?: string;
      };
      events.push({
        timestamp: entry.timestamp,
        command,
        package: "rex",
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        calls: data.calls ?? 0,
        vendor: normalizeEventMetadata(data.vendor) ?? "unknown",
        model: normalizeEventMetadata(data.model) ?? "unknown",
      });
    } catch {
      // Malformed detail — skip
    }
  }

  return events;
}

/**
 * Extract individual token events from hench run records.
 * Each run becomes a single event attributed to the "run" command.
 */
export async function extractHenchTokenEvents(
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<TokenEvent[]> {
  const events: TokenEvent[] = [];
  const runsDir = join(projectDir, PROJECT_DIRS.HENCH, "runs");

  let files: string[];
  try {
    files = await readdir(runsDir);
  } catch {
    return events;
  }

  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  for (const file of jsonFiles) {
    try {
      const raw = await readFile(join(runsDir, file), "utf-8");
      const run = JSON.parse(raw) as HenchRunSummary;

      if (!run.startedAt || !run.tokenUsage) continue;
      if (!isInRange(run.startedAt, filter)) continue;

      if (Array.isArray(run.turnTokenUsage) && run.turnTokenUsage.length > 0) {
        for (const turn of run.turnTokenUsage) {
          events.push({
            timestamp: run.startedAt,
            command: "run",
            package: "hench",
            inputTokens: turn.input ?? 0,
            outputTokens: turn.output ?? 0,
            calls: 1,
            vendor: turn.vendor,
            model: turn.model ?? run.model,
          });
        }
        continue;
      }

      events.push({
        timestamp: run.startedAt,
        command: "run",
        package: "hench",
        inputTokens: run.tokenUsage.input ?? 0,
        outputTokens: run.tokenUsage.output ?? 0,
        calls: 1,
        model: run.model,
      });
    } catch {
      // Invalid run file — skip
    }
  }

  return events;
}

/**
 * Extract token events from sourcevision manifest.
 * The manifest represents a single "analyze" event.
 */
export async function extractSvTokenEvents(
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<TokenEvent[]> {
  const events: TokenEvent[] = [];
  const manifestPath = join(projectDir, PROJECT_DIRS.SOURCEVISION, "manifest.json");

  try {
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as SvManifest;

    if (!manifest.tokenUsage) return events;
    if (manifest.analyzedAt && !isInRange(manifest.analyzedAt, filter)) return events;

    events.push({
      timestamp: manifest.analyzedAt ?? new Date().toISOString(),
      command: "analyze",
      package: "sv",
      inputTokens: manifest.tokenUsage.inputTokens ?? 0,
      outputTokens: manifest.tokenUsage.outputTokens ?? 0,
      calls: manifest.tokenUsage.calls ?? 0,
    });
  } catch {
    // Missing or invalid manifest — skip
  }

  return events;
}

/**
 * Collect all token events across all packages.
 */
export async function collectTokenEvents(
  logEntries: TokenUsageLogEntry[],
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<TokenEvent[]> {
  const rexEvents = extractRexTokenEvents(logEntries, filter);
  const [henchEvents, svEvents] = await Promise.all([
    extractHenchTokenEvents(projectDir, filter),
    extractSvTokenEvents(projectDir, filter),
  ]);

  return [...rexEvents, ...henchEvents, ...svEvents].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp),
  );
}

// ---------------------------------------------------------------------------
// Command breakdown
// ---------------------------------------------------------------------------

/**
 * Group token events by command, producing per-command usage summaries.
 */
export function groupByCommand(events: TokenEvent[]): CommandTokenUsage[] {
  const map = new Map<string, CommandTokenUsage>();

  for (const ev of events) {
    const key = `${ev.package}:${ev.command}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {
        command: ev.command,
        package: ev.package,
        inputTokens: 0,
        outputTokens: 0,
        calls: 0,
      };
      map.set(key, entry);
    }
    entry.inputTokens += ev.inputTokens;
    entry.outputTokens += ev.outputTokens;
    entry.calls += ev.calls;
  }

  // Sort by total tokens descending
  return Array.from(map.values()).sort(
    (a, b) =>
      b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens),
  );
}

// ---------------------------------------------------------------------------
// Time period grouping
// ---------------------------------------------------------------------------

/**
 * Get the period key for a timestamp.
 * - day:   "2026-01-15"
 * - week:  "2026-W03"
 * - month: "2026-01"
 */
export function periodKey(timestamp: string, period: TimePeriod): string {
  const date = new Date(timestamp);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  switch (period) {
    case "day":
      return `${year}-${month}-${day}`;
    case "month":
      return `${year}-${month}`;
    case "week": {
      // ISO week number
      const d = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(
        ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
      );
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
  }
}

/**
 * Group token events into time-period buckets.
 */
export function groupByTimePeriod(
  events: TokenEvent[],
  period: TimePeriod,
): PeriodBucket[] {
  const buckets = new Map<string, TokenEvent[]>();

  for (const ev of events) {
    const key = periodKey(ev.timestamp, period);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = [];
      buckets.set(key, bucket);
    }
    bucket.push(ev);
  }

  // Build AggregateTokenUsage per bucket
  const result: PeriodBucket[] = [];
  for (const [key, evts] of buckets) {
    const usage = eventsToAggregate(evts);
    result.push({
      period: key,
      usage,
      estimatedCost: estimateCost(usage),
    });
  }

  // Sort by period ascending
  result.sort((a, b) => a.period.localeCompare(b.period));
  return result;
}

/**
 * Convert a list of token events into an AggregateTokenUsage.
 */
function eventsToAggregate(events: TokenEvent[]): AggregateTokenUsage {
  const rex = emptyPackageUsage();
  const hench = emptyPackageUsage();
  const sv = emptyPackageUsage();

  for (const ev of events) {
    const pkg = ev.package === "rex" ? rex : ev.package === "hench" ? hench : sv;
    pkg.inputTokens += ev.inputTokens;
    pkg.outputTokens += ev.outputTokens;
    pkg.calls += ev.calls;
  }

  return {
    packages: { rex, hench, sv },
    totalInputTokens: rex.inputTokens + hench.inputTokens + sv.inputTokens,
    totalOutputTokens: rex.outputTokens + hench.outputTokens + sv.outputTokens,
    totalCalls: rex.calls + hench.calls + sv.calls,
  };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

/**
 * Aggregate token usage across all packages.
 *
 * @param logEntries Rex execution log entries (from store.readLog())
 * @param projectDir Project root directory (for reading hench runs and sv manifest)
 * @param filter Optional time-based filter
 */
export async function aggregateTokenUsage(
  logEntries: TokenUsageLogEntry[],
  projectDir: string,
  filter: TokenUsageFilter = {},
): Promise<AggregateTokenUsage> {
  const rex = extractRexTokenUsage(logEntries, filter);
  const [hench, sv] = await Promise.all([
    extractHenchTokenUsage(projectDir, filter),
    extractSvTokenUsage(projectDir, filter),
  ]);

  return {
    packages: { rex, hench, sv },
    totalInputTokens: rex.inputTokens + hench.inputTokens + sv.inputTokens,
    totalOutputTokens: rex.outputTokens + hench.outputTokens + sv.outputTokens,
    totalCalls: rex.calls + hench.calls + sv.calls,
  };
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/** Per-million-token pricing for a model. */
export interface ModelPricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Default pricing uses Claude Sonnet rates since that's the primary model
 * across all packages. This gives a reasonable ballpark even when exact
 * model info isn't available per-call.
 */
const DEFAULT_PRICING: ModelPricing = {
  inputPerMillion: 3, // $3 per 1M input tokens
  outputPerMillion: 15, // $15 per 1M output tokens
};

/** Estimated cost breakdown. */
export interface CostEstimate {
  /** Formatted total cost string (e.g. "$1.23"). */
  total: string;
  /** Raw numeric total in USD. */
  totalRaw: number;
  /** Cost from input tokens. */
  inputCost: number;
  /** Cost from output tokens. */
  outputCost: number;
}

/**
 * Estimate cost from aggregate token usage.
 *
 * Uses default Sonnet pricing as a baseline. Cost is approximate since
 * individual calls may use different models or benefit from prompt caching.
 */
export function estimateCost(
  usage: AggregateTokenUsage,
  pricing: ModelPricing = DEFAULT_PRICING,
): CostEstimate {
  const inputCost = (usage.totalInputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (usage.totalOutputTokens / 1_000_000) * pricing.outputPerMillion;
  const totalRaw = inputCost + outputCost;

  return {
    total: `$${totalRaw.toFixed(2)}`,
    totalRaw,
    inputCost,
    outputCost,
  };
}

// ---------------------------------------------------------------------------
// Budget checking
// ---------------------------------------------------------------------------

/** Format a number with locale-aware commas (used in budget warning messages). */
function fmt(n: number): string {
  return n.toLocaleString();
}

/** Configurable budget thresholds. */
export interface BudgetConfig {
  /** Maximum total tokens (input + output). 0 = unlimited. */
  tokens?: number;
  /** Maximum estimated cost in USD. 0 = unlimited. */
  cost?: number;
  /**
   * Warning threshold as a percentage (0–100).
   * Warn when usage reaches this percentage of the budget.
   * Default: 80.
   */
  warnAt?: number;
}

/** Severity level for budget status. */
export type BudgetSeverity = "ok" | "warning" | "exceeded";

/** Result of checking usage against a budget. */
export interface BudgetCheckResult {
  /** Overall severity: "ok", "warning", or "exceeded". */
  severity: BudgetSeverity;
  /** Token budget status (if a token budget is configured). */
  tokens?: {
    used: number;
    budget: number;
    percent: number;
    severity: BudgetSeverity;
  };
  /** Cost budget status (if a cost budget is configured). */
  cost?: {
    used: number;
    budget: number;
    percent: number;
    severity: BudgetSeverity;
  };
  /** Human-readable warning messages (empty when severity is "ok"). */
  warnings: string[];
}

/**
 * Check aggregate token usage against budget thresholds.
 *
 * Returns a result with severity, per-dimension status, and warning messages.
 * A budget value of 0, undefined, or negative means unlimited (always passes).
 */
export function checkBudget(
  usage: AggregateTokenUsage,
  budget: BudgetConfig,
  pricing: ModelPricing = DEFAULT_PRICING,
): BudgetCheckResult {
  const warnAt = budget.warnAt ?? 80;
  const warnings: string[] = [];

  let tokenStatus: BudgetCheckResult["tokens"];
  let costStatus: BudgetCheckResult["cost"];

  function dimCheck(used: number, limit: number): { percent: number; severity: BudgetSeverity } {
    const percent = (used / limit) * 100;
    const severity: BudgetSeverity =
      percent >= 100 ? "exceeded" : percent >= warnAt ? "warning" : "ok";
    return { percent, severity };
  }

  // Token budget check
  if (budget.tokens && budget.tokens > 0) {
    const used = usage.totalInputTokens + usage.totalOutputTokens;
    const { percent, severity } = dimCheck(used, budget.tokens);

    tokenStatus = { used, budget: budget.tokens, percent, severity };

    if (severity === "exceeded") {
      warnings.push(
        `Token budget exceeded: ${fmt(used)} of ${fmt(budget.tokens)} tokens used (${percent.toFixed(0)}%)`,
      );
    } else if (severity === "warning") {
      warnings.push(
        `Approaching token budget: ${fmt(used)} of ${fmt(budget.tokens)} tokens used (${percent.toFixed(0)}%)`,
      );
    }
  }

  // Cost budget check
  if (budget.cost && budget.cost > 0) {
    const costEstimate = estimateCost(usage, pricing);
    const used = costEstimate.totalRaw;
    const { percent, severity } = dimCheck(used, budget.cost);

    costStatus = { used, budget: budget.cost, percent, severity };

    if (severity === "exceeded") {
      warnings.push(
        `Cost budget exceeded: $${used.toFixed(2)} of $${budget.cost.toFixed(2)} used (${percent.toFixed(0)}%)`,
      );
    } else if (severity === "warning") {
      warnings.push(
        `Approaching cost budget: $${used.toFixed(2)} of $${budget.cost.toFixed(2)} used (${percent.toFixed(0)}%)`,
      );
    }
  }

  // Overall severity is the worst of all dimensions
  const severity: BudgetSeverity =
    [tokenStatus?.severity, costStatus?.severity].includes("exceeded")
      ? "exceeded"
      : [tokenStatus?.severity, costStatus?.severity].includes("warning")
        ? "warning"
        : "ok";

  return { severity, tokens: tokenStatus, cost: costStatus, warnings };
}
