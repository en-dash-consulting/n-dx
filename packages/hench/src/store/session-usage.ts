/**
 * Read a Claude Code session's own token usage from its transcript.
 *
 * Assisted runs — task work driven through the `/ndx-work` skill rather than a
 * spawned hench agent — used to record zero tokens, on the stated grounds that
 * "Claude Code does not expose its own token consumption to the running skill".
 * That is true of the tool surface and false of the filesystem: Claude Code
 * writes a JSONL transcript per session in which every assistant message carries
 * the API's `usage` object, and it exports `CLAUDE_CODE_SESSION_ID` to the tools
 * it runs. The numbers are therefore readable, and recording them beats
 * recording zeros.
 *
 * ## Why a cursor rather than a total
 *
 * One session routinely completes several tasks; the session this was built in
 * completed four. Summing the transcript at each `hench record` would attribute
 * the same tokens once per task — with cache reads in the tens of millions, the
 * over-count dwarfs the real figure. So each record takes only what accumulated
 * since the previous one, and the watermark is persisted per session under
 * `.hench/usage-cursors/`.
 *
 * The cursor holds both a message uuid and a count. The uuid is exact; the count
 * is the fallback, because transcripts are rewritten on compaction and a
 * remembered uuid can simply be gone. Re-summing from the top in that case would
 * double-count everything already recorded, so the count is used instead and the
 * caller is told the cursor was resynced.
 *
 * ## Marks: the start of a task, written by code
 *
 * A watermark says where the LAST record ended, which is the wrong boundary for
 * the first task in a session and for any task that began after unrelated
 * conversation. The skills used to close that gap by asking the model to type
 * the current time and pass it as `--startedAt`, and the delta filtered
 * messages by timestamp. That made the measurement depend on free text a model
 * produced. A {@link UsageMark} replaces it: `hench usage mark --task=<id>`
 * snapshots the transcript's cumulative usage and position at the moment the
 * task starts, and `hench record` computes the task's spend as the difference
 * between that snapshot and the transcript now — in code, from two positions
 * in the same file. Marks live beside the watermark in the session's cursor
 * file, keyed by task.
 *
 * ## What this deliberately does not do
 *
 * It does not price the tokens, and it does not try to split one message's usage
 * across concurrent work. A record claims the spend that happened between two
 * positions in an append-only transcript — which is the honest granularity
 * available from one.
 *
 * @module hench/store/session-usage
 */

import { readFile, readdir, stat, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TokenUsage } from "../schema/index.js";

/** Where Claude Code keeps per-project transcripts, relative to the config dir. */
const PROJECTS_SUBDIR = "projects";

/** Directory under `.hench/` holding one watermark file per session. */
const CURSOR_SUBDIR = "usage-cursors";

/** How far through a session's transcript a previous record already accounted. */
export interface SessionUsageCursor {
  /**
   * uuid of the last transcript message attributed. Exact when the transcript
   * still contains it.
   */
  lastUuid?: string;
  /** How many usage-bearing messages have been attributed. The fallback. */
  consumed: number;
  /**
   * Start-of-task snapshots not yet consumed by a record, keyed by the task id
   * they were taken for. Absent in cursor files written before marks existed.
   */
  marks?: Record<string, UsageMark>;
}

/**
 * Where a task started, as a position in the session transcript plus the
 * cumulative usage up to it. Written by `hench usage mark`, consumed by
 * `hench record`, which reports the difference between it and the transcript
 * at record time.
 */
export interface UsageMark {
  /** The task (or `skill:<name>`) this mark was taken for. */
  task: string;
  /** When the mark was taken (ISO-8601). Metadata — never used to filter usage. */
  at: string;
  /** uuid of the last usage-bearing message at mark time. The exact boundary. */
  lastUuid?: string;
  /** Usage-bearing messages up to and including the boundary. The fallback. */
  consumed: number;
  /** Cumulative usage of the whole transcript at mark time, per token class. */
  totals: Required<TokenUsage>;
}

/** A session that has had nothing attributed yet. */
export const EMPTY_CURSOR: SessionUsageCursor = { consumed: 0 };

/** Cumulative usage of a whole transcript, plus where it currently ends. */
export interface TranscriptUsageSnapshot {
  totals: Required<TokenUsage>;
  /** Usage-bearing messages in the transcript. */
  messages: number;
  /** uuid of the last usage-bearing message, when it has one. */
  lastUuid?: string;
  /** Model of the last usage-bearing message. */
  model?: string;
}

export interface SessionUsageDelta {
  /** Usage accumulated since the cursor, in hench's own shape. */
  tokenUsage: Required<TokenUsage>;
  /** How many assistant messages contributed. Zero means nothing new. */
  messages: number;
  /** Model of the most recent contributing message, when there was one. */
  model?: string;
  /** Where to resume next time. */
  cursor: SessionUsageCursor;
  /**
   * True when `lastUuid` was not found and the count-based fallback was used —
   * the transcript was rewritten under us, so the delta is approximate.
   */
  resynced: boolean;
}

/** What `hench record` reports when it consumed a mark. */
export interface MarkedUsageDelta extends SessionUsageDelta {
  /** The two positions the delta was taken between. */
  from: { lastUuid?: string; consumed: number };
  to: { lastUuid?: string; consumed: number };
}

interface TranscriptEntry {
  uuid?: string;
  timestamp?: string;
  message?: { model?: string; usage?: Record<string, unknown> };
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Every usage-bearing transcript line, parsed. A half-written tail line is skipped. */
function parseUsageEntries(transcript: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: TranscriptEntry;
    try {
      parsed = JSON.parse(line) as TranscriptEntry;
    } catch {
      // The transcript is appended to while the session runs, so a read can
      // land mid-write; the partial line is the next read's problem.
      continue;
    }
    if (parsed?.message?.usage) entries.push(parsed);
  }
  return entries;
}

function zeroUsage(): Required<TokenUsage> {
  return { input: 0, output: 0, cacheCreationInput: 0, cacheReadInput: 0 };
}

/** Sum the usage of some entries, and note the last model seen. */
function sumUsage(entries: TranscriptEntry[]): { totals: Required<TokenUsage>; model?: string } {
  const totals = zeroUsage();
  let model: string | undefined;
  for (const entry of entries) {
    const usage = entry.message?.usage ?? {};
    totals.input += numeric(usage.input_tokens);
    totals.output += numeric(usage.output_tokens);
    totals.cacheCreationInput += numeric(usage.cache_creation_input_tokens);
    totals.cacheReadInput += numeric(usage.cache_read_input_tokens);
    if (entry.message?.model) model = entry.message.model;
  }
  return { totals, model };
}

/**
 * The whole transcript's cumulative usage and its current end. This is what a
 * mark records, and what a record compares against.
 */
export function snapshotTranscriptUsage(transcript: string): TranscriptUsageSnapshot {
  const entries = parseUsageEntries(transcript);
  const { totals, model } = sumUsage(entries);
  const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
  return { totals, messages: entries.length, lastUuid: last?.uuid, model };
}

/** Build a mark for `task` from the transcript as it stands now. */
export function takeUsageMark(transcript: string, task: string, at = new Date().toISOString()): UsageMark {
  const snapshot = snapshotTranscriptUsage(transcript);
  return { task, at, lastUuid: snapshot.lastUuid, consumed: snapshot.messages, totals: snapshot.totals };
}

/**
 * The usage that appeared after `mark`.
 *
 * Exact when the mark's uuid is still in the transcript: the messages after it
 * are summed directly. When it is not (compaction rewrote the file, or the mark
 * was taken on an empty transcript), the fallback is arithmetic on the two
 * snapshots — now minus then, per class, clamped at zero — and `resynced`
 * says the number is approximate. Either way the result is computed from two
 * positions in the same file; no timestamp is consulted.
 */
export function readUsageSinceMark(transcript: string, mark: UsageMark): MarkedUsageDelta {
  const entries = parseUsageEntries(transcript);
  const now = snapshotTranscriptUsage(transcript);

  let tokenUsage: Required<TokenUsage>;
  let messages: number;
  let model: string | undefined;
  let resynced = false;

  const boundary = mark.lastUuid ? entries.findIndex((e) => e.uuid === mark.lastUuid) : -1;
  if (boundary !== -1) {
    const tail = entries.slice(boundary + 1);
    ({ totals: tokenUsage, model } = sumUsage(tail));
    messages = tail.length;
  } else if (!mark.lastUuid && mark.consumed === 0) {
    // Marked on an empty transcript: everything since is the task's.
    ({ totals: tokenUsage, model } = sumUsage(entries));
    messages = entries.length;
  } else {
    resynced = true;
    tokenUsage = {
      input: Math.max(0, now.totals.input - mark.totals.input),
      output: Math.max(0, now.totals.output - mark.totals.output),
      cacheCreationInput: Math.max(0, now.totals.cacheCreationInput - mark.totals.cacheCreationInput),
      cacheReadInput: Math.max(0, now.totals.cacheReadInput - mark.totals.cacheReadInput),
    };
    messages = Math.max(0, now.messages - mark.consumed);
    model = now.model;
  }

  return {
    tokenUsage,
    messages,
    model,
    cursor: { lastUuid: now.lastUuid, consumed: now.messages },
    resynced,
    from: { lastUuid: mark.lastUuid, consumed: mark.consumed },
    to: { lastUuid: now.lastUuid, consumed: now.messages },
  };
}

/**
 * Sum the usage that appeared after `cursor`.
 *
 * Takes the transcript's text rather than its path so the parsing is testable
 * without a filesystem, and so a caller that already has the bytes does not read
 * them twice.
 */
export function readUsageDelta(
  transcript: string,
  cursor: SessionUsageCursor,
  /**
   * Ignore messages older than this ISO timestamp.
   *
   * The cursor alone leaves one gap: the FIRST record in a session has no
   * watermark, so it claims everything the session spent before the work even
   * started. Measured while building this — a first record in a long session
   * claimed 549 messages and 127M cache-read tokens, four earlier tasks' spend
   * included. A caller that knows when its work began passes that, and the
   * window starts there instead of at the top of the transcript.
   *
   * Messages before the window are still marked consumed: they have been dealt
   * with — deliberately excluded — and must not resurface in the next record.
   */
  since?: string,
): SessionUsageDelta {
  const entries = parseUsageEntries(transcript);

  // Sidechain (subagent) messages are included deliberately — a subagent's tokens
  // are spend, and the task that launched it is what caused them.
  let startAt: number;
  let resynced = false;

  if (!cursor.lastUuid) {
    startAt = Math.min(cursor.consumed, entries.length);
  } else {
    const found = entries.findIndex((e) => e.uuid === cursor.lastUuid);
    if (found === -1) {
      resynced = true;
      startAt = Math.min(cursor.consumed, entries.length);
    } else {
      startAt = found + 1;
    }
  }

  const scanned = entries.slice(startAt);
  const sinceMs = since ? Date.parse(since) : Number.NaN;
  const fresh = Number.isNaN(sinceMs)
    ? scanned
    : scanned.filter((entry) => {
        // An entry with no parseable timestamp is kept: dropping it would lose
        // real spend on the strength of a missing field.
        const at = entry.timestamp ? Date.parse(entry.timestamp) : Number.NaN;
        return Number.isNaN(at) || at >= sinceMs;
      });

  const { totals: tokenUsage, model } = sumUsage(fresh);

  // The watermark follows everything SCANNED, not just what was claimed: a
  // message excluded by `since` has been dealt with, and leaving it behind the
  // watermark would hand it to the next record.
  const lastScanned = scanned.length > 0 ? scanned[scanned.length - 1] : undefined;

  return {
    tokenUsage,
    messages: fresh.length,
    model,
    cursor: {
      // Hold the previous watermark when nothing was scanned, so a no-op record
      // does not move it and a later one still sees the right window. When
      // something WAS scanned but the tail entry carries no uuid, drop the uuid
      // watermark rather than keep the stale one: lastUuid takes precedence over
      // `consumed` on the next read, so a stale uuid would rewind the window and
      // re-claim everything scanned past it. (Walking back to the last entry
      // that HAS a uuid would be wrong the same way — the uuid-less entries
      // after it would be re-claimed.) With no uuid, `consumed` governs.
      lastUuid: lastScanned ? lastScanned.uuid : cursor.lastUuid,
      consumed: startAt + scanned.length,
      // Marks are the caller's to keep or consume; the delta does not touch them.
      marks: cursor.marks,
    },
    resynced,
  };
}

/**
 * Locate a session's transcript.
 *
 * Searches for the file rather than deriving the project directory's name. That
 * name is a lossy transform of the project path — separators, colons and
 * underscores all collapse to dashes, so `C:\…\Code_Projects\n-dx` becomes
 * `C--Users-…-Code-Projects-n-dx` — and reproducing it is guesswork that breaks
 * on the first path Claude Code encodes differently. Session ids are unique, so
 * the transcript can simply be looked for.
 *
 * Returns null when it cannot be found; a missing transcript must degrade to
 * "record without usage", never to a failed record.
 */
export async function resolveTranscriptPath(
  sessionId: string,
  opts: { home?: string; configDir?: string } = {},
): Promise<string | null> {
  if (!sessionId || !isSafeSessionId(sessionId)) return null;

  // CLAUDE_CONFIG_DIR relocates Claude Code's whole config tree, transcripts
  // included. A user who has set it and does not get it honoured here would
  // silently record zero tokens — the exact failure this module exists to
  // remove — so the environment is consulted before falling back to ~/.claude.
  const configDir =
    opts.configDir ??
    process.env.CLAUDE_CONFIG_DIR ??
    join(opts.home ?? homedir(), ".claude");
  const projectsDir = join(configDir, PROJECTS_SUBDIR);

  let projectDirs: string[];
  try {
    projectDirs = (await readdir(projectsDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return null;
  }

  const filename = `${sessionId}.jsonl`;
  for (const projectDir of projectDirs) {
    const candidate = join(projectsDir, projectDir, filename);
    try {
      // stat, not readFile: transcripts reach tens of MB, and the caller reads
      // the file itself — probing with a full read would do all that I/O twice.
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Not in this project directory.
    }
  }

  return null;
}

/**
 * Whether a session id is safe to use as a filename.
 *
 * The id arrives from the environment and lands in a path, so it is checked
 * rather than trusted. Claude Code uses uuids; this allows that shape plus the
 * conservative extras a future format might add.
 */
function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(sessionId) && !sessionId.startsWith(".");
}

function cursorPath(henchDir: string, sessionId: string): string {
  if (!isSafeSessionId(sessionId)) {
    throw new Error(
      `Refusing to use session id "${sessionId}" as a filename — it must contain only letters, digits, dot, dash or underscore.`,
    );
  }
  return join(henchDir, CURSOR_SUBDIR, `${sessionId}.json`);
}

/** Read a session's watermark. An absent or unreadable one reads as empty. */
export async function loadUsageCursor(
  henchDir: string,
  sessionId: string,
): Promise<SessionUsageCursor> {
  const path = cursorPath(henchDir, sessionId);
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as Partial<SessionUsageCursor>;
    const marks = readMarks(parsed.marks);
    return {
      lastUuid: typeof parsed.lastUuid === "string" ? parsed.lastUuid : undefined,
      consumed: numeric(parsed.consumed),
      ...(marks ? { marks } : {}),
    };
  } catch {
    // Losing a watermark costs accuracy on one record; throwing would cost the
    // record, which is the thing being audited.
    return EMPTY_CURSOR;
  }
}

/** Validate the marks map of a cursor file; malformed entries are dropped, not fatal. */
function readMarks(raw: unknown): Record<string, UsageMark> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const marks: Record<string, UsageMark> = {};
  for (const [task, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const m = value as Partial<UsageMark>;
    const totals = (m.totals ?? {}) as Partial<Required<TokenUsage>>;
    marks[task] = {
      task,
      at: typeof m.at === "string" ? m.at : "",
      lastUuid: typeof m.lastUuid === "string" ? m.lastUuid : undefined,
      consumed: numeric(m.consumed),
      totals: {
        input: numeric(totals.input),
        output: numeric(totals.output),
        cacheCreationInput: numeric(totals.cacheCreationInput),
        cacheReadInput: numeric(totals.cacheReadInput),
      },
    };
  }
  return Object.keys(marks).length > 0 ? marks : undefined;
}

/**
 * Record a start-of-task mark in the session's cursor file. Re-marking the same
 * task overwrites — a restarted task starts where it restarted.
 */
export async function saveUsageMark(henchDir: string, sessionId: string, mark: UsageMark): Promise<void> {
  const cursor = await loadUsageCursor(henchDir, sessionId);
  await saveUsageCursor(henchDir, sessionId, {
    ...cursor,
    marks: { ...(cursor.marks ?? {}), [mark.task]: mark },
  });
}

/** Persist a session's watermark. */
export async function saveUsageCursor(
  henchDir: string,
  sessionId: string,
  cursor: SessionUsageCursor,
): Promise<void> {
  const path = cursorPath(henchDir, sessionId);
  await mkdir(join(henchDir, CURSOR_SUBDIR), { recursive: true });
  await writeFile(path, `${JSON.stringify(cursor, null, 2)}\n`, "utf-8");
}
