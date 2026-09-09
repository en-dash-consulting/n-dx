/**
 * Per-ask token spend, appended to `.sourcevision/ask-usage.jsonl`.
 *
 * `POST /api/sourcevision/ask` is the only place n-dx spends tokens without
 * leaving a trace: a hench run writes `.hench/runs/<id>.json`, a rex command
 * writes an `execution-log.jsonl` entry, an analysis writes its totals into
 * `manifest.json` — an ask wrote nothing, so the dashboard's own model spend
 * was invisible in the very view that reports token usage. This is that trace.
 *
 * ## Why `.sourcevision/`, and why a new file
 *
 * An ask is a SourceVision-surface action grounded in SourceVision output, so
 * its spend belongs beside the analysis it was spent on. The three existing
 * sinks were all wrong for it: `.hench/runs/` is agent runs, the rex execution
 * log is rex's, and `manifest.json` is analysis output that a re-analysis
 * overwrites. A fourth top-level dot-directory for one log would be a bigger
 * decision than one route needs.
 *
 * `sv reset` clears this along with the rest of `.sourcevision/` — that is the
 * explicit "start over" command and it backs the directory up first. Nothing
 * else removes it, and the file is gitignored with the rest of the directory.
 *
 * ## Append-only, and why that is fine
 *
 * There is no rotation. A line is ~200 bytes and an ask is a human typing a
 * question, so growth is bounded by how fast someone can ask — unlike the rex
 * execution log, which a loop can fill. The file is machine-local and safe to
 * delete; deleting it loses history, not correctness.
 *
 * ## Recording never fails a request
 *
 * Every write is best-effort. An answer the user is waiting for must not be
 * turned into an error because bookkeeping could not write to disk, so failures
 * here are swallowed. The cost of that choice is a silently missing line, which
 * is strictly better than a lost answer.
 *
 * @module web/server/ask-usage-log
 * @see packages/web/src/server/routes-token-usage.ts — reads these back
 * @see packages/web/src/server/aggregation-cache.ts — fingerprints this file
 */

import { appendFile, readFile } from "node:fs/promises";
import { join } from "node:path";

/** Name of the log within `.sourcevision/`. */
export const ASK_USAGE_FILE = "ask-usage.jsonl";

/** Absolute path to the ask usage log for a given `.sourcevision/` directory. */
export function askUsageLogPath(svDir: string): string {
  return join(svDir, ASK_USAGE_FILE);
}

/**
 * One ask's spend.
 *
 * Cache tokens are separate fields rather than folded into `inputTokens`,
 * matching what hench and rex record — the decision to report cache tokens
 * rather than hide them was made for those and applies here for the same
 * reason: they are most of the bill on a cached context.
 */
export interface AskUsageEntry {
  /** ISO-8601 timestamp of when the ask completed (or failed). */
  timestamp: string;
  /** Vendor that produced (or failed to produce) the answer. */
  vendor: string;
  /** Model resolved from project config. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** False when the model call failed — the spend is still recorded. */
  ok: boolean;
  /**
   * Classified failure reason (`auth`, `timeout`, `rate-limit`, …) when `ok`
   * is false. Kept so a run of failed asks is legible as such rather than
   * looking like a run of free ones.
   */
  reason?: string;
}

/**
 * Append one entry. Never throws — see the module docblock.
 *
 * @returns true when the line was written, false when it was dropped
 */
export async function recordAskUsage(
  svDir: string,
  entry: AskUsageEntry,
): Promise<boolean> {
  try {
    await appendFile(askUsageLogPath(svDir), `${JSON.stringify(entry)}\n`, "utf-8");
    return true;
  } catch {
    // Bookkeeping must not fail the answer.
    return false;
  }
}

/**
 * Normalise a `TokenUsage` from `@n-dx/llm-client` into an entry's counters.
 *
 * The cache fields are optional on that type and absent for providers that do
 * not report them; absent means zero, not unknown, because a provider that
 * reports usage at all reports the cache fields when they are non-zero.
 */
export function askUsageCounters(usage?: {
  input?: number;
  output?: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
} | null): Pick<
  AskUsageEntry,
  "inputTokens" | "outputTokens" | "cacheCreationTokens" | "cacheReadTokens"
> {
  return {
    inputTokens: usage?.input ?? 0,
    outputTokens: usage?.output ?? 0,
    cacheCreationTokens: usage?.cacheCreationInput ?? 0,
    cacheReadTokens: usage?.cacheReadInput ?? 0,
  };
}

/** True when `value` has the shape of an entry we can aggregate. */
function isAskUsageEntry(value: unknown): value is AskUsageEntry {
  if (typeof value !== "object" || value === null) return false;
  const e = value as Record<string, unknown>;
  return typeof e.timestamp === "string" && typeof e.inputTokens === "number";
}

/**
 * Read every entry back.
 *
 * A malformed line is skipped rather than failing the read: the file is
 * appended to by a live server, so a torn final line is a real possibility and
 * losing one ask's figures is better than losing the whole history.
 */
export async function readAskUsage(svDir: string): Promise<AskUsageEntry[]> {
  let raw: string;
  try {
    raw = await readFile(askUsageLogPath(svDir), "utf-8");
  } catch {
    return [];
  }

  const entries: AskUsageEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isAskUsageEntry(parsed)) entries.push(parsed);
    } catch {
      // Torn or hand-edited line — skip it.
    }
  }
  return entries;
}
