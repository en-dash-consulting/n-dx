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
  FALLBACK_MODEL_PRICING,
  FALLBACK_PRICING_MODEL,
  priceTokens,
  resolveLayout,
  resolveModelPricing,
  type BillableTokens,
  type ModelTokenPricing,
} from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type UsageStatus = "complete" | "partial" | "unavailable" | "malformed";

/** Token counts plus the provider's measurement provenance, independent of pricing. */
type MeasuredTokens = BillableTokens & { diagnosticStatus?: UsageStatus };

function mergeUsageStatus(...values: Array<UsageStatus | undefined>): UsageStatus | undefined {
  return values.includes("unavailable") ? "unavailable" : values.includes("malformed") ? "malformed"
    : values.includes("partial") ? "partial"
    : values.includes("complete") ? "complete" : undefined;
}

function carryUsageStatus(target: { diagnosticStatus?: UsageStatus }, ...values: Array<UsageStatus | undefined>): void {
  const status = mergeUsageStatus(target.diagnosticStatus, ...values);
  if (status) target.diagnosticStatus = status;
}

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
  /** Missing/partial measured spend remains unknown after grouping. */
  diagnosticStatus?: UsageStatus;
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
   * Distinct agent runs behind these counts. Only hench sets it — a hench run
   * spans many LLM calls (turns), so `calls` alone reads ~200x too large when
   * labelled "runs", which is exactly what `ndx usage` used to do. rex and
   * sourcevision have no run concept and leave it undefined rather than
   * reporting a meaningless zero.
   */
  runs?: number;
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
   * rows. These buckets carry token totals and measurement provenance so
   * an unmeasured call never becomes a definitive zero-cost model line.
   */
  byModel?: Record<string, MeasuredTokens>;
}

/** Combined token usage across all packages. */
export interface AggregateTokenUsage {
  diagnosticStatus?: UsageStatus;
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
  byModel?: Record<string, MeasuredTokens>;
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
  target: Record<string, MeasuredTokens>,
  model: string | undefined,
  tokens: MeasuredTokens,
): void {
  const key = model?.trim();
  if (!key || key === "unknown") return;

  const bucket = (target[key] ??= emptyBillableTokens());
  carryUsageStatus(bucket, tokens.diagnosticStatus);
  bucket.inputTokens += tokens.inputTokens;
  bucket.outputTokens += tokens.outputTokens;
  bucket.cacheCreationTokens += tokens.cacheCreationTokens;
  bucket.cacheReadTokens += tokens.cacheReadTokens;
}

/** The per-model split of a usage record, created on first use. */
function modelBuckets(usage: PackageTokenUsage): Record<string, MeasuredTokens> {
  return (usage.byModel ??= {});
}

/** Fold `source`'s per-model buckets into `target`. */
function mergeByModel(
  target: Record<string, MeasuredTokens>,
  source: Record<string, MeasuredTokens> | undefined,
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
  const byModel: Record<string, MeasuredTokens> = {};
  for (const pkg of [rex, hench, sv]) mergeByModel(byModel, pkg.byModel);

  return {
    ...(mergeUsageStatus(rex.diagnosticStatus, hench.diagnosticStatus, sv.diagnosticStatus)
      ? { diagnosticStatus: mergeUsageStatus(rex.diagnosticStatus, hench.diagnosticStatus, sv.diagnosticStatus) } : {}),
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
 * The execution-log events that carry rex token spend. One set for the package
 * rollup and the per-command event stream both: when the rollup read only
 * `analyze_token_usage`, every smart-add call was in the By-command breakdown
 * (and the dashboard's totals) but missing from the headline `ndx usage`
 * figure, so the two surfaces could never agree to the cent.
 */
const REX_TOKEN_EVENTS: Record<string, string> = {
  analyze_token_usage: "analyze",
  smart_add_token_usage: "smart-add",
};

/**
 * Extract rex token usage from execution log entries.
 *
 * Reads every event kind in {@link REX_TOKEN_EVENTS} whose `detail` field
 * contains JSON-serialized token usage data.
 */
export function extractRexTokenUsage(
  logEntries: TokenUsageLogEntry[],
  filter: TokenUsageFilter = {},
): PackageTokenUsage {
  const usage = emptyPackageUsage();

  for (const event of extractRexTokenEvents(logEntries, filter)) {
    carryUsageStatus(usage, event.diagnosticStatus);
    usage.calls += event.calls;
    usage.inputTokens += event.inputTokens;
    usage.outputTokens += event.outputTokens;
    usage.cacheCreationTokens += event.cacheCreationTokens;
    usage.cacheReadTokens += event.cacheReadTokens;
    attributeToModel(modelBuckets(usage), event.model, event);
  }

  return usage;
}

// ---------------------------------------------------------------------------
// Hench token usage from run records
// ---------------------------------------------------------------------------

/** Timestamped token event used internally for grouping and command breakdown. */
export interface TokenEvent {
  diagnosticStatus?: UsageStatus;
  cacheProvenance?: string;
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
  /**
   * The run this event came from, for counting distinct runs downstream.
   * Hench fans one run out into one event per turn; without this id the
   * per-command and per-period groupers can only count events, which is the
   * turn count. Only hench events carry it.
   */
  runId?: string;
}

/** Minimal shape of a hench RunRecord for token extraction. */
interface HenchRunSummary {
  diagnostics?: { tokenDiagnosticStatus?: UsageStatus };
  id?: string;
  startedAt: string;
  model?: string;
  tokenUsage: {
    input: number;
    output: number;
    cacheCreationInput?: number;
    cacheReadInput?: number;
  };
  turnTokenUsage?: Array<{
    diagnosticStatus?: UsageStatus;
    cacheProvenance?: string;
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
  usage.runs = 0;
  const runsDir = join(resolveLayout(projectDir).henchDir, "runs");

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

      carryUsageStatus(usage, run.diagnostics?.tokenDiagnosticStatus, ...(run.turnTokenUsage ?? []).map(t => t.diagnosticStatus));
      usage.runs = (usage.runs ?? 0) + 1;
      // `calls` counts LLM calls (turns), matching what the per-turn event
      // stream sums to. A run without turn records is at least one call — the
      // real number is unrecoverable, so the floor is the honest choice.
      usage.calls += Array.isArray(run.turnTokenUsage) && run.turnTokenUsage.length > 0
        ? run.turnTokenUsage.length
        : 1;
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
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
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
  const manifestPath = join(resolveLayout(projectDir).sourcevisionDir, "manifest.json");

  try {
    const raw = await readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw) as SvManifest;

    if (!manifest.tokenUsage) return usage;
    if (manifest.analyzedAt && !isInRange(manifest.analyzedAt, filter)) return usage;

    usage.calls += manifest.tokenUsage.calls ?? 0;
    usage.inputTokens += manifest.tokenUsage.inputTokens ?? 0;
    usage.outputTokens += manifest.tokenUsage.outputTokens ?? 0;
    usage.cacheCreationTokens += manifest.tokenUsage.cacheCreationInputTokens ?? 0;
    usage.cacheReadTokens += manifest.tokenUsage.cacheReadInputTokens ?? 0;
    attributeToModel(modelBuckets(usage), normalizeEventMetadata(manifest.tokenUsage.model), usage);
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
  const pending: Array<{ event: TokenEvent; diagnostic: boolean; scope?: string }> = [];
  const owners = new Map<string, TokenEvent>();

  for (const entry of logEntries) {
    const diagnostic = entry.event === "llm_usage_diagnostic";
    const command = REX_TOKEN_EVENTS[entry.event];
    if (!command && !diagnostic) continue;
    if (!entry.detail) continue;

    try {
      const data = JSON.parse(entry.detail) as {
        calls?: number;
        inputTokens?: number;
        outputTokens?: number;
        cacheCreationInputTokens?: number;
        cacheReadInputTokens?: number;
        vendor?: string;
        model?: string;
        command?: string;
        usageStatus?: string;
        usageScope?: string;
        outcome?: string;
      };
      const status = data.usageStatus === "measured" ? "complete"
        : data.usageStatus === "unavailable" || data.usageStatus === "malformed" || data.usageStatus === "partial"
          ? data.usageStatus : undefined;
      // Diagnostics annotate successful command-owned totals. They must never
      // add a second call or spend, even if an older writer included counters.
      if (diagnostic && !status) continue;
      const event: TokenEvent = {
        timestamp: entry.timestamp,
        command: normalizeEventMetadata(data.command) ?? command ?? "unknown",
        package: "rex",
        ...(status ? { diagnosticStatus: status } : {}),
        inputTokens: !diagnostic && typeof data.inputTokens === "number" ? data.inputTokens : 0,
        outputTokens: !diagnostic && typeof data.outputTokens === "number" ? data.outputTokens : 0,
        cacheCreationTokens: !diagnostic && typeof data.cacheCreationInputTokens === "number" ? data.cacheCreationInputTokens : 0,
        cacheReadTokens: !diagnostic && typeof data.cacheReadInputTokens === "number" ? data.cacheReadInputTokens : 0,
        calls: !diagnostic && typeof data.calls === "number" ? data.calls : 0,
        vendor: normalizeEventMetadata(data.vendor) ?? "unknown",
        model: normalizeEventMetadata(data.model) ?? "unknown",
      };
      const scope = normalizeEventMetadata(data.usageScope);
      pending.push({ event, diagnostic, scope });
      if (scope && !diagnostic && data.outcome !== "failed") owners.set(scope, event);
    } catch {
      // Malformed detail — skip
    }
  }

  // A completion can precede review/caching by minutes or cross midnight.
  // Keep its metadata in the same reporting window as the aggregate that owns
  // its counts. Correlate by invocation, never by model/adjacency: concurrent
  // commands may use the same model. Unlinked historical diagnostics retain
  // their recorded timestamp; there is no safe owner to guess for them.
  return pending.flatMap(({ event, diagnostic, scope }) => {
    const owner = diagnostic && scope ? owners.get(scope) : undefined;
    const timestamp = owner?.timestamp ?? event.timestamp;
    return isInRange(timestamp, filter) ? [{ ...event, timestamp }] : [];
  });
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
  const runsDir = join(resolveLayout(projectDir).henchDir, "runs");

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

      // One file is one run; the id lets groupers count runs while the events
      // themselves stay one-per-turn for model attribution.
      const runId = run.id?.trim() || file.replace(/\.json$/, "");

      if (Array.isArray(run.turnTokenUsage) && run.turnTokenUsage.length > 0) {
        for (const turn of run.turnTokenUsage) {
          events.push({
            ...(turn.diagnosticStatus ? { diagnosticStatus: turn.diagnosticStatus } : {}),
            ...(turn.cacheProvenance ? { cacheProvenance: turn.cacheProvenance } : {}),
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
            runId,
          });
        }
        continue;
      }

      events.push({
        ...(run.diagnostics?.tokenDiagnosticStatus ? { diagnosticStatus: run.diagnostics.tokenDiagnosticStatus } : {}),
        timestamp: run.startedAt,
        command: "run",
        package: "hench",
        inputTokens: run.tokenUsage.input ?? 0,
        outputTokens: run.tokenUsage.output ?? 0,
        cacheCreationTokens: run.tokenUsage.cacheCreationInput ?? 0,
        cacheReadTokens: run.tokenUsage.cacheReadInput ?? 0,
        calls: 1,
        model: run.model,
        runId,
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
  const manifestPath = join(resolveLayout(projectDir).sourcevisionDir, "manifest.json");

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
      cacheCreationTokens: manifest.tokenUsage.cacheCreationInputTokens ?? 0,
      cacheReadTokens: manifest.tokenUsage.cacheReadInputTokens ?? 0,
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
  // Distinct runs per command entry. Summing event calls counts turns for
  // hench, and turns must never be printed as "runs" — that was the 1,459-vs-8
  // disagreement between the By-command and By-package lines.
  const runIds = new Map<string, Set<string>>();

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
    carryUsageStatus(entry, ev.diagnosticStatus);
    attributeToModel(modelBuckets(entry), ev.model, ev);
    entry.inputTokens += ev.inputTokens;
    entry.outputTokens += ev.outputTokens;
    entry.cacheCreationTokens += ev.cacheCreationTokens;
    entry.cacheReadTokens += ev.cacheReadTokens;
    entry.calls += ev.calls;
    if (ev.runId) {
      let ids = runIds.get(key);
      if (!ids) {
        ids = new Set();
        runIds.set(key, ids);
      }
      ids.add(ev.runId);
      entry.runs = ids.size;
    }
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
  // Distinct runs per package, so period buckets report the same run counts
  // as the all-time package rollup does. Only hench events carry a runId.
  const runIds = { rex: new Set<string>(), hench: new Set<string>(), sv: new Set<string>() };

  for (const ev of events) {
    const pkg = ev.package === "rex" ? rex : ev.package === "hench" ? hench : sv;
    carryUsageStatus(pkg, ev.diagnosticStatus);
    pkg.inputTokens += ev.inputTokens;
    pkg.outputTokens += ev.outputTokens;
    pkg.cacheCreationTokens += ev.cacheCreationTokens;
    pkg.cacheReadTokens += ev.cacheReadTokens;
    pkg.calls += ev.calls;
    if (ev.runId) {
      const ids = runIds[ev.package];
      ids.add(ev.runId);
      pkg.runs = ids.size;
    }
    attributeToModel(modelBuckets(pkg), ev.model, ev);
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
  /** Annotated cost when measurement provenance is available. */
  total?: string;
  measurementStatus?: UsageStatus;
  measurementComplete?: boolean;
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
  /** Absent on legacy records with no explicit measurement provenance. */
  measurementStatus?: UsageStatus;
  /** Independent of whether the model has known prices. */
  measurementComplete?: boolean;
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
   * This says nothing about missing measurements; see measurementComplete.
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
  return estimateCostFromTotals(
    {
      inputTokens: usage.totalInputTokens,
      outputTokens: usage.totalOutputTokens,
      cacheCreationTokens: usage.totalCacheCreationTokens,
      cacheReadTokens: usage.totalCacheReadTokens,
      diagnosticStatus: usage.diagnosticStatus,
    },
    usage.byModel,
    pricing,
  );
}

/**
 * The per-model pricing arithmetic behind {@link estimateCost}, over bare
 * totals and buckets rather than rex's aggregate shape.
 *
 * Exported (and re-exported through the web package's rex gateway) because the
 * dashboard aggregates its own four-package shape — it has a `web` bucket rex's
 * aggregate does not model — but must quote the same dollar figure as
 * `ndx usage` for the same tokens. One arithmetic, two aggregations;
 * `tests/unit/token-pricing-parity.test.js` pins that the dashboard has no
 * local copy of this loop.
 */
export function estimateCostFromTotals(
  totals: MeasuredTokens,
  byModel?: Record<string, MeasuredTokens>,
  pricing?: ModelPricing,
): CostEstimate {
  const status = mergeUsageStatus(totals.diagnosticStatus, ...Object.values(byModel ?? {}).map(t => t.diagnosticStatus));
  if (pricing) {
    const flat = priceTokens(totals, pricing);
    return { ...flat, ...measurementCost(flat.totalRaw, status), byModel: [], fullyAttributed: false };
  }

  const buckets = Object.entries(byModel ?? {});
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
      ...(tokens.diagnosticStatus ? measurementCost(cost.totalRaw, tokens.diagnosticStatus) : {}),
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
    ...measurementCost(totalRaw, status),
    totalRaw,
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    byModel: lines,
    fullyAttributed: lines.length > 0 && lines.every((l) => l.known && !l.unattributed),
  };
}

/** Keep the numeric recorded subtotal usable without presenting it as a complete bill. */
function measurementCost(value: number, status?: UsageStatus): Pick<CostEstimate, "total" | "measurementStatus" | "measurementComplete"> {
  if (!status) return { total: fmtUsd(value) };
  const complete = status === "complete";
  return {
    measurementStatus: status,
    measurementComplete: complete,
    total: complete ? fmtUsd(value)
      : value === 0 && status !== "partial" ? `Unknown (usage ${status})`
        : `${fmtUsd(value)} recorded (usage ${status})`,
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
