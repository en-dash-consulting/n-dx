import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { saveRun } from "../../store/runs.js";
import { loadConfig } from "../../store/config.js";
import {
  EMPTY_CURSOR,
  loadUsageCursor,
  readUsageDelta,
  resolveTranscriptPath,
  saveUsageCursor,
  type SessionUsageCursor,
} from "../../store/session-usage.js";
import { HENCH_DIR } from "./constants.js";
import { CLIError } from "../errors.js";
import { result, info, warn } from "../output.js";
import type { RunRecord, RunStatus, TokenUsage } from "../../schema/index.js";
import { resolveActor, resolveHost } from "../../process/actor-identity.js";

const VALID_STATUSES: readonly RunStatus[] = [
  "running",
  "completed",
  "failed",
  "timeout",
  "budget_exceeded",
  "error_transient",
  "cancelled",
];

/** Flags that set token counts by hand, and the field each fills. */
const EXPLICIT_TOKEN_FLAGS = {
  "input-tokens": "input",
  "output-tokens": "output",
  "cache-creation-tokens": "cacheCreationInput",
  "cache-read-tokens": "cacheReadInput",
} as const;

const ZERO_USAGE: Required<TokenUsage> = {
  input: 0,
  output: 0,
  cacheCreationInput: 0,
  cacheReadInput: 0,
};

/**
 * Write a lightweight, assisted run record to `.hench/runs/`.
 *
 * Used by the skills so work driven through Claude Code is visible in run
 * history and auditable after the fact — closing the gap where slash-command
 * work left no `.hench/runs/` entry (issue #271). The record is marked
 * `assisted: true` to distinguish it from a spawned hench agent's run.
 *
 * ## Token usage
 *
 * Assisted records used to carry zeros, on the grounds that Claude Code does not
 * expose its own consumption to the running skill. That holds for the tool
 * surface but not for the filesystem: Claude Code writes a transcript per session
 * whose assistant messages each carry the API's `usage` object, and exports
 * `CLAUDE_CODE_SESSION_ID` to the tools it runs. So usage is read from there by
 * default, and only what accumulated since the previous record for that session
 * is claimed — see {@link readUsageDelta} for why a total would be wrong.
 *
 * Order of precedence:
 *   1. explicit `--input-tokens` / `--output-tokens` / `--cache-*-tokens`
 *   2. the session transcript (default)
 *   3. zeros, when there is no session to read and nothing was passed
 *
 * Zeros remain a valid outcome rather than an error: an unrecorded run is worse
 * than one recorded without its tokens, and `assisted` already marks the record
 * so analytics do not read a 0-token entry as an anomaly.
 */
export async function cmdRecord(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);

  const taskId = flags.task;
  if (!taskId) {
    throw new CLIError(
      "Missing --task.",
      "Usage: hench record --task=<id> [--title=<title>] [--status=completed] [--summary=<text>] [--turns=N] [--no-tokens] [--session=<id>] [--transcript=<path>] [dir]",
    );
  }

  const status = (flags.status ?? "completed") as RunStatus;
  if (!VALID_STATUSES.includes(status)) {
    throw new CLIError(
      `Invalid --status: "${status}"`,
      `Must be one of: ${VALID_STATUSES.join(", ")}`,
    );
  }

  // Validate the usage window up front: an unparseable value used to be
  // silently discarded, which made `--startedAt=25/08/2026` claim the whole
  // session transcript — the exact spend the flag exists to fence off.
  parseWindow(flags.startedAt, "--startedAt");
  parseWindow(flags.since, "--since");

  const explicitTurns = parseCount(flags.turns, "--turns");
  const explicitUsage = readExplicitUsage(flags);

  const config = await loadConfig(henchDir);
  const usage = await resolveUsage(henchDir, flags, explicitUsage);

  const now = new Date().toISOString();

  const run: RunRecord = {
    id: randomUUID(),
    taskId,
    taskTitle: flags.title || taskId,
    startedAt: flags.startedAt || now,
    finishedAt: now,
    status,
    // Each usage-bearing transcript message is one API call, which is what a turn
    // counts — so the message count is a real turn count, not a stand-in.
    turns: explicitTurns ?? usage.messages,
    summary: flags.summary || "Assisted skill run (Claude Code).",
    tokenUsage: usage.tokenUsage,
    toolCalls: [],
    model: flags.model || usage.model || config.model,
    invocationContext: "api",
    assisted: true,
    actor: await resolveActor(dir),
    host: resolveHost(),
  };

  // saveRun derives the normalized `tokens` tuple from `tokenUsage`, so the PRD
  // rollup picks this up by taskId with no further work. The web dashboard's
  // aggregator watches the runs directory, which is what gets it cached.
  await saveRun(henchDir, run);

  if (flags.format === "json") {
    result(
      JSON.stringify(
        {
          id: run.id,
          taskId: run.taskId,
          status: run.status,
          assisted: true,
          turns: run.turns,
          tokenUsage: run.tokenUsage,
          usageSource: usage.source,
        },
        null,
        2,
      ),
    );
    return;
  }

  result(`Recorded assisted run ${run.id} for task ${taskId} (${status}).`);
  info(usage.note);
}

interface ResolvedUsage {
  tokenUsage: Required<TokenUsage>;
  messages: number;
  model?: string;
  source: "flags" | "transcript" | "none";
  note: string;
}

/**
 * Decide what usage this record claims, and advance the session watermark.
 *
 * The watermark advances even when the numbers do not come from the transcript
 * — explicit flags, or `--no-tokens` — because that spend is now accounted for
 * (claimed by hand, or deliberately discarded), and leaving the cursor behind
 * would let the next transcript-derived record claim it instead.
 */
async function resolveUsage(
  henchDir: string,
  flags: Record<string, string>,
  explicitUsage: Required<TokenUsage> | null,
): Promise<ResolvedUsage> {
  const sessionId = flags.session || process.env.CLAUDE_CODE_SESSION_ID || "";
  const transcriptDisabled = flags["no-tokens"] === "true";

  // Even under --no-tokens the transcript is still read, so the watermark can
  // advance past the suppressed spend. A transcript problem must not fail a
  // --no-tokens record, though — the caller asked for no usage at all.
  const transcript = await readTranscript(flags, sessionId, transcriptDisabled);

  // No transcript to read: fall back to whatever was passed, or to zeros.
  if (!transcript) {
    if (explicitUsage) {
      return {
        tokenUsage: explicitUsage,
        messages: 0,
        source: "flags",
        note: "Token usage taken from flags.",
      };
    }
    if (transcriptDisabled) {
      return {
        tokenUsage: ZERO_USAGE,
        messages: 0,
        source: "none",
        note: "Token usage not recorded (--no-tokens).",
      };
    }
    return {
      tokenUsage: ZERO_USAGE,
      messages: 0,
      source: "none",
      note: sessionId
        ? `No transcript found for session ${sessionId} — recorded without token usage.`
        : "No Claude Code session detected (CLAUDE_CODE_SESSION_ID unset) — recorded without token usage.",
    };
  }

  const cursor: SessionUsageCursor = sessionId
    ? await loadUsageCursor(henchDir, sessionId)
    : EMPTY_CURSOR;
  // `--startedAt` doubles as the usage window: a record that says it started at a
  // time cannot also claim what was spent before then. It matters for the FIRST
  // record in a session, which has no watermark and would otherwise claim
  // everything the session had spent before the work began.
  const window = flags.since || flags.startedAt;
  const delta = readUsageDelta(transcript.text, cursor, window);

  // A record with no window and no watermark claims every usage-bearing
  // message the transcript holds — legitimate when the whole session really
  // was this task, wildly wrong otherwise. Say so before it is written.
  const hasWatermark = Boolean(cursor.lastUuid) || cursor.consumed > 0;
  if (!explicitUsage && !transcriptDisabled && !window && !hasWatermark && delta.messages > 0) {
    warn(
      `Warning: no --startedAt/--since and no prior record for this session — ` +
        `claiming all ${delta.messages} usage-bearing message${delta.messages === 1 ? "" : "s"} in the transcript. ` +
        `Pass --startedAt=<when the work began> to claim only this task's spend.`,
    );
  }

  if (sessionId) await saveUsageCursor(henchDir, sessionId, delta.cursor);

  if (explicitUsage) {
    return {
      tokenUsage: explicitUsage,
      messages: delta.messages,
      model: delta.model,
      source: "flags",
      note: "Token usage taken from flags; session watermark advanced so the next record does not re-claim it.",
    };
  }

  if (transcriptDisabled) {
    // Burn, don't defer: the suppressed spend is deliberately unattributed,
    // and must not roll into whichever record happens to come next.
    return {
      tokenUsage: ZERO_USAGE,
      messages: 0,
      source: "none",
      note:
        delta.messages > 0
          ? `Token usage not recorded (--no-tokens); the session watermark advanced past ` +
            `${delta.messages} usage-bearing message${delta.messages === 1 ? "" : "s"}, so that spend is discarded — not claimed by the next record.`
          : "Token usage not recorded (--no-tokens).",
    };
  }

  const total =
    delta.tokenUsage.input +
    delta.tokenUsage.output +
    delta.tokenUsage.cacheCreationInput +
    delta.tokenUsage.cacheReadInput;

  const notes = [
    `Token usage read from this session's transcript: ${total.toLocaleString()} tokens across ${delta.messages} message${delta.messages === 1 ? "" : "s"}.`,
  ];
  if (delta.resynced) {
    notes.push(
      "The previous watermark was missing from the transcript (it was rewritten, likely by compaction), so the delta is approximate.",
    );
  }
  if (delta.messages === 0) {
    notes.push("Nothing new since the last record for this session.");
  }

  return {
    tokenUsage: delta.tokenUsage,
    messages: delta.messages,
    model: delta.model,
    source: "transcript",
    note: notes.join(" "),
  };
}

/**
 * Read the session transcript, by explicit path or by searching for the session.
 *
 * With `tolerateUnreadable` (the --no-tokens path, where the transcript is
 * only read to advance the watermark), a broken path degrades to null instead
 * of failing the record.
 */
async function readTranscript(
  flags: Record<string, string>,
  sessionId: string,
  tolerateUnreadable = false,
): Promise<{ path: string; text: string } | null> {
  const explicitPath = flags.transcript;
  const path = explicitPath || (sessionId ? await resolveTranscriptPath(sessionId) : null);
  if (!path) return null;

  try {
    return { path, text: await readFile(path, "utf-8") };
  } catch {
    if (tolerateUnreadable) return null;
    // An explicitly named transcript that cannot be read is worth a hard error —
    // the caller asked for that file specifically. A discovered one is not.
    if (explicitPath) {
      throw new CLIError(
        `Could not read transcript: ${explicitPath}`,
        "Pass a readable JSONL transcript, or omit --transcript to search by session id.",
      );
    }
    return null;
  }
}

/** Token counts passed by hand, or null when none were. */
function readExplicitUsage(flags: Record<string, string>): Required<TokenUsage> | null {
  const usage: Required<TokenUsage> = { ...ZERO_USAGE };
  let any = false;

  for (const [flag, field] of Object.entries(EXPLICIT_TOKEN_FLAGS)) {
    const raw = flags[flag];
    if (raw === undefined) continue;
    const parsed = parseCount(raw, `--${flag}`);
    if (parsed !== undefined) {
      usage[field] = parsed;
      any = true;
    }
  }

  return any ? usage : null;
}

/**
 * Validate a usage-window timestamp flag, or pass when absent.
 *
 * `readUsageDelta` deliberately tolerates an unparseable window (dropping the
 * filter is safer than dropping spend once the value is in flight), so the
 * rejection has to happen here — the same layer that already rejects
 * `--turns=abc` — before a malformed flag silently widens the claim to the
 * whole session.
 */
function parseWindow(raw: string | undefined, flagName: string): void {
  if (raw === undefined) return;
  if (Number.isNaN(Date.parse(raw))) {
    throw new CLIError(
      `Invalid ${flagName} value: "${raw}"`,
      "Must be a timestamp Date.parse accepts — ISO-8601 recommended (e.g. 2026-08-25T18:30:51Z). " +
        "Locale-formatted dates like 25/08/2026 are not parseable.",
    );
  }
}

/** Parse a non-negative integer flag, or undefined when absent. */
function parseCount(raw: string | undefined, flagName: string): number | undefined {
  if (raw === undefined) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new CLIError(
      `Invalid ${flagName} value: "${raw}"`,
      "Must be a non-negative integer.",
    );
  }
  return parsed;
}
