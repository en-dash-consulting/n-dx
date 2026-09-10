/**
 * Dashboard LLM spend ledger.
 *
 * The three token sources the utilization view already reads all describe work
 * a **CLI** did: `.rex/execution-log.jsonl`, `.hench/runs/*.json`, and
 * `.sourcevision/manifest.json`. The dashboard itself now spends tokens too —
 * the SourceVision Ask panel calls a model on every question — and that spend
 * belongs to no PRD item and no hench run, so nothing upstream would ever
 * record it. Without this ledger the dashboard's own bill is invisible in the
 * one view whose job is to report the bill.
 *
 * ## Why a separate bucket rather than a PRD item
 *
 * An ask is not task-scoped. Attributing it to whichever item happened to be
 * selected would put a number under an item that did not cause it, and
 * `aggregateItemTokenUsage` would then roll that number up through every
 * ancestor. A distinct `web` package bucket keeps dashboard spend addable to
 * the total while remaining separable from hench run spend in every breakdown.
 *
 * ## Why append-only JSONL at the project root
 *
 * One line per LLM call, in the same shape the aggregator's other extractors
 * produce. Append-only because a concurrent second ask must not lose the
 * first's record, and JSONL because a torn final line costs one record rather
 * than the file. It sits beside `.n-dx-web.port` / `.n-dx-web.pid` — the files
 * the web server already owns at the project root — rather than inside
 * `.rex/`, `.hench/`, or `.sourcevision/`, none of which own this spend.
 * `.sourcevision/` would additionally have made `sv reset` erase spend history.
 *
 * `command` is a field rather than being implied by the file name: the sibling
 * dashboard surfaces that will also spend tokens (explain-a-finding, PRD
 * refinement) belong in this same ledger under their own command names.
 *
 * @module web/server/dashboard-usage
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TokenUsage } from "@n-dx/llm-client";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Ledger file name, relative to the project directory. */
export const DASHBOARD_USAGE_FILE = ".n-dx-web-usage.jsonl";

/** `command` value for a SourceVision Ask call. */
export const ASK_COMMAND = "ask";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * How the call that produced this record ended.
 *
 * Recorded rather than inferred from the token counts: a successful call can
 * legitimately report zero tokens (some CLI providers count none), so zeros
 * alone cannot tell a caller whether the spend is real or the call failed.
 */
export type DashboardUsageOutcome = "success" | "timeout" | "error";

/** One LLM call made on behalf of a dashboard surface. */
export interface DashboardUsageRecord {
  /** ISO timestamp of the call. */
  timestamp: string;
  /** Dashboard surface that spent the tokens (e.g. {@link ASK_COMMAND}). */
  command: string;
  /** Vendor that served the call. */
  vendor: string;
  /** Model that served the call. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Tokens spent creating prompt-cache entries. Reported, never folded away. */
  cacheCreationTokens: number;
  /** Tokens spent re-reading prompt-cache entries. Reported, never folded away. */
  cacheReadTokens: number;
  /**
   * Calls this record accounts for.
   *
   * `1` for the call itself. `0` for a supplementary record that carries token
   * counts which arrived after the call was already accounted for — a provider
   * finishing after the ask timed out. The same convention the hench extractor
   * uses for its run-level cache-only event, and it is what keeps a late
   * arrival from counting the call twice.
   */
  calls: number;
  outcome: DashboardUsageOutcome;
}

// ---------------------------------------------------------------------------
// Path
// ---------------------------------------------------------------------------

/** Absolute path of the ledger for a project. */
export function dashboardUsagePath(projectDir: string): string {
  return join(projectDir, DASHBOARD_USAGE_FILE);
}

// ---------------------------------------------------------------------------
// Write
// ---------------------------------------------------------------------------

/**
 * Append one record to the ledger.
 *
 * Best-effort: a ledger that cannot be written must not turn an answered
 * question into a failed request, so a write failure is reported to the caller
 * as `false` rather than thrown. Callers that have already produced an answer
 * have nothing useful to do with the failure; the return value exists so a
 * test can assert the write happened.
 */
export function recordDashboardUsage(
  projectDir: string,
  record: DashboardUsageRecord,
): boolean {
  try {
    appendFileSync(dashboardUsagePath(projectDir), JSON.stringify(record) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Project a provider's {@link TokenUsage} onto the ledger's token fields.
 *
 * An absent usage object becomes zeros rather than absent fields: the
 * aggregator adds these up, and an optional field would make every consumer
 * handle two shapes for the same call.
 */
export function tokenFields(tokens: TokenUsage | undefined): Pick<
  DashboardUsageRecord,
  "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens"
> {
  return {
    inputTokens: tokens?.input ?? 0,
    outputTokens: tokens?.output ?? 0,
    cacheCreationTokens: tokens?.cacheCreationInput ?? 0,
    cacheReadTokens: tokens?.cacheReadInput ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readNumber(raw: Record<string, unknown>, key: string): number {
  const value = raw[key];
  return isFiniteNumber(value) && value >= 0 ? value : 0;
}

function readOutcome(value: unknown): DashboardUsageOutcome {
  return value === "success" || value === "timeout" || value === "error" ? value : "error";
}

/**
 * Parse one ledger line, or return null when it is not a usable record.
 *
 * A record without a timestamp is dropped rather than defaulted to now: the
 * aggregator's `since`/`until` window would otherwise place historical spend
 * in today's bucket, which is worse than not counting it.
 */
function parseRecord(line: string): DashboardUsageRecord | null {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const timestamp = obj["timestamp"];
  if (typeof timestamp !== "string" || timestamp.length === 0) return null;

  return {
    timestamp,
    command: typeof obj["command"] === "string" && obj["command"] ? obj["command"] : ASK_COMMAND,
    vendor: typeof obj["vendor"] === "string" && obj["vendor"] ? obj["vendor"] : "unknown",
    model: typeof obj["model"] === "string" && obj["model"] ? obj["model"] : "unknown",
    inputTokens: readNumber(obj, "inputTokens"),
    outputTokens: readNumber(obj, "outputTokens"),
    cacheCreationTokens: readNumber(obj, "cacheCreationTokens"),
    cacheReadTokens: readNumber(obj, "cacheReadTokens"),
    calls: readNumber(obj, "calls"),
    outcome: readOutcome(obj["outcome"]),
  };
}

/**
 * Read every usable record from the ledger.
 *
 * A missing file is an empty ledger, not an error — the dashboard has simply
 * not spent anything yet. Unparseable lines are skipped individually so one
 * torn write cannot hide the rest of the history.
 */
export function readDashboardUsage(projectDir: string): DashboardUsageRecord[] {
  const path = dashboardUsagePath(projectDir);
  if (!existsSync(path)) return [];

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return [];
  }

  const records: DashboardUsageRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = parseRecord(trimmed);
    if (record) records.push(record);
  }
  return records;
}
