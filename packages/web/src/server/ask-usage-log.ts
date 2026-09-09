/**
 * Ask spend ledger — the accounting path for `POST /api/sourcevision/ask`.
 *
 * ## Why a file at all
 *
 * Every other n-dx surface that spends tokens leaves a durable trace that the
 * rollup reads back off disk: hench writes `.hench/runs/*.json`, rex appends
 * `*_token_usage` events to `.rex/execution-log.jsonl`, and analyze stamps
 * `.sourcevision/manifest.json`. The ask endpoint returned its token counts
 * in the HTTP response and then forgot them, which made the dashboard's own
 * LLM spend the one spend invisible in the very view that reports spend.
 *
 * This module is that missing trace: one append-only JSONL line per ask, in
 * `.sourcevision/ask-usage.jsonl`.
 *
 * ## Why `.sourcevision/` and the `sv` bucket
 *
 * An ask is not task-scoped, so it is not attributed to a PRD item. It is
 * SourceVision spend: routed under the `sourcevision.ask` task class and
 * grounded in the `.sourcevision/` analysis, alongside the `analyze` spend
 * the manifest already reports. It therefore lands in the existing `sv`
 * package bucket with `command: "ask"`, which is what distinguishes it from
 * hench's `command: "run"` in the per-command breakdown — rather than adding
 * a fourth package bucket to every aggregate shape, CLI table and view.
 *
 * `sv reset` clears this file along with the rest of the analysis (it backs
 * the directory up first); `analyze` does not.
 *
 * ## Readers live elsewhere, on purpose
 *
 * Two readers consume this format and neither imports this module:
 * `routes-token-usage.ts` for the dashboard and `rex/src/core/token-usage.ts`
 * for `ndx usage`. Both read on-disk artifacts directly rather than coupling
 * to the producing package — the same convention by which rex reads hench's
 * run files. Changing the field names below means changing all three.
 *
 * @module web/server/ask-usage-log
 * @see packages/web/src/server/routes-sourcevision-ask.ts — the only producer
 * @see packages/web/src/server/routes-token-usage.ts — dashboard reader
 * @see packages/rex/src/core/token-usage.ts — `ndx usage` reader
 */

import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** File name inside `.sourcevision/`. */
export const ASK_USAGE_FILE = "ask-usage.jsonl";

/**
 * How an ask ended. Recorded so a reader can tell spend that produced an
 * answer from spend that did not — a failed ask still costs money.
 *
 * - `answered` — the provider returned text.
 * - `error` — the provider or the request failed. Token counts are usually
 *   zero because `ClaudeClientError` carries no usage; the entry exists so
 *   the attempt is visible rather than assumed free.
 * - `timeout` — the wall-clock budget elapsed. The provider call is *not*
 *   cancelled by the timeout, so a late-resolving call is recorded as a
 *   second entry with its real usage (see {@link AskUsageEntry.late}).
 */
export type AskOutcome = "answered" | "error" | "timeout";

/**
 * One ask's spend.
 *
 * Field names deliberately mirror the rollup's `TokenEvent` (`inputTokens`,
 * `cacheCreationTokens`, …) so both readers can project an entry onto an
 * event without a translation table.
 */
export interface AskUsageEntry {
  /** ISO-8601 timestamp of when the ask was answered or failed. */
  timestamp: string;
  vendor: string;
  model: string;
  /** Routed tier for the `sourcevision.ask` task class. */
  tier: string;
  outcome: AskOutcome;
  /** Wall-clock duration of the provider call in milliseconds. */
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /**
   * True when this entry was written after the endpoint had already given up
   * on the call — a timed-out ask whose provider answered anyway. The tokens
   * were really spent, so they are recorded, but no user ever saw the answer.
   */
  late?: boolean;
}

/** Zeroed counts, for an outcome that reported no usage. */
export const NO_ASK_TOKENS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationTokens: 0,
  cacheReadTokens: 0,
} as const;

/**
 * Append one ask to the ledger.
 *
 * Best-effort by contract: a ledger write must never turn a successful ask
 * into a failed HTTP response, so every filesystem error is swallowed and
 * reported through the return value instead. Losing an accounting line is
 * bad; losing the answer the user paid for is worse.
 *
 * @returns true when the line was written.
 */
export function recordAskUsage(svDir: string, entry: AskUsageEntry): boolean {
  try {
    mkdirSync(svDir, { recursive: true });
    appendFileSync(join(svDir, ASK_USAGE_FILE), `${JSON.stringify(entry)}\n`, "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Read every well-formed entry from the ledger, oldest first.
 *
 * A truncated final line (an append interrupted mid-write) or a line from a
 * future field layout is skipped rather than thrown: a corrupt line must cost
 * its own accounting, not the whole report's.
 */
export function readAskUsageEntries(svDir: string): AskUsageEntry[] {
  let raw: string;
  try {
    raw = readFileSync(join(svDir, ASK_USAGE_FILE), "utf-8");
  } catch {
    return [];
  }

  const entries: AskUsageEntry[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const normalized = normalizeEntry(parsed);
      if (normalized) entries.push(normalized);
    } catch {
      // Unparseable line — skip.
    }
  }
  return entries;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

/**
 * Narrow an arbitrary parsed line into an entry.
 *
 * A timestamp is the one required field — without it the entry cannot be
 * placed in a time range or a period bucket, so it would silently distort
 * every filtered report it appeared in.
 */
function normalizeEntry(parsed: unknown): AskUsageEntry | null {
  if (!parsed || typeof parsed !== "object") return null;
  const raw = parsed as Record<string, unknown>;
  const timestamp = typeof raw.timestamp === "string" ? raw.timestamp : "";
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) return null;

  const outcome = raw.outcome;
  return {
    timestamp,
    vendor: str(raw.vendor, "unknown"),
    model: str(raw.model, "unknown"),
    tier: str(raw.tier, "unknown"),
    outcome:
      outcome === "answered" || outcome === "error" || outcome === "timeout"
        ? outcome
        : "answered",
    durationMs: num(raw.durationMs),
    inputTokens: num(raw.inputTokens),
    outputTokens: num(raw.outputTokens),
    cacheCreationTokens: num(raw.cacheCreationTokens),
    cacheReadTokens: num(raw.cacheReadTokens),
    ...(raw.late === true ? { late: true } : {}),
  };
}
