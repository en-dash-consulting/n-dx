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
 * ## What this deliberately does not do
 *
 * It does not price the tokens, and it does not try to split one message's usage
 * across concurrent work. A record claims the spend that happened between it and
 * the record before it — which is the honest granularity available from an
 * append-only transcript.
 *
 * @module hench/store/session-usage
 */

import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
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
}

/** A session that has had nothing attributed yet. */
export const EMPTY_CURSOR: SessionUsageCursor = { consumed: 0 };

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

interface TranscriptEntry {
  uuid?: string;
  timestamp?: string;
  message?: { model?: string; usage?: Record<string, unknown> };
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
  const entries: TranscriptEntry[] = [];

  for (const line of transcript.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let parsed: TranscriptEntry;
    try {
      parsed = JSON.parse(line) as TranscriptEntry;
    } catch {
      // A half-written final line is normal: the transcript is appended to while
      // the session runs, so a read can land mid-write.
      continue;
    }
    if (parsed?.message?.usage) entries.push(parsed);
  }

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

  const tokenUsage: Required<TokenUsage> = {
    input: 0,
    output: 0,
    cacheCreationInput: 0,
    cacheReadInput: 0,
  };
  let model: string | undefined;

  for (const entry of fresh) {
    const usage = entry.message?.usage ?? {};
    tokenUsage.input += numeric(usage.input_tokens);
    tokenUsage.output += numeric(usage.output_tokens);
    tokenUsage.cacheCreationInput += numeric(usage.cache_creation_input_tokens);
    tokenUsage.cacheReadInput += numeric(usage.cache_read_input_tokens);
    if (entry.message?.model) model = entry.message.model;
  }

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
      // does not move it and a later one still sees the right window.
      lastUuid: lastScanned?.uuid ?? cursor.lastUuid,
      consumed: startAt + scanned.length,
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

  const configDir = opts.configDir ?? join(opts.home ?? homedir(), ".claude");
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
      await readFile(candidate, { encoding: "utf-8", flag: "r" });
      return candidate;
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
    return {
      lastUuid: typeof parsed.lastUuid === "string" ? parsed.lastUuid : undefined,
      consumed: numeric(parsed.consumed),
    };
  } catch {
    // Losing a watermark costs accuracy on one record; throwing would cost the
    // record, which is the thing being audited.
    return EMPTY_CURSOR;
  }
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
