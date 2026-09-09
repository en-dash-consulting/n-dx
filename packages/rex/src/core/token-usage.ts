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
import {
  PROJECT_DIRS,
  FALLBACK_MODEL_PRICING,
  FALLBACK_PRICING_MODEL,
  priceTokens,
  resolveModelPricing,
  type BillableTokens,
  type ModelTokenPricing,
} from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Aggregated token usage for a single package.
 *
 * All four token kinds are tracked because all four are billed. Cache writes
 * cost more than fresh input (~1.25x) and cache reads much less (~0.1x), but
 * neither is free — and on a warm agent loop cache reads are the largest term
 * by an order of magnitude, so a rollup that omits them is not an
 * approximation, it is the wrong number.
 */
export interface TokenCounts {
  /** Fresh (uncached) input tokens. */
  inputTokens: number;
  /** Total output tokens. */
  outputTokens: number;
  /** Input tokens written to the prompt cache. Billed above the input rate. */
  cacheCreationTokens: number;
  /** Input tokens served from the prompt cache. Billed below the input rate. */
  cacheReadTokens: number;
  /** Number of LLM calls. */
  calls: number;
}

export interface PackageTokenUsage extends TokenCounts {
  /**
   * The same tokens split by the model that spent them.
   *
   * Optional, and frequently a partial view: sourcevision's manifest records
   * no model at all, and a hench run whose per-turn records are incomplete
   * attributes less than its run-level total. Cost estimation therefore treats
   * the difference between these buckets and the flat counters above as
   * unattributed rather than assuming they agree.
   *
   * Deliberately carries no `calls`. The unit is not the same across sources —
   * a run-level record contributes one call while a turn-level one contributes
   * many — so a per-model call count would mean different things in adjacent
   * rows. These buckets exist to be priced, and pricing needs only tokens.
   */
  byModel?: Record<string, BillableTokens>;
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
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCalls: number;
  /** Per-model split of the totals above. See {@link PackageTokenUsage.byModel}. */
  byModel?: Record<string, BillableTokens>;
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

function emptyBillableTokens(): BillableTokens {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

function emptyPackageUsage(): PackageTokenUsage {
  return { ...emptyBillableTokens(), calls: 0, byModel: {} };
}

/**
 * Add one bucket of tokens to the per-model split under `model`.
 *
 * A missing, blank, or placeholder model id is dropped rather than bucketed
 * under a made-up key: those tokens fall through to the unattributed residual,
 * which cost estimation prices at the fallback rate *and labels as such*. An
 * "unknown" bucket would look like a real model in every breakdown.
 */
function attributeToModel(
  target: Record<string, BillableTokens>,
  model: string | undefined,
  tokens: BillableTokens,
): void {
  const key = model?.trim();
  if (!key || key === "unknown") return;

  const bucket = (target[key] ??= emptyBillableTokens());
  bucket.inputTokens += tokens.inputTokens;
  bucket.outputTokens += tokens.outputTokens;
  bucket.cacheCreationTokens += tokens.cacheCreationTokens;
  bucket.cacheReadTokens += tokens.cacheReadTokens;
}

/** The per-model split of a usage record, created on first use. */
function modelBuckets(usage: PackageTokenUsage): Record<string, BillableTokens> {
  return (usage.byModel ??= {});
}

/** Fold `source`'s per-model buckets into `target`. */
function mergeByModel(
  target: Record<string, BillableTokens>,
  source: Record<string, BillableTokens> | undefined,
): void {
  for (const [model, tokens] of Object.entries(source ?? {})) {
    attributeToModel(target, model, tokens);
  }
}

/**
 * Every billed token in one usage record. Used wherever a single "how big is
 * this" number is needed — display totals, sort keys, budget checks — so that
 * no call site can quietly go back to counting only input + output.
 */
export function totalTokens(usage: {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}): number {
  return (
    usage.inputTokens +
    usage.outputTokens +
    usage.cacheCreationTokens +
    usage.cacheReadTokens
  );
}

/** Roll three per-package records into the aggregate, totals included. */
function combinePackages(
  rex: PackageTokenUsage,
  hench: PackageTokenUsage,
  sv: PackageTokenUsage,
): AggregateTokenUsage {
  const byModel: Record<string, BillableTokens> = {};
  for (const pkg of [rex, hench, sv]) mergeByModel(byModel, pkg.byModel);

  return {
    packages: { rex, hench, sv },
    totalInputTokens: rex.inputTokens + hench.inputTokens + sv.inputTokens,
    totalOutputTokens: rex.outputTokens + hench.outputTokens + sv.outputTokens,
    totalCacheCreationTokens:
      rex.cacheCreationTokens + hench.cacheCreationTokens + sv.cacheCreationTokens,
    totalCacheReadTokens:
      rex.cacheReadTokens + hench.cacheReadTokens + sv.cacheReadTokens,
    totalCalls: rex.calls + hench.calls + sv.calls,
    byModel,
  };
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
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
        model?: string;
      };
      const counts: TokenCounts = {
        inputTokens: typeof data.inputTokens === "number" ? data.inputTokens : 0,
        outputTokens: typeof data.outputTokens === "number" ? data.outputTokens : 0,
        cacheCreationTokens:
          typeof data.cacheCreationInputTokens === "number" ? data.cacheCreationInputTokens : 0,
        cacheReadTokens:
          typeof data.cacheReadInputTokens === "number" ? data.cacheReadInputTokens : 0,
        calls: typeof data.calls === "number" ? data.calls : 0,
      };
      usage.calls += counts.calls;
      usage.inputTokens += counts.inputTokens;
      usage.outputTokens += counts.outputTokens;
      usage.cacheCreationTokens += counts.cacheCreationTokens;
      usage.cacheReadTokens += counts.cacheReadTokens;
      attributeToModel(modelBuckets(usage), normalizeEventMetadata(data.model), counts);
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
  cacheCreationTokens: number;
  cacheReadTokens: number;
  calls: number;
  vendor?: string;
  model?: string;
}

/** Minimal shape of a hench RunRecord for token extraction. */
interface HenchRunSummary {
  startedAt: string;
  model?: string;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  };
  turnTokenUsage?: Array<{
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
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
      usage.cacheCreationTokens += run.tokenUsage.cacheCreationInput ?? 0;
      usage.cacheReadTokens += run.tokenUsage.cacheReadInput ?? 0;

      // Model attribution comes from the per-turn records where they exist:
      // a single run can switch models mid-flight (light-tier routing, retry
      // escalation, vendor failover), so the run-level `model` field is only
      // the fallback. The flat counters above still come from the run-level
      // total, so a run whose turns do not sum to it leaves a remainder that
      // `estimateCost` reports as unattributed rather than silently absorbing.
      const buckets = modelBuckets(usage);
      if (Array.isArray(run.turnTokenUsage) && run.turnTokenUsage.length > 0) {
        for (const turn of run.turnTokenUsage) {
          attributeToModel(buckets, turn.model ?? run.model, {
            inputTokens: turn.input ?? 0,
            outputTokens: turn.output ?? 0,
            cacheCreationTokens: turn.cacheCreationInput ?? 0,
            cacheReadTokens: turn.cacheReadInput ?? 0,
          });
        }
      } else {
        attributeToModel(buckets, run.model, {
          inputTokens: run.tokenUsage.input ?? 0,
          outputTokens: run.tokenUsage.output ?? 0,
          cacheCreationTokens: run.tokenUsage.cacheCreationInput ?? 0,
          cacheReadTokens: run.tokenUsage.cacheReadInput ?? 0,
        });
      }
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
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
        vendor?: string;
        model?: string;
      };
      events.push({
        timestamp: entry.timestamp,
        command,
        package: "rex",
        inputTokens: data.inputTokens ?? 0,
        outputTokens: data.outputTokens ?? 0,
        cacheCreationTokens: data.cacheCreationInputTokens ?? 0,
        cacheReadTokens: data.cacheReadInputTokens ?? 0,
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
            cacheCreationTokens: turn.cacheCreationInput ?? 0,
            cacheReadTokens: turn.cacheReadInput ?? 0,
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
        cacheCreationTokens: run.tokenUsage.cacheCreationInput ?? 0,
        cacheReadTokens: run.tokenUsage.cacheReadInput ?? 0,
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
      // The sourcevision manifest records no cache split.
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
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
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        calls: 0,
      };
      map.set(key, entry);
    }
    entry.inputTokens += ev.inputTokens;
    entry.outputTokens += ev.outputTokens;
    entry.cacheCreationTokens += ev.cacheCreationTokens;
    entry.cacheReadTokens += ev.cacheReadTokens;
    entry.calls += ev.calls;
  }

  // Sort by total tokens descending — cache included, since a command whose
  // spend is mostly cache reads would otherwise sort as though it were free.
  return Array.from(map.values()).sort((a, b) => totalTokens(b) - totalTokens(a));
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
    pkg.cacheCreationTokens += ev.cacheCreationTokens;
    pkg.cacheReadTokens += ev.cacheReadTokens;
    pkg.calls += ev.calls;
    attributeToModel(modelBuckets(pkg), ev.model, {
      inputTokens: ev.inputTokens,
      outputTokens: ev.outputTokens,
      cacheCreationTokens: ev.cacheCreationTokens,
      cacheReadTokens: ev.cacheReadTokens,
    });
  }

  return combinePackages(rex, hench, sv);
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

  return combinePackages(rex, hench, sv);
}

// ---------------------------------------------------------------------------
// Cost estimation
// ---------------------------------------------------------------------------

/**
 * Per-million-token pricing for a model.
 *
 * Structurally the foundation-tier {@link ModelTokenPricing}; aliased rather
 * than redeclared so the two cannot drift, and kept exported under the old
 * name because it is part of rex's published surface.
 */
export type ModelPricing = ModelTokenPricing;

/**
 * Rates applied to tokens whose model is unknown or unrecorded.
 *
 * This is the fallback, not the default: usage that *does* carry a model is
 * priced at that model's rates. Sourced from the shared table so the CLI, the
 * dashboard, and budget preflight cannot quote three different numbers.
 */
const DEFAULT_PRICING: ModelPricing = FALLBACK_MODEL_PRICING;

/** What one model contributed to the bill. */
export interface ModelCostLine {
  /** The model id as recorded, or "unattributed" for the residual line. */
  model: string;
  /**
   * The catalog model whose rates were actually applied. Equals {@link model}
   * for a known id; {@link FALLBACK_PRICING_MODEL} otherwise. Kept distinct so
   * a display can say "priced as X" without the caller re-deriving it.
   */
  pricedAs: string;
  /** False when the id had no entry in the price table and fallback rates were used. */
  known: boolean;
  /** True for the synthetic line covering tokens with no model attribution. */
  unattributed: boolean;
  /** Total tokens in this line, all four kinds. */
  tokens: number;
  /** Cost of this line in USD. */
  totalRaw: number;
}

/** Estimated cost breakdown. */
export interface CostEstimate {
  /** Formatted total cost string (e.g. "$1.23"). */
  total: string;
  /** Raw numeric total in USD. */
  totalRaw: number;
  /** Cost from fresh input tokens. */
  inputCost: number;
  /** Cost from output tokens. */
  outputCost: number;
  /** Cost from tokens written to the prompt cache. */
  cacheWriteCost: number;
  /** Cost from tokens served out of the prompt cache. */
  cacheReadCost: number;
  /** Per-model contribution, most expensive first. Empty when no model was recorded. */
  byModel: ModelCostLine[];
  /**
   * True when every token was priced at its own model's rates — i.e. no line
   * is unattributed and no recorded model id was missing from the price table.
   * Callers use this to decide whether the figure needs a caveat.
   */
  fullyAttributed: boolean;
}

/** Sum the four billed kinds in a counts record. */
function billableTotal(t: BillableTokens): number {
  return t.inputTokens + t.outputTokens + t.cacheCreationTokens + t.cacheReadTokens;
}

/**
 * Estimate cost from aggregate token usage.
 *
 * Prices each model's tokens at that model's rates. The previous behaviour —
 * one hardcoded Sonnet rate over the collapsed aggregate — understated an
 * Opus-configured repo by the Sonnet-to-Opus ratio (40%), which is enough to
 * make before/after cost comparisons meaningless.
 *
 * Tokens that carry no model, and any remainder between the per-model buckets
 * and the flat totals, are priced at the fallback rate and reported as a
 * separate unattributed line. That line is why the arithmetic works on partial
 * data: sourcevision records no model, so its tokens have to land somewhere
 * visible rather than being dropped or silently spread across the models that
 * happen to be present.
 *
 * All four token kinds are priced. Cache tokens used to be omitted entirely,
 * which did not merely make the estimate approximate — on a cache-heavy agent
 * workload it made it wrong by more than an order of magnitude, and it hid the
 * one term the cost work is trying to move.
 *
 * @param pricing Force a single rate over every token, bypassing per-model
 *   pricing. For callers that genuinely want one hypothetical rate (a
 *   what-if comparison, a test fixture) — not for production reporting.
 */
export function estimateCost(
  usage: AggregateTokenUsage,
  pricing?: ModelPricing,
): CostEstimate {
  const totals: BillableTokens = {
    inputTokens: usage.totalInputTokens,
    outputTokens: usage.totalOutputTokens,
    cacheCreationTokens: usage.totalCacheCreationTokens,
    cacheReadTokens: usage.totalCacheReadTokens,
  };

  if (pricing) {
    const flat = priceTokens(totals, pricing);
    return { ...flat, total: fmtUsd(flat.totalRaw), byModel: [], fullyAttributed: false };
  }

  const buckets = Object.entries(usage.byModel ?? {});
  const lines: ModelCostLine[] = [];
  let inputCost = 0;
  let outputCost = 0;
  let cacheWriteCost = 0;
  let cacheReadCost = 0;

  // Track what the buckets account for so the remainder can be priced too.
  const attributed: BillableTokens = emptyBillableTokens();

  for (const [model, tokens] of buckets) {
    const resolved = resolveModelPricing(model);
    const cost = priceTokens(tokens, resolved.pricing);
    inputCost += cost.inputCost;
    outputCost += cost.outputCost;
    cacheWriteCost += cost.cacheWriteCost;
    cacheReadCost += cost.cacheReadCost;

    attributed.inputTokens += tokens.inputTokens;
    attributed.outputTokens += tokens.outputTokens;
    attributed.cacheCreationTokens += tokens.cacheCreationTokens;
    attributed.cacheReadTokens += tokens.cacheReadTokens;

    lines.push({
      model,
      pricedAs: resolved.modelId,
      known: resolved.known,
      unattributed: false,
      tokens: billableTotal(tokens),
      totalRaw: cost.totalRaw,
    });
  }

  // Clamp at zero: per-turn records can overshoot the run-level total, and a
  // negative residual would refund tokens that were genuinely billed.
  const residual: BillableTokens = {
    inputTokens: Math.max(0, totals.inputTokens - attributed.inputTokens),
    outputTokens: Math.max(0, totals.outputTokens - attributed.outputTokens),
    cacheCreationTokens: Math.max(
      0,
      totals.cacheCreationTokens - attributed.cacheCreationTokens,
    ),
    cacheReadTokens: Math.max(0, totals.cacheReadTokens - attributed.cacheReadTokens),
  };

  const residualTokens = billableTotal(residual);
  if (residualTokens > 0) {
    const cost = priceTokens(residual, DEFAULT_PRICING);
    inputCost += cost.inputCost;
    outputCost += cost.outputCost;
    cacheWriteCost += cost.cacheWriteCost;
    cacheReadCost += cost.cacheReadCost;
    lines.push({
      model: "unattributed",
      pricedAs: FALLBACK_PRICING_MODEL,
      known: false,
      unattributed: true,
      tokens: residualTokens,
      totalRaw: cost.totalRaw,
    });
  }

  lines.sort((a, b) => b.totalRaw - a.totalRaw);
  const totalRaw = inputCost + outputCost + cacheWriteCost + cacheReadCost;

  return {
    total: fmtUsd(totalRaw),
    totalRaw,
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    byModel: lines,
    fullyAttributed: lines.length > 0 && lines.every((l) => l.known && !l.unattributed),
  };
}

function fmtUsd(value: number): string {
  return `$${value.toFixed(2)}`;
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
  pricing?: ModelPricing,
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
