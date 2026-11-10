/**
 * The session ledger: the typed notes a Sidecar agent leaves when its context
 * is about to be refreshed, and how they are read back into the cold turn.
 *
 * A worktree session's ledger is one JSONL file beside its transcript
 * (`<id>.ledger.jsonl`). The hub session's belongs to the machine, not to one
 * session: `<ndx home>/hub/ledger.jsonl`, so a hub session opened after
 * another ended still reads it. The agent appends through the broker's
 * `ledger_append`; the registry reads it for every turn that carries the
 * ledger. Both go through here, so each file has one writer and one reader.
 *
 * `handoff` is the one type no agent writes: the hub's "Open in worktree
 * sidecar" leaves it in the worktree session's ledger, naming the hub's
 * question (the handoff route in `routes-sidecar.ts`).
 *
 * Design: local-design-workshop/docs/analysis/sidecar/README.md §4.4, §6.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, truncateSync } from "node:fs";
import { dirname, join } from "node:path";

export const LEDGER_ENTRY_TYPES = ["decision", "gotcha", "verified", "unfinished", "changed", "decision-needed", "handoff"] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];
/** What a worktree session's agent may write through `ledger_append`. */
export const WORKTREE_LEDGER_TYPES = ["decision", "gotcha", "verified", "unfinished", "changed"] as const satisfies readonly LedgerEntryType[];
/** What the hub session's agent may write: a worktree's types plus a decision the operator still has to make. */
export const HUB_LEDGER_TYPES = [...WORKTREE_LEDGER_TYPES, "decision-needed"] as const satisfies readonly LedgerEntryType[];
/** Longest ledger entry, the `handoff-notes.md` format's cap. */
export const LEDGER_ENTRY_MAX_CHARS = 240;
/** Most characters of ledger a cold turn's prompt carries. */
export const LEDGER_RENDER_MAX_CHARS = 3_000;

export interface LedgerEntry {
  at: string;
  type: LedgerEntryType;
  text: string;
}

/** A worktree session's ledger, beside its transcript in the Sidecar directory. */
export function sessionLedgerPath(dir: string, sessionId: string): string {
  return join(dir, `${sessionId}.ledger.jsonl`);
}

/** Append a typed entry to the ledger of `sessionId` in `dir`; see {@link appendLedgerEntryAt}. */
export function appendLedgerEntry(dir: string, sessionId: string, entry: LedgerEntry): void {
  appendLedgerEntryAt(sessionLedgerPath(dir, sessionId), entry);
}

/** Append a typed entry to the ledger at `path`; throws on an unknown type or an over-long text. */
export function appendLedgerEntryAt(path: string, entry: LedgerEntry): void {
  if (!LEDGER_ENTRY_TYPES.includes(entry.type)) throw new Error(`Unknown ledger entry type "${entry.type}"`);
  if (entry.text.length > LEDGER_ENTRY_MAX_CHARS) {
    throw new Error(`A ledger entry is at most ${LEDGER_ENTRY_MAX_CHARS} characters (got ${entry.text.length})`);
  }
  mkdirSync(dirname(path), { recursive: true });
  dropPartialTail(path);
  appendFileSync(path, JSON.stringify(entry) + "\n", "utf-8");
}

/**
 * A server killed mid-append leaves a last line without its newline; the next
 * append would glue an entry onto it and leave a malformed line mid-file. Move
 * the fragment to `<file>.corrupt` and cut it from the ledger.
 */
function dropPartialTail(path: string): void {
  if (!existsSync(path)) return;
  const bytes = readFileSync(path);
  if (bytes.length === 0 || bytes[bytes.length - 1] === 0x0a) return;
  const keep = bytes.lastIndexOf(0x0a) + 1;
  appendFileSync(`${path}.corrupt`, Buffer.concat([bytes.subarray(keep), Buffer.from("\n")]));
  truncateSync(path, keep);
}

/**
 * The session's ledger, oldest first. Every entry is written with a trailing
 * newline, so a final line without one is a crash mid-append and is skipped;
 * a malformed line anywhere else is real corruption and throws.
 */
export function readLedger(dir: string, sessionId: string): LedgerEntry[] {
  return readLedgerAt(sessionLedgerPath(dir, sessionId));
}

/** The ledger at `path`, oldest first; see {@link readLedger}. */
export function readLedgerAt(path: string): LedgerEntry[] {
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

/**
 * The project-server read the hub snapshot takes per worktree: each open
 * Sidecar session's latest `unfinished` and `decision` notes. Sessions with
 * neither are left out.
 */
export const SIDECAR_LEDGER_LATEST_PATH = "/api/sidecar/ledger/latest";

export interface SidecarLedgerLatestResponse {
  sessions: Array<{ id: string; name: string; unfinished?: LedgerEntry; decision?: LedgerEntry }>;
}

/** The newest entry of each of `types`; a type with no entry is absent. */
export function latestLedgerEntries<T extends LedgerEntryType>(
  entries: readonly LedgerEntry[],
  types: readonly T[],
): Partial<Record<T, LedgerEntry>> {
  const latest: Partial<Record<T, LedgerEntry>> = {};
  for (const entry of entries) {
    if ((types as readonly LedgerEntryType[]).includes(entry.type)) latest[entry.type as T] = entry;
  }
  return latest;
}
