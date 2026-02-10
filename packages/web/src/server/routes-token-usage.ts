/**
 * Token usage analytics API routes.
 *
 * Aggregates token consumption data from all n-dx packages
 * (rex, hench, sourcevision) and serves it for the dashboard.
 *
 * All endpoints are under /api/token/.
 *
 * GET /api/token/summary         — aggregate usage with per-package breakdown
 * GET /api/token/events           — individual token events (with optional filters)
 * GET /api/token/by-command       — usage grouped by command
 * GET /api/token/by-period        — usage grouped by time period
 * GET /api/token/budget           — budget status check
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse } from "./types.js";

// ---------------------------------------------------------------------------
// Types (mirrors rex/core/token-usage but kept local to avoid cross-package import)
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

interface TokenEvent {
  timestamp: string;
  command: string;
  package: "rex" | "hench" | "sv";
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

interface CostEstimate {
  total: string;
  totalRaw: number;
  inputCost: number;
  outputCost: number;
}

type TimePeriod = "day" | "week" | "month";
type BudgetSeverity = "ok" | "warning" | "exceeded";

interface BudgetCheckResult {
  severity: BudgetSeverity;
  tokens?: { used: number; budget: number; percent: number; severity: BudgetSeverity };
  cost?: { used: number; budget: number; percent: number; severity: BudgetSeverity };
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TOKEN_PREFIX = "/api/token/";

function emptyPackageUsage(): PackageTokenUsage {
  return { inputTokens: 0, outputTokens: 0, calls: 0 };
}

function isInRange(timestamp: string, since?: string, until?: string): boolean {
  if (since && timestamp < since) return false;
  if (until && timestamp > until) return false;
  return true;
}

/** Default Sonnet pricing. */
const DEFAULT_PRICING = {
  inputPerMillion: 3,
  outputPerMillion: 15,
};

function estimateCost(usage: AggregateTokenUsage): CostEstimate {
  const inputCost = (usage.totalInputTokens / 1_000_000) * DEFAULT_PRICING.inputPerMillion;
  const outputCost = (usage.totalOutputTokens / 1_000_000) * DEFAULT_PRICING.outputPerMillion;
  const totalRaw = inputCost + outputCost;
  return { total: `$${totalRaw.toFixed(2)}`, totalRaw, inputCost, outputCost };
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

interface LogEntry {
  timestamp: string;
  event: string;
  detail?: string;
}

function readLogEntries(rexDir: string): LogEntry[] {
  const logPath = join(rexDir, "execution-log.jsonl");
  if (!existsSync(logPath)) return [];
  try {
    const raw = readFileSync(logPath, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as LogEntry; } catch { return null; }
      })
      .filter((e): e is LogEntry => e !== null);
  } catch {
    return [];
  }
}

const EVENT_COMMAND_MAP: Record<string, string> = {
  analyze_token_usage: "analyze",
  smart_add_token_usage: "smart-add",
};

function extractRexEvents(logEntries: LogEntry[], since?: string, until?: string): TokenEvent[] {
  const events: TokenEvent[] = [];
  for (const entry of logEntries) {
    const command = EVENT_COMMAND_MAP[entry.event];
    if (!command || !entry.detail) continue;
    if (!isInRange(entry.timestamp, since, until)) continue;
    try {
      const data = JSON.parse(entry.detail) as {
        calls?: number;
        inputTokens?: number;
        outputTokens?: number;
      };
      events.push({
        timestamp: entry.timestamp,
        command,
        package: "rex",
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        calls: data.calls ?? 0,
      });
    } catch { /* skip */ }
  }
  return events;
}

interface HenchRunSummary {
  startedAt: string;
  tokenUsage: { input: number; output: number };
}

function extractHenchEvents(projectDir: string, since?: string, until?: string): TokenEvent[] {
  const events: TokenEvent[] = [];
  const runsDir = join(projectDir, ".hench", "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return events;
  }
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = readFileSync(join(runsDir, file), "utf-8");
      const run = JSON.parse(raw) as HenchRunSummary;
      if (!run.startedAt || !run.tokenUsage) continue;
      if (!isInRange(run.startedAt, since, until)) continue;
      events.push({
        timestamp: run.startedAt,
        command: "run",
        package: "hench",
        inputTokens: run.tokenUsage.input ?? 0,
        outputTokens: run.tokenUsage.output ?? 0,
        calls: 1,
      });
    } catch { /* skip */ }
  }
  return events;
}

interface SvManifest {
  analyzedAt?: string;
  tokenUsage?: { calls?: number; inputTokens?: number; outputTokens?: number };
}

function extractSvEvents(projectDir: string, since?: string, until?: string): TokenEvent[] {
  const events: TokenEvent[] = [];
  const manifestPath = join(projectDir, ".sourcevision", "manifest.json");
  try {
    const raw = readFileSync(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as SvManifest;
    if (!manifest.tokenUsage) return events;
    if (manifest.analyzedAt && !isInRange(manifest.analyzedAt, since, until)) return events;
    events.push({
      timestamp: manifest.analyzedAt ?? new Date().toISOString(),
      command: "analyze",
      package: "sv",
      inputTokens: manifest.tokenUsage.inputTokens ?? 0,
      outputTokens: manifest.tokenUsage.outputTokens ?? 0,
      calls: manifest.tokenUsage.calls ?? 0,
    });
  } catch { /* skip */ }
  return events;
}

function collectAllEvents(ctx: ServerContext, since?: string, until?: string): TokenEvent[] {
  const logEntries = readLogEntries(ctx.rexDir);
  const rexEvents = extractRexEvents(logEntries, since, until);
  const henchEvents = extractHenchEvents(ctx.projectDir, since, until);
  const svEvents = extractSvEvents(ctx.projectDir, since, until);
  return [...rexEvents, ...henchEvents, ...svEvents].sort(
    (a, b) => a.timestamp.localeCompare(b.timestamp),
  );
}

// ---------------------------------------------------------------------------
// Aggregation functions
// ---------------------------------------------------------------------------

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

interface CommandTokenUsage extends PackageTokenUsage {
  command: string;
  package: "rex" | "hench" | "sv";
}

function groupByCommand(events: TokenEvent[]): CommandTokenUsage[] {
  const map = new Map<string, CommandTokenUsage>();
  for (const ev of events) {
    const key = `${ev.package}:${ev.command}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { command: ev.command, package: ev.package, inputTokens: 0, outputTokens: 0, calls: 0 };
      map.set(key, entry);
    }
    entry.inputTokens += ev.inputTokens;
    entry.outputTokens += ev.outputTokens;
    entry.calls += ev.calls;
  }
  return Array.from(map.values()).sort(
    (a, b) => (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens),
  );
}

function periodKey(timestamp: string, period: TimePeriod): string {
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
      const d = new Date(Date.UTC(year, date.getUTCMonth(), date.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
      return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
    }
  }
}

interface PeriodBucket {
  period: string;
  usage: AggregateTokenUsage;
  estimatedCost: CostEstimate;
}

function groupByTimePeriod(events: TokenEvent[], period: TimePeriod): PeriodBucket[] {
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

  const result: PeriodBucket[] = [];
  for (const [key, evts] of buckets) {
    const usage = eventsToAggregate(evts);
    result.push({ period: key, usage, estimatedCost: estimateCost(usage) });
  }
  result.sort((a, b) => a.period.localeCompare(b.period));
  return result;
}

// ---------------------------------------------------------------------------
// Budget checking
// ---------------------------------------------------------------------------

interface RexConfig {
  budget?: {
    tokens?: number;
    cost?: number;
    warnAt?: number;
  };
}

function loadRexConfig(rexDir: string): RexConfig | null {
  const configPath = join(rexDir, "config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as RexConfig;
  } catch {
    return null;
  }
}

function checkBudget(usage: AggregateTokenUsage, budget: RexConfig["budget"]): BudgetCheckResult {
  if (!budget) return { severity: "ok", warnings: [] };

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

  if (budget.tokens && budget.tokens > 0) {
    const used = usage.totalInputTokens + usage.totalOutputTokens;
    const { percent, severity } = dimCheck(used, budget.tokens);
    tokenStatus = { used, budget: budget.tokens, percent, severity };
    if (severity === "exceeded") {
      warnings.push(`Token budget exceeded: ${used.toLocaleString()} of ${budget.tokens.toLocaleString()} (${percent.toFixed(0)}%)`);
    } else if (severity === "warning") {
      warnings.push(`Approaching token budget: ${used.toLocaleString()} of ${budget.tokens.toLocaleString()} (${percent.toFixed(0)}%)`);
    }
  }

  if (budget.cost && budget.cost > 0) {
    const costEstimate = estimateCost(usage);
    const used = costEstimate.totalRaw;
    const { percent, severity } = dimCheck(used, budget.cost);
    costStatus = { used, budget: budget.cost, percent, severity };
    if (severity === "exceeded") {
      warnings.push(`Cost budget exceeded: $${used.toFixed(2)} of $${budget.cost.toFixed(2)} (${percent.toFixed(0)}%)`);
    } else if (severity === "warning") {
      warnings.push(`Approaching cost budget: $${used.toFixed(2)} of $${budget.cost.toFixed(2)} (${percent.toFixed(0)}%)`);
    }
  }

  const severity: BudgetSeverity =
    [tokenStatus?.severity, costStatus?.severity].includes("exceeded")
      ? "exceeded"
      : [tokenStatus?.severity, costStatus?.severity].includes("warning")
        ? "warning"
        : "ok";

  return { severity, tokens: tokenStatus, cost: costStatus, warnings };
}

// ---------------------------------------------------------------------------
// Parse query params
// ---------------------------------------------------------------------------

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf("?");
  return idx === -1 ? new URLSearchParams() : new URLSearchParams(url.slice(idx));
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/** Handle token usage API requests. Returns true if the request was handled. */
export function handleTokenUsageRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(TOKEN_PREFIX) || method !== "GET") return false;

  const fullPath = url.slice(TOKEN_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);
  const params = parseQuery(url);
  const since = params.get("since") || undefined;
  const until = params.get("until") || undefined;

  // GET /api/token/summary — aggregate usage with cost estimate
  if (path === "summary") {
    const events = collectAllEvents(ctx, since, until);
    const usage = eventsToAggregate(events);
    const cost = estimateCost(usage);
    jsonResponse(res, 200, { usage, cost, eventCount: events.length });
    return true;
  }

  // GET /api/token/events — raw event list
  if (path === "events") {
    const events = collectAllEvents(ctx, since, until);
    const pkg = params.get("package") || undefined;
    const filtered = pkg ? events.filter((e) => e.package === pkg) : events;
    jsonResponse(res, 200, { events: filtered });
    return true;
  }

  // GET /api/token/by-command — grouped by command
  if (path === "by-command") {
    const events = collectAllEvents(ctx, since, until);
    const commands = groupByCommand(events);
    jsonResponse(res, 200, { commands });
    return true;
  }

  // GET /api/token/by-period — grouped by time period
  if (path === "by-period") {
    const period = (params.get("period") || "day") as TimePeriod;
    if (!["day", "week", "month"].includes(period)) {
      errorResponse(res, 400, `Invalid period: ${period}. Use "day", "week", or "month".`);
      return true;
    }
    const events = collectAllEvents(ctx, since, until);
    const buckets = groupByTimePeriod(events, period);
    jsonResponse(res, 200, { period, buckets });
    return true;
  }

  // GET /api/token/budget — budget status
  if (path === "budget") {
    const events = collectAllEvents(ctx, since, until);
    const usage = eventsToAggregate(events);
    const config = loadRexConfig(ctx.rexDir);
    const result = checkBudget(usage, config?.budget);
    const cost = estimateCost(usage);
    jsonResponse(res, 200, { budget: result, usage, cost });
    return true;
  }

  return false;
}
