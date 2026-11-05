/**
 * The hub session's spend ledger: `<ndx home>/hub/usage.jsonl`.
 *
 * The hub session is one per machine and runs on whichever project server
 * hosts it, so its spend belongs to no project. A host appends each finished
 * turn here instead of to its own dashboard usage ledger, which would show
 * machine-wide spend as that project's and split it whenever the host changes.
 * The hub home reads the total back from this file.
 *
 * Append-only JSONL, one line per turn, best-effort on write: a ledger that
 * cannot be written must not fail a turn that already answered.
 *
 * @module web/hub/usage-ledger
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { hubSidecarDir } from "./session-host.js";

/** One finished hub turn. */
export interface HubUsageRecord {
  timestamp: string;
  command: string;
  vendor: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  calls: number;
  outcome: "success" | "error";
  lens?: string;
  /** The project server that hosted the turn; informational, never a bucket. */
  host?: string;
}

export interface HubUsageTotals {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** `<hubHome>/hub/usage.jsonl`, beside the session directory and ledger. */
export function hubUsagePath(hubHome: string): string {
  return join(dirname(hubSidecarDir(hubHome)), "usage.jsonl");
}

/** Append one record; false when it could not be written. */
export function recordHubUsage(hubHome: string, record: HubUsageRecord): boolean {
  try {
    const path = hubUsagePath(hubHome);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(record) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Sum the ledger. A missing file or a torn or foreign line costs only itself. */
export function readHubUsageTotals(hubHome: string): HubUsageTotals {
  const totals: HubUsageTotals = { turns: 0, inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  const path = hubUsagePath(hubHome);
  if (!existsSync(path)) return totals;
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return totals;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    totals.turns += count(obj["calls"]);
    totals.inputTokens += count(obj["inputTokens"]);
    totals.outputTokens += count(obj["outputTokens"]);
    totals.cacheCreationTokens += count(obj["cacheCreationTokens"]);
    totals.cacheReadTokens += count(obj["cacheReadTokens"]);
  }
  return totals;
}
