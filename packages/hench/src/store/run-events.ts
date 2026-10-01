/**
 * Structured progress events — one JSON object per line, appended as the run
 * produces them, for every run rather than only verbose ones.
 *
 * ## Why this exists separately from the run log
 *
 * `store/run-log.ts` streams the run's *terminal output*: prose, colour codes,
 * banners, whatever the agent printed. A viewer wanting to show "read 6 files,
 * edited 2, test gate passed" would have to parse that text back into facts,
 * and would break the next time a message is reworded. This file carries the
 * facts directly, in a small closed vocabulary ({@link RunEventKind}) the
 * dashboard's Work tab renders without parsing anything.
 *
 * `RunRecord.events` is a different thing again: the raw `RuntimeEvent` stream,
 * kept only in verbose/debug mode and saved with the record at the end of the
 * run. It is a debugging artifact, it is not written until the run is over, and
 * it is absent from a normal run. None of that suits a live view.
 *
 * ## Format
 *
 * JSON Lines: one {@link RunEvent} per line, newline-terminated. Deliberately
 * not a single JSON array, which only parses once it is closed — i.e. exactly
 * when watching it stops being useful. A reader can `tail -f` this file and
 * parse each line as it lands; a run that crashes leaves every event up to the
 * crash readable rather than a truncated array.
 *
 * Summaries are flattened to one line on the way in, so "one event, one line"
 * holds for a reader splitting on newlines before it parses anything.
 *
 * ## Location
 *
 * `.hench/runs/<runId>.events.jsonl`, beside the run record. `.hench/` is
 * already hench runtime state and already ignored, so — unlike `.run-logs/` —
 * writing here needs no `.gitignore` edit, and therefore cannot show up as
 * operator work to the run's own completion gate. The `.jsonl` suffix is also
 * what keeps `listRuns()` from reading it: that function collects run ids from
 * files ending in `.json`, which `.jsonl` does not.
 *
 * ## Cost
 *
 * No LLM calls, by construction: every summary here is formatted from values
 * the caller already holds. Writes are handed to Node's stream buffer and never
 * awaited, so emitting an event costs a string format and a buffer push.
 *
 * @module
 */

import { join, resolve } from "node:path";
import { mkdir, open } from "node:fs/promises";
import type { WriteStream } from "node:fs";

import { RUNS_DIRNAME } from "./paths.js";

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

/**
 * The kinds of thing a run reports about itself.
 *
 * Keep this list small and closed. Every member is something the Work tab draws
 * a distinct line for; a kind the viewer would render identically to an
 * existing one belongs in {@link RunEvent.detail} instead. Adding a kind is a
 * viewer change as well as a hench change.
 */
export type RunEventKind =
  /** The task brief was assembled and the agent is about to start. */
  | "brief_loaded"
  /** Files the agent read during one turn, batched. See {@link recordFileRead}. */
  | "files_read"
  /** One file written or edited. */
  | "file_edited"
  /** A test or validation command ran. */
  | "tests_run"
  /** An attempt failed transiently and is being retried. */
  | "retry"
  /** A gate reached a verdict (test gate, commit gate, completion gate). */
  | "gate"
  /** The adversarial review pass started. */
  | "review_started"
  /** The review pass produced a report (or failed to). */
  | "review_report"
  /** The run reached a terminal status. */
  | "run_finished";

/**
 * One typed progress event.
 *
 * `summary` is already plain language — the viewer prints it as-is. Everything
 * else is there so the viewer can decorate without parsing that string.
 */
export interface RunEvent {
  kind: RunEventKind;
  /** ISO 8601, stamped when the event was emitted. */
  at: string;
  /** One plain-language line. Never contains a newline. */
  summary: string;
  /** Turn number, where the event belongs to one. */
  turn?: number;
  /** One extra qualifier — a reason, a command, a path list. Never multi-line. */
  detail?: string;
  /**
   * Small named counters.
   *
   * Well-known keys, by kind: `files` (files_read); `lines`, `linesAdded`,
   * `linesRemoved` (file_edited); `packages`, `passed`, `failed` (tests_run,
   * gate); `attempt`, `maxAttempts` (retry); `findings`, `unresolved`
   * (review_report); `turns`, `durationMs` (run_finished).
   */
  counts?: Record<string, number>;
  /** Outcome, for the kinds that have one (gate, tests_run, run_finished). */
  ok?: boolean;
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Absolute path of the events file for one run.
 *
 * Resolved against the cwd when `henchDir` is relative: the path is written to
 * the run record, and a reader in another process — the dashboard, another
 * worktree — has a different cwd to resolve it against.
 */
export function runEventsPath(henchDir: string, runId: string): string {
  return resolve(henchDir, RUNS_DIRNAME, `${runId}.events.jsonl`);
}

/**
 * An open events file, written as the run progresses.
 *
 * Same contract as `RunLogWriter`, and for the same reason: neither method
 * throws. A disk problem must not take down an agent loop that was only trying
 * to narrate itself. A failure is recorded and reported once, by
 * {@link RunEventWriter.close}.
 */
export interface RunEventWriter {
  /** Absolute path of the events file. Known before the first event. */
  readonly path: string;
  /** Append one event. Returns immediately; the write is never awaited. */
  append(event: RunEvent): void;
  /**
   * Flush and close the file.
   *
   * @returns The first write error seen, or `null` when every event landed.
   */
  close(): Promise<Error | null>;
}

/** Collapse newlines and tabs so one event is always one line. */
function oneLine(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, " ").trim();
}

/**
 * Open this run's events file for incremental writing.
 *
 * The file exists as soon as this resolves, so a reader can start tailing it
 * before the agent has produced anything.
 *
 * @throws When the directory or the file itself cannot be opened. The caller is
 *         expected to continue without an event stream — it is narration, not
 *         the run.
 */
export async function openRunEvents(henchDir: string, runId: string): Promise<RunEventWriter> {
  await mkdir(join(henchDir, RUNS_DIRNAME), { recursive: true });

  const path = runEventsPath(henchDir, runId);
  // open() first, so an unwritable path rejects here — where the caller can
  // still decide what to do — rather than as an async 'error' event later.
  // Closing the stream closes the handle.
  const handle = await open(path, "w");
  const stream: WriteStream = handle.createWriteStream({ encoding: "utf-8" });

  let failure: Error | null = null;
  let closed = false;
  /** Set while close() is waiting, so an error can settle it too. */
  let settleClose: ((error: Error | null) => void) | null = null;

  stream.on("error", (error: Error) => {
    failure ??= error;
    const settle = settleClose;
    settleClose = null;
    settle?.(failure);
  });

  const append = (event: RunEvent): void => {
    if (closed || failure) return;
    let line: string;
    try {
      line = JSON.stringify({
        ...event,
        summary: oneLine(event.summary),
        ...(event.detail !== undefined ? { detail: oneLine(event.detail) } : {}),
      });
    } catch {
      // A value that will not serialize is a caller bug, but losing the run to
      // it would be worse than losing the line.
      return;
    }
    // Deliberately no backpressure handling: the agent loop must never wait on
    // disk. Node buffers what the fd cannot take yet and drains it in order, so
    // the file stays correct — only its tail lags.
    stream.write(line + "\n");
  };

  const close = (): Promise<Error | null> =>
    new Promise((resolvePromise) => {
      if (closed) {
        resolvePromise(failure);
        return;
      }
      closed = true;
      if (failure) {
        stream.destroy();
        resolvePromise(failure);
        return;
      }
      settleClose = resolvePromise;
      stream.end(() => {
        const settle = settleClose;
        settleClose = null;
        settle?.(failure);
      });
    });

  return { path, append, close };
}

// ---------------------------------------------------------------------------
// Process-wide emitter
// ---------------------------------------------------------------------------

/**
 * The events file the run currently in this process is writing to.
 *
 * Module state for the same reason the capture buffer behind
 * `getCapturedLines()` is, and the same reason `shared.ts` holds the active run
 * log: a process runs one task at a time, and the emit sites are spread across
 * the spawn loop, the gates and finalization. Threading a writer through those
 * call chains would be a lot of plumbing for a side-channel that is allowed to
 * be absent. `--loop` runs tasks one after another, each installing its own
 * writer and clearing it at the end.
 */
let _active: RunEventWriter | null = null;

/** Reads seen so far in the turn currently open. See {@link recordFileRead}. */
let _readBatch: { turn: number; paths: Set<string> } | null = null;

/**
 * How many read paths one `files_read` event names in its detail.
 *
 * The count is always exact; only the listing is bounded, so a turn that reads
 * a hundred files produces a line rather than a paragraph.
 */
const MAX_LISTED_READS = 8;

/**
 * Install (or clear) the writer {@link emitRunEvent} routes to.
 *
 * Clears any unflushed read batch: it belongs to the run that is ending, and
 * attributing it to the next one would be worse than losing it.
 */
export function setActiveRunEvents(writer: RunEventWriter | null): void {
  _active = writer;
  _readBatch = null;
}

/**
 * Flush the pending read batch and close the active stream, if there is one.
 *
 * The counterpart to installing a writer, and the only way to close one: this
 * module owns the handle, so a caller cannot close it behind the emitter's back
 * and leave events being written to a closed file.
 */
export async function closeActiveRunEvents(): Promise<void> {
  flushFileReads();
  const writer = _active;
  setActiveRunEvents(null);
  if (writer) await writer.close();
}

/**
 * Emit one event to the active run's stream.
 *
 * A no-op when no run is active, which is the normal state in tests, in the
 * dry-run path, and for a run whose events file could not be opened. Callers
 * therefore never guard this.
 *
 * Any kind other than `files_read` closes the pending read batch first.
 * Batched reads are emitted at flush time, not at read time, and the only
 * thing that flushed them was the next turn starting — so a turn's reads sat
 * open across everything that came after the spawn, and a `gate`,
 * `review_report` or `run_finished` overtook reads that happened before it.
 * A viewer rendering the file in order then showed the run reading files
 * after it had finished. Flushing here keeps the stream chronological for
 * every kind, rather than leaving each emit site to remember.
 */
export function emitRunEvent(
  kind: RunEventKind,
  summary: string,
  extra?: Omit<RunEvent, "kind" | "at" | "summary">,
): void {
  // Exempt, and the reason there is no recursion: flushing is what emits it.
  if (kind !== "files_read") flushFileReads();
  _active?.append({ kind, at: new Date().toISOString(), summary, ...extra });
}

/**
 * Note that the agent read a file during `turn`.
 *
 * Reads are batched rather than emitted one by one: an agent orienting itself
 * reads a dozen files in a turn, and a dozen lines saying so would bury the
 * edits and the gates that actually moved the task. The batch is flushed when a
 * later turn starts, and by {@link flushFileReads} at the end of the run.
 */
export function recordFileRead(path: string, turn: number): void {
  if (!_active || !path) return;
  if (_readBatch && _readBatch.turn !== turn) flushFileReads();
  _readBatch ??= { turn, paths: new Set() };
  _readBatch.paths.add(path);
}

/** Emit the pending read batch, if any turn has one open. */
export function flushFileReads(): void {
  const batch = _readBatch;
  _readBatch = null;
  if (!batch || batch.paths.size === 0) return;

  const paths = [...batch.paths];
  const summary =
    paths.length === 1 ? `Read ${paths[0]}` : `Read ${paths.length} files`;
  const listed = paths.slice(0, MAX_LISTED_READS).join(", ");
  const detail =
    paths.length > MAX_LISTED_READS
      ? `${listed}, +${paths.length - MAX_LISTED_READS} more`
      : listed;

  emitRunEvent("files_read", summary, {
    turn: batch.turn,
    detail,
    counts: { files: paths.length },
  });
}

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

/**
 * Tool names that read the tree, across both vocabularies hench sees: the
 * Claude CLI's PascalCase tools, and the API loop's snake_case ones from
 * `TOOL_DEFINITIONS_NEUTRAL` in `tools/dispatch.ts`.
 *
 * Search tools count as reads — they are how an agent looks around, and the
 * Work tab's point is to show what it looked at.
 */
const READ_TOOLS = new Set([
  // Claude CLI
  "Read",
  "Glob",
  "Grep",
  "NotebookRead",
  // tools/dispatch.ts
  "read_file",
  "list_directory",
  "search_files",
]);

/** Tool names that change the tree. */
const EDIT_TOOLS = new Set([
  // Claude CLI
  "Edit",
  "MultiEdit",
  "Write",
  "NotebookEdit",
  // tools/dispatch.ts — the only writer in the neutral set; `run_command` and
  // `git` can both change files, and neither says which, so neither is here.
  "write_file",
]);

/**
 * Classify a tool call as reading or editing files, or neither.
 *
 * Returns `null` for anything not modelled — notably shell calls, which may
 * well have edited a file but whose command this cannot read with any
 * confidence. Guessing would put wrong lines on the Work tab, which is worse
 * than a missing one.
 */
export function classifyFileTool(tool: string): "read" | "edit" | null {
  if (READ_TOOLS.has(tool)) return "read";
  if (EDIT_TOOLS.has(tool)) return "edit";
  return null;
}

/** Count lines in a string, treating the trailing newline as a terminator. */
function countLines(text: string): number {
  if (text.length === 0) return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

/** What {@link summariseFileEdit} derived from one edit tool call. */
export interface FileEditSummary {
  path: string;
  summary: string;
  counts?: Record<string, number>;
}

/**
 * Derive the `file_edited` event body from an edit tool call's input.
 *
 * Line counts come from the strings the tool was called with, which is the only
 * measurement available without re-reading the file — and the one that matches
 * what the agent asked for.
 *
 * Keyed on the shape of the input rather than the tool's name, deliberately:
 * the four vendors spell these tools differently but all pass either a whole
 * `content` or an `old_string`/`new_string` pair, so one rule covers every
 * vocabulary and keeps working when a new one appears.
 *
 * @returns `null` when the input carries no usable path. An edit that cannot
 *          name its file is not worth a line on the Work tab.
 */
export function summariseFileEdit(input: Record<string, unknown>): FileEditSummary | null {
  const raw = input["file_path"] ?? input["path"] ?? input["notebook_path"];
  if (typeof raw !== "string" || raw.length === 0) return null;
  const path = raw;

  const content = input["content"];
  if (typeof content === "string") {
    const lines = countLines(content);
    return { path, summary: `Wrote ${path} (${lines} lines)`, counts: { lines } };
  }

  const newString = input["new_string"];
  const oldString = input["old_string"];
  if (typeof newString === "string" || typeof oldString === "string") {
    const linesAdded = typeof newString === "string" ? countLines(newString) : 0;
    const linesRemoved = typeof oldString === "string" ? countLines(oldString) : 0;
    return {
      path,
      summary: `Edited ${path} (+${linesAdded} −${linesRemoved})`,
      counts: { linesAdded, linesRemoved },
    };
  }

  // A vendor that does not echo content back still produced an edit; say so
  // with no counts rather than dropping it.
  return { path, summary: `Edited ${path}`, counts: undefined };
}

/**
 * Narrate one tool call's file work onto the event stream.
 *
 * The single entry point both agent loops call, so the CLI path (vendor tool
 * names, parsed from the output stream) and the API path (hench's own tool
 * vocabulary, dispatched in-process) produce the same events. A tool this does
 * not model contributes nothing — see {@link classifyFileTool}.
 */
export function recordFileWork(
  tool: string,
  input: Record<string, unknown> | undefined,
  turn: number,
): void {
  const kind = classifyFileTool(tool);
  if (!kind) return;

  if (kind === "read") {
    // A search tool carrying only a pattern names no file; counting the regex
    // as something the agent read would be a lie on the Work tab.
    const raw = input?.["file_path"] ?? input?.["path"] ?? input?.["notebook_path"];
    if (typeof raw === "string" && raw.length > 0) recordFileRead(raw, turn);
    return;
  }

  const edit = summariseFileEdit(input ?? {});
  if (!edit) return;
  // The pending read batch is closed by emitRunEvent itself, so the reads that
  // informed this edit appear above it without a second mechanism here.
  emitRunEvent("file_edited", edit.summary, {
    turn,
    detail: edit.path,
    counts: edit.counts,
  });
}
