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
import { jsonResponse, errorResponse } from "./response-utils.js";
import { AggregationResultCache } from "./aggregation-cache.js";

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
  vendor?: string;
  model?: string;
}

interface ToolBreakdown {
  rex: PackageTokenUsage;
  hench: PackageTokenUsage;
  sv: PackageTokenUsage;
}

interface VendorModelUsage extends PackageTokenUsage {
  vendor: string;
  model: string;
  toolBreakdown: ToolBreakdown;
}

interface UtilizationTrendBucket {
  period: string;
  totalTokens: number;
  byVendorModel: VendorModelUsage[];
  toolBreakdown: ToolBreakdown;
  estimatedCost: CostEstimate;
}

interface UtilizationSourceMeta {
  rex: string;
  hench: string;
  sourcevision: string;
}

interface ConfiguredModel {
  vendor: string;
  model: string;
}

type WeeklyBudgetSource = "vendor_model" | "vendor_default" | "global_default" | "missing_budget";
type WeeklyBudgetReasonCode =
  | "fallback_model_budget_missing_or_invalid"
  | "fallback_vendor_budget_missing_or_invalid"
  | "missing_budget_config_not_set"
  | "missing_budget_no_valid_match"
  | "missing_budget_invalid_config";

interface WeeklyBudgetValidationError {
  code: "invalid_budget_value";
  path: string;
  message: string;
  received: unknown;
}

interface WeeklyBudgetResolution {
  /** Resolved weekly token budget; null means no configured budget applies. */
  budget: number | null;
  /** Which lookup tier produced the result. */
  source: WeeklyBudgetSource;
  /** Stable reason emitted when fallback/missing budget behavior is used. */
  reasonCode?: WeeklyBudgetReasonCode;
}

interface VendorWeeklyBudgetScope {
  default?: number;
  models?: Record<string, number>;
}

interface WeeklyBudgetConfig {
  globalDefault?: number;
  vendors?: Record<string, VendorWeeklyBudgetScope>;
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

function emptyToolBreakdown(): ToolBreakdown {
  return {
    rex: emptyPackageUsage(),
    hench: emptyPackageUsage(),
    sv: emptyPackageUsage(),
  };
}

function isInRange(timestamp: string, since?: string, until?: string): boolean {
  if (since && timestamp < since) return false;
  if (until && timestamp > until) return false;
  return true;
}

function normalizeEventMetadata(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeBudgetKey(value: unknown): string | undefined {
  const normalized = normalizeEventMetadata(value);
  return normalized?.toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidBudget(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function readBudgetValue(
  value: unknown,
  path: string,
  errors: WeeklyBudgetValidationError[],
): number | undefined {
  if (value === undefined) return undefined;
  if (isValidBudget(value)) return value;
  errors.push({
    code: "invalid_budget_value",
    path,
    received: value,
    message: `Expected a positive, finite number at "${path}". Update this value to a numeric weekly token budget.`,
  });
  return undefined;
}

function normalizeWeeklyBudgetConfig(
  raw: unknown,
): { config?: WeeklyBudgetConfig; validationErrors: WeeklyBudgetValidationError[] } {
  const validationErrors: WeeklyBudgetValidationError[] = [];
  if (!isRecord(raw)) {
    return { config: undefined, validationErrors };
  }

  const config: WeeklyBudgetConfig = {};
  const globalDefault = readBudgetValue(raw.globalDefault, "tokenUsage.weeklyBudget.globalDefault", validationErrors);
  if (globalDefault !== undefined) {
    config.globalDefault = globalDefault;
  }

  if (isRecord(raw.vendors)) {
    const normalizedVendors: Record<string, VendorWeeklyBudgetScope> = {};
    for (const [rawVendorKey, rawVendorValue] of Object.entries(raw.vendors)) {
      const vendorKey = normalizeBudgetKey(rawVendorKey);
      if (!vendorKey || !isRecord(rawVendorValue)) continue;

      const existingScope = normalizedVendors[vendorKey] ?? {};
      const vendorDefault = readBudgetValue(
        rawVendorValue.default,
        `tokenUsage.weeklyBudget.vendors.${rawVendorKey}.default`,
        validationErrors,
      );
      if (vendorDefault !== undefined) {
        existingScope.default = vendorDefault;
      }

      if (isRecord(rawVendorValue.models)) {
        const existingModels = existingScope.models ?? {};
        for (const [rawModelKey, rawModelValue] of Object.entries(rawVendorValue.models)) {
          const modelKey = normalizeBudgetKey(rawModelKey);
          if (!modelKey) continue;
          const modelBudget = readBudgetValue(
            rawModelValue,
            `tokenUsage.weeklyBudget.vendors.${rawVendorKey}.models.${rawModelKey}`,
            validationErrors,
          );
          if (modelBudget !== undefined) {
            existingModels[modelKey] = modelBudget;
          }
        }
        if (Object.keys(existingModels).length > 0) {
          existingScope.models = existingModels;
        }
      }

      if (existingScope.default !== undefined || existingScope.models) {
        normalizedVendors[vendorKey] = existingScope;
      }
    }
    if (Object.keys(normalizedVendors).length > 0) {
      config.vendors = normalizedVendors;
    }
  }

  if (
    config.globalDefault === undefined
    && (!config.vendors || Object.keys(config.vendors).length === 0)
  ) {
    return { config: undefined, validationErrors };
  }

  return { config, validationErrors };
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
        vendor: normalizeEventMetadata(data.vendor),
        model: normalizeEventMetadata(data.model),
      });
    } catch { /* skip */ }
  }
  return events;
}

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

      if (Array.isArray(run.turnTokenUsage) && run.turnTokenUsage.length > 0) {
        for (const turn of run.turnTokenUsage) {
          events.push({
            timestamp: run.startedAt,
            command: "run",
            package: "hench",
            inputTokens: turn.input ?? 0,
            outputTokens: turn.output ?? 0,
            calls: 1,
            vendor: normalizeEventMetadata(turn.vendor),
            model: normalizeEventMetadata(turn.model) ?? normalizeEventMetadata(run.model),
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
        model: normalizeEventMetadata(run.model),
      });
    } catch { /* skip */ }
  }
  return events;
}

interface SvManifest {
  analyzedAt?: string;
  tokenUsage?: {
    calls?: number;
    inputTokens?: number;
    outputTokens?: number;
    vendor?: string;
    model?: string;
  };
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
      vendor: normalizeEventMetadata(manifest.tokenUsage.vendor) ?? "unknown",
      model: normalizeEventMetadata(manifest.tokenUsage.model) ?? "unknown",
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

function resolveSourceMeta(ctx: ServerContext): UtilizationSourceMeta {
  const rexPath = join(ctx.rexDir, "execution-log.jsonl");
  const henchPath = join(ctx.projectDir, ".hench", "runs");
  const svPath = join(ctx.projectDir, ".sourcevision", "manifest.json");
  return {
    rex: existsSync(rexPath) ? ".rex/execution-log.jsonl" : "missing (.rex/execution-log.jsonl)",
    hench: existsSync(henchPath) ? ".hench/runs/*.json" : "missing (.hench/runs/*.json)",
    sourcevision: existsSync(svPath) ? ".sourcevision/manifest.json" : "missing (.sourcevision/manifest.json)",
  };
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

function aggregateByVendorModel(events: TokenEvent[]): VendorModelUsage[] {
  const map = new Map<string, VendorModelUsage>();

  for (const ev of events) {
    const vendor = normalizeEventMetadata(ev.vendor) ?? "unknown";
    const model = normalizeEventMetadata(ev.model) ?? "unknown";
    const key = `${vendor}:${model}`;

    let entry = map.get(key);
    if (!entry) {
      entry = {
        vendor,
        model,
        inputTokens: 0,
        outputTokens: 0,
        calls: 0,
        toolBreakdown: emptyToolBreakdown(),
      };
      map.set(key, entry);
    }

    const tool = ev.package === "rex" ? entry.toolBreakdown.rex : ev.package === "hench" ? entry.toolBreakdown.hench : entry.toolBreakdown.sv;
    tool.inputTokens += ev.inputTokens;
    tool.outputTokens += ev.outputTokens;
    tool.calls += ev.calls;
    entry.inputTokens += ev.inputTokens;
    entry.outputTokens += ev.outputTokens;
    entry.calls += ev.calls;
  }

  return Array.from(map.values()).sort((a, b) => {
    const tokenDiff = (b.inputTokens + b.outputTokens) - (a.inputTokens + a.outputTokens);
    if (tokenDiff !== 0) return tokenDiff;
    const vendorDiff = a.vendor.localeCompare(b.vendor);
    if (vendorDiff !== 0) return vendorDiff;
    return a.model.localeCompare(b.model);
  });
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

function groupUtilizationTrend(
  events: TokenEvent[],
  period: TimePeriod,
): UtilizationTrendBucket[] {
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

  const result: UtilizationTrendBucket[] = [];
  for (const [key, evts] of buckets) {
    const usage = eventsToAggregate(evts);
    const byVendorModel = aggregateByVendorModel(evts);
    result.push({
      period: key,
      totalTokens: usage.totalInputTokens + usage.totalOutputTokens,
      byVendorModel,
      toolBreakdown: usage.packages,
      estimatedCost: estimateCost(usage),
    });
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

function loadConfiguredModel(projectDir: string): ConfiguredModel {
  const path = join(projectDir, ".n-dx.json");
  if (!existsSync(path)) return { vendor: "claude", model: "default" };
  try {
    const raw = readFileSync(path, "utf-8");
    const root = JSON.parse(raw) as Record<string, unknown>;
    const llm = root.llm as Record<string, unknown> | undefined;
    const llmVendor = llm?.vendor;
    const vendor = llmVendor === "codex" ? "codex" : "claude";
    const llmVendorCfg = llm?.[vendor] as Record<string, unknown> | undefined;
    const llmVendorModel = llmVendorCfg?.model;
    if (typeof llmVendorModel === "string" && llmVendorModel) {
      return { vendor, model: llmVendorModel };
    }
    const legacyClaude = root.claude as Record<string, unknown> | undefined;
    if (vendor === "claude" && typeof legacyClaude?.model === "string" && legacyClaude.model) {
      return { vendor, model: legacyClaude.model };
    }
    return { vendor, model: "default" };
  } catch {
    return { vendor: "claude", model: "default" };
  }
}

function loadWeeklyBudgetConfig(
  projectDir: string,
): {
  config?: WeeklyBudgetConfig;
  hasConfiguredBudget: boolean;
  validationErrors: WeeklyBudgetValidationError[];
} {
  const path = join(projectDir, ".n-dx.json");
  if (!existsSync(path)) {
    return { config: undefined, hasConfiguredBudget: false, validationErrors: [] };
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const root = JSON.parse(raw) as Record<string, unknown>;
    const tokenUsage = isRecord(root.tokenUsage) ? root.tokenUsage : undefined;
    const hasConfiguredBudget = tokenUsage ? Object.hasOwn(tokenUsage, "weeklyBudget") : false;
    const normalized = normalizeWeeklyBudgetConfig(tokenUsage?.weeklyBudget);
    return {
      config: normalized.config,
      hasConfiguredBudget,
      validationErrors: normalized.validationErrors,
    };
  } catch {
    return { config: undefined, hasConfiguredBudget: false, validationErrors: [] };
  }
}

/**
 * Resolve weekly budget using deterministic fallback order:
 * 1) vendor + model
 * 2) vendor default
 * 3) global default
 * 4) explicit missing budget sentinel
 */
export function resolveWeeklyBudget(
  configured: ConfiguredModel,
  budgetConfig?: WeeklyBudgetConfig,
  options?: {
    hasConfiguredBudget?: boolean;
    validationErrors?: WeeklyBudgetValidationError[];
  },
): WeeklyBudgetResolution {
  const vendor = normalizeBudgetKey(configured.vendor);
  const model = normalizeBudgetKey(configured.model);
  const normalizedConfig = normalizeWeeklyBudgetConfig(budgetConfig).config;
  const hasConfiguredBudget = options?.hasConfiguredBudget ?? !!budgetConfig;
  const hasValidationErrors = (options?.validationErrors?.length ?? 0) > 0;

  if (normalizedConfig && vendor && model) {
    const vendorScope = normalizedConfig.vendors?.[vendor];
    const modelBudget = vendorScope?.models?.[model];
    if (isValidBudget(modelBudget)) {
      return { budget: modelBudget, source: "vendor_model" };
    }

    if (isValidBudget(vendorScope?.default)) {
      return {
        budget: vendorScope.default,
        source: "vendor_default",
        reasonCode: "fallback_model_budget_missing_or_invalid",
      };
    }

    if (isValidBudget(normalizedConfig.globalDefault)) {
      return {
        budget: normalizedConfig.globalDefault,
        source: "global_default",
        reasonCode: "fallback_vendor_budget_missing_or_invalid",
      };
    }
  }

  if (!hasConfiguredBudget) {
    return {
      budget: null,
      source: "missing_budget",
      reasonCode: "missing_budget_config_not_set",
    };
  }
  if (hasValidationErrors) {
    return {
      budget: null,
      source: "missing_budget",
      reasonCode: "missing_budget_invalid_config",
    };
  }
  return {
    budget: null,
    source: "missing_budget",
    reasonCode: "missing_budget_no_valid_match",
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

/**
 * Lazy cache instance, created on first request.
 * Module-scoped because there is only one web server per process.
 */
let aggregationCache: AggregationResultCache | null = null;

function getAggregationCache(ctx: ServerContext): AggregationResultCache {
  if (!aggregationCache) {
    aggregationCache = new AggregationResultCache(ctx.projectDir, ctx.rexDir);
  }
  return aggregationCache;
}

/** Reset the module-level cache (for testing). */
export function resetAggregationCache(): void {
  aggregationCache?.invalidate();
  aggregationCache = null;
}

/** Get the current cache instance (for testing/monitoring). */
export function getAggregationCacheInstance(): AggregationResultCache | null {
  return aggregationCache;
}

/**
 * Build a cache key from query scope parameters.
 * Encodes all parameters that affect the events result.
 */
function eventsCacheKey(since?: string, until?: string): string {
  return `events:${since ?? ""}:${until ?? ""}`;
}

/**
 * Get cached events or collect fresh ones. The cache automatically
 * invalidates when source files (hench runs, rex log, sv manifest) change.
 */
async function getCachedEvents(
  ctx: ServerContext,
  since?: string,
  until?: string,
): Promise<TokenEvent[]> {
  const cache = getAggregationCache(ctx);
  return cache.getOrCompute(
    eventsCacheKey(since, until),
    () => collectAllEvents(ctx, since, until),
  );
}

/** Handle token usage API requests. Returns true if the request was handled. */
export async function handleTokenUsageRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
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
    const events = await getCachedEvents(ctx, since, until);
    const usage = eventsToAggregate(events);
    const cost = estimateCost(usage);
    jsonResponse(res, 200, { usage, cost, eventCount: events.length });
    return true;
  }

  // GET /api/token/events — raw event list (?offset=N&limit=N&package=...)
  if (path === "events") {
    const events = await getCachedEvents(ctx, since, until);
    const pkg = params.get("package") || undefined;
    const filtered = pkg ? events.filter((e) => e.package === pkg) : events;
    const total = filtered.length;

    // Support pagination via ?offset=N&limit=N
    const offsetStr = params.get("offset");
    const limitStr = params.get("limit");
    const offset = offsetStr ? Math.max(0, parseInt(offsetStr, 10) || 0) : 0;
    const limit = limitStr ? Math.max(0, parseInt(limitStr, 10) || 0) : 0;

    if (offset > 0 || limit > 0) {
      const sliced = limit > 0
        ? filtered.slice(offset, offset + limit)
        : filtered.slice(offset);
      jsonResponse(res, 200, {
        events: sliced,
        pagination: { offset, limit: limit || total - offset, total },
      });
    } else {
      jsonResponse(res, 200, { events: filtered });
    }
    return true;
  }

  // GET /api/token/by-command — grouped by command
  if (path === "by-command") {
    const events = await getCachedEvents(ctx, since, until);
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
    const events = await getCachedEvents(ctx, since, until);
    const buckets = groupByTimePeriod(events, period);
    jsonResponse(res, 200, { period, buckets });
    return true;
  }

  // GET /api/token/budget — budget status
  if (path === "budget") {
    const events = await getCachedEvents(ctx, since, until);
    const usage = eventsToAggregate(events);
    const config = loadRexConfig(ctx.rexDir);
    const result = checkBudget(usage, config?.budget);
    const cost = estimateCost(usage);
    jsonResponse(res, 200, { budget: result, usage, cost });
    return true;
  }

  // GET /api/token/utilization — config + usage grouped by vendor/model
  if (path === "utilization") {
    const period = (params.get("period") || "day") as TimePeriod;
    if (!["day", "week", "month"].includes(period)) {
      errorResponse(res, 400, `Invalid period: ${period}. Use "day", "week", or "month".`);
      return true;
    }

    const configured = loadConfiguredModel(ctx.projectDir);
    const events = await getCachedEvents(ctx, since, until);
    const usage = eventsToAggregate(events);
    const byVendorModel = aggregateByVendorModel(events);
    const trend = groupUtilizationTrend(events, period);
    const commands = groupByCommand(events);
    const budget = checkBudget(usage, loadRexConfig(ctx.rexDir)?.budget);
    const weeklyBudgetConfig = loadWeeklyBudgetConfig(ctx.projectDir);
    const weeklyBudget = resolveWeeklyBudget(
      configured,
      weeklyBudgetConfig.config,
      {
        hasConfiguredBudget: weeklyBudgetConfig.hasConfiguredBudget,
        validationErrors: weeklyBudgetConfig.validationErrors,
      },
    );
    const source = resolveSourceMeta(ctx);

    jsonResponse(res, 200, {
      configured,
      source,
      weeklyBudget,
      weeklyBudgetValidationErrors: weeklyBudgetConfig.validationErrors,
      period,
      window: {
        since: since ?? null,
        until: until ?? null,
      },
      usage,
      cost: estimateCost(usage),
      byVendorModel,
      trend,
      commands,
      budget,
      eventCount: events.length,
    });
    return true;
  }

  return false;
}
