/**
 * The session ledger: the typed notes a Sidecar agent leaves when its context
 * is about to be refreshed, and how they are read back into the cold turn.
 *
 * One JSONL file per session beside the transcript (`<id>.ledger.jsonl`). The
 * broker appends through `ledger_append`; the registry reads when it starts a
 * cold session. Both go through here so the file has one writer and one reader.
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.4.
 */

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ensureSidecarDir } from "./sidecar-dir.js";

export const LEDGER_ENTRY_TYPES = ["decision", "gotcha", "verified", "unfinished", "changed"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
/** Longest ledger entry, the `handoff-notes.md` format's cap. */
export const LEDGER_ENTRY_MAX_CHARS = 240;
/** Most characters of ledger a cold turn's prompt carries. */
export const LEDGER_RENDER_MAX_CHARS = 3_000;

export interface LedgerEntry {
  at: string;
  type: LedgerEntryType;
  text: string;
}

function ledgerPath(dir: string, sessionId: string): string {
  return join(dir, `${sessionId}.ledger.jsonl`);
}

/** Append a typed entry to the session's ledger; throws on an unknown type or an over-long text. */
export function appendLedgerEntry(dir: string, sessionId: string, entry: LedgerEntry): void {
  if (!LEDGER_ENTRY_TYPES.includes(entry.type)) throw new Error(`Unknown ledger entry type "${entry.type}"`);
  if (entry.text.length > LEDGER_ENTRY_MAX_CHARS) {
    throw new Error(`A ledger entry is at most ${LEDGER_ENTRY_MAX_CHARS} characters (got ${entry.text.length})`);
  }
  ensureSidecarDir(dir);
  appendFileSync(ledgerPath(dir, sessionId), JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * The session's ledger, oldest first. Every entry is written with a trailing
 * newline, so a final line without one is a crash mid-append and is skipped;
 * a malformed line anywhere else is real corruption and throws.
 */
export function readLedger(dir: string, sessionId: string): LedgerEntry[] {
  const path = ledgerPath(dir, sessionId);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, "utf-8").split("\n");
  lines.pop(); // "" after a clean final newline, else the partial fragment
  const entries: LedgerEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as LedgerEntry);
    } catch (error) {
      throw new Error(`${path} line ${index + 1} is not a ledger entry: ${(error as Error).message}`);
    }
  }
  return entries;
}

export interface RenderedLedger {
  text: string;
  /** Entries the text carries: the newest that fit. */
  carried: number;
}

function omittedLine(count: number): string {
  return `(${count} older note${count === 1 ? "" : "s"} left out to fit)`;
}

/**
 * The ledger as prompt text within `max` characters. The newest entries win:
 * older ones are left out, and the text says how many.
 */
export function renderLedger(entries: readonly LedgerEntry[], max = LEDGER_RENDER_MAX_CHARS): RenderedLedger {
  const lines = entries.map((e) => `- [${e.type}] ${e.text}`);
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const cost = lines[i]!.length + 1;
    // Room for the "left out" line when an older entry remains.
    const reserve = i > 0 ? omittedLine(i).length + 1 : 0;
    if (used + cost + reserve > max) break;
    kept.unshift(lines[i]!);
    used += cost;
  }
  const omitted = lines.length - kept.length;
  const text = omitted > 0 ? [omittedLine(omitted), ...kept].join("\n") : kept.join("\n");
  return { text, carried: kept.length };
}
