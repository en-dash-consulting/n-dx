/**
 * Persistent run log — writes captured output lines to a timestamped file
 * under .run-logs/ at the project root.
 *
 * The directory is created automatically on first use, with a `.gitignore` of
 * `*` inside it so git never sees a log (see `prepareLogDir`). The project's
 * .gitignore is also updated to exclude .run-logs/ if the entry is missing — at
 * the end of a run, never while one is in flight. See {@link ensureRunLogsIgnored}.
 *
 * Log file naming convention: {ISO-timestamp-safe}-{runId}.log
 * Example: 2026-04-08T23-21-17-abc123ef-….log
 *
 * Two writers, one format. {@link openRunLog} streams lines to the file as
 * the run produces them, so the log can be tailed while the run is still
 * going; {@link persistRunLog} writes the whole thing once, and is what the
 * run falls back to when the stream could not be opened or broke mid-run.
 * Both produce byte-identical files for the same lines — `run-log.test.ts`
 * compares them.
 *
 * @module
 */

import { join, resolve } from "node:path";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import type { WriteStream } from "node:fs";
import { createLineRedactor } from "../prd/llm-gateway.js";

const LOG_DIR_NAME = ".run-logs";
const GITIGNORE_ENTRY = ".run-logs/";

/**
 * Absolute path of the log file for one run.
 *
 * The ISO timestamp is converted to a filesystem-safe form: colons → hyphens,
 * fractional seconds and the timezone suffix stripped.
 *
 * Resolved against the cwd when `projectDir` is relative: the path is written
 * to the run record, and a reader in another process (the dashboard, another
 * worktree) has a different cwd to resolve it against.
 */
export function runLogPath(projectDir: string, runId: string, startedAt: string): string {
  const safeTimestamp = startedAt
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "")
    .replace(/Z$/, "");

  return resolve(projectDir, LOG_DIR_NAME, `${safeTimestamp}-${runId}.log`);
}

/**
 * Create .run-logs/ if it is not already there, with a `.gitignore` of `*`
 * inside it.
 *
 * The directory ignores itself so git never sees a run log, from the moment
 * the directory exists. The project `.gitignore` line is only added at the
 * end of a run ({@link ensureRunLogsIgnored}), but the live log grows from the
 * start: without this file, a project's first run showed its own log to the
 * review pass's dirty-state snapshots and to an agent's `git add -A`. Writing
 * inside the untracked directory edits no tracked file mid-run.
 *
 * An existing ignore file is left as it is (`wx`): the operator may have
 * chosen different rules.
 */
async function prepareLogDir(projectDir: string): Promise<void> {
  const dir = join(projectDir, LOG_DIR_NAME);
  await mkdir(dir, { recursive: true });
  try {
    await writeFile(join(dir, ".gitignore"), "*\n", { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

/**
 * Persist captured run output to a timestamped log file under .run-logs/
 * at the project root. Creates the directory automatically. Adds
 * .run-logs/ to the project .gitignore if the entry is missing.
 *
 * @param projectDir  Absolute path to the project root.
 * @param runId       The run's unique identifier (used in the filename).
 * @param startedAt   ISO 8601 timestamp of run start (used in the filename).
 * @param lines       Plain-text output lines in emission order.
 * @returns           Absolute path of the written log file.
 */
export async function persistRunLog(
  projectDir: string,
  runId: string,
  startedAt: string,
  lines: readonly string[],
): Promise<string> {
  await prepareLogDir(projectDir);
  await ensureRunLogsIgnored(projectDir);

  const logPath = runLogPath(projectDir, runId, startedAt);
  // Same scrub as the run record, and — through the same redactor — as the
  // streaming writer below, which is what keeps the two byte-identical.
  const redactor = createLineRedactor();
  const scrubbed = [...lines.flatMap((line) => redactor.push(line)), ...redactor.flush()];
  const content = scrubbed.length > 0 ? scrubbed.join("\n") + "\n" : "";
  await writeFile(logPath, content, "utf-8");

  return logPath;
}

/**
 * An open run log, written line by line while the run is in progress.
 *
 * Obtained from {@link openRunLog}. The run's own output path calls
 * {@link RunLogWriter.appendLine} for every line it captures, so the contract
 * is that neither method throws: a disk problem must not take down the agent
 * loop that was only trying to narrate itself. A failure is recorded and
 * reported once, by {@link RunLogWriter.close}.
 */
export interface RunLogWriter {
  /** Absolute path of the log file. Known before the first line is written. */
  readonly path: string;
  /**
   * Append one line (the newline is added here). Returns immediately —
   * the write is handed to Node's stream buffer, never awaited.
   */
  appendLine(line: string): void;
  /**
   * Flush and close the file.
   *
   * @returns The first write error seen, or `null` when every line landed.
   *          A non-null result means the file on disk is incomplete and the
   *          caller should re-write it with {@link persistRunLog}.
   */
  close(): Promise<Error | null>;
}

/**
 * Open this run's log file for incremental writing.
 *
 * The file exists as soon as this resolves, so a reader can start tailing it
 * before the agent has produced anything. Lines are written through as they
 * arrive rather than buffered to the end of the run: a crash therefore leaves
 * a readable partial log instead of none.
 *
 * @param projectDir   Absolute path to the project root.
 * @param runId        The run's unique identifier (used in the filename).
 * @param startedAt    ISO 8601 timestamp of run start (used in the filename).
 * @param prefixLines  Lines already captured before the log was opened. These
 *                     are written first, so the finished file matches what
 *                     {@link persistRunLog} would have produced for the whole
 *                     capture buffer.
 * @throws When the directory or the file itself cannot be opened. The caller
 *         is expected to continue without a live log and fall back to
 *         {@link persistRunLog} at the end of the run.
 *
 * Does not touch `.gitignore` — see {@link ensureRunLogsIgnored}, which the
 * caller runs once the run is over.
 */
export async function openRunLog(
  projectDir: string,
  runId: string,
  startedAt: string,
  prefixLines: readonly string[] = [],
): Promise<RunLogWriter> {
  await prepareLogDir(projectDir);

  const path = runLogPath(projectDir, runId, startedAt);
  // open() first, so an unwritable path rejects here — where the caller can
  // still decide what to do — rather than as an async 'error' event later.
  // Closing the stream closes the handle.
  const handle = await open(path, "w");
  const stream: WriteStream = handle.createWriteStream({ encoding: "utf-8" });

  let failure: Error | null = null;
  let closed = false;
  /** Set while close() is waiting, so an error can settle it too. */
  let settleClose: ((error: Error | null) => void) | null = null;

  // An unhandled 'error' on a stream is thrown on the stream's own tick,
  // which would crash the run from inside an output call. Record it instead;
  // close() reports it and the caller re-writes the file whole.
  stream.on("error", (error: Error) => {
    failure ??= error;
    const settle = settleClose;
    settleClose = null;
    settle?.(failure);
  });

  // One redactor for the life of the stream. It is stateful on purpose: a
  // PEM private key spans lines, so a per-line scrub cannot see one, and the
  // key body is base64 that no other rule matches.
  const redactor = createLineRedactor();

  const writeLines = (lines: readonly string[]): void => {
    for (const line of lines) stream.write(line + "\n");
  };

  const appendLine = (line: string): void => {
    // Once the stream has failed every further write would fail the same way;
    // the complete file comes from the end-of-run fallback instead.
    if (closed || failure) return;
    // Deliberately no backpressure handling: the agent loop must never wait
    // on disk. Node buffers what the fd cannot take yet and drains it in
    // order, so the file stays correct — only its tail lags.
    //
    // Scrubbed exactly as persistRunLog scrubs, through the same redactor:
    // this is the writer a real run uses and persistRunLog only the fallback,
    // so redacting there alone would leak every credential to the live log —
    // and break the byte-identical guarantee the module header states.
    //
    // A line inside an open key block returns nothing and is written when the
    // block closes, so the live log lags by the length of a key and no more.
    writeLines(redactor.push(line));
  };

  for (const line of prefixLines) appendLine(line);

  const close = (): Promise<Error | null> =>
    new Promise((resolve) => {
      if (closed) {
        resolve(failure);
        return;
      }
      closed = true;
      if (failure) {
        stream.destroy();
        resolve(failure);
        return;
      }
      // Whatever the redactor is still holding — a `BEGIN` whose `END` never
      // arrived because the run ended or was killed mid-key. Dropping it
      // would lose output; it is released scrubbed line by line.
      writeLines(redactor.flush());
      settleClose = resolve;
      stream.end(() => {
        const settle = settleClose;
        settleClose = null;
        settle?.(failure);
      });
    });

  return { path, appendLine, close };
}

/**
 * Append `.run-logs/` to the project .gitignore if the entry is not
 * already present. Creates .gitignore if it does not exist.
 * Errors are swallowed — a missing .gitignore update must not crash a run.
 *
 * Deliberately separate from opening the log, and deliberately called at the
 * *end* of a run: `.gitignore` is a tracked file, so writing it mid-run shows
 * up as operator work to that run's own completion gate — the failure mode
 * `store/artifacts.ts` exists to describe.
 */
export async function ensureRunLogsIgnored(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  let existing = "";
  try {
    existing = await readFile(gitignorePath, "utf-8");
  } catch {
    // File does not exist — will create it below with just the entry.
  }

  const normalised = GITIGNORE_ENTRY.replace(/\/$/, ""); // ".run-logs"
  const alreadyPresent = existing
    .split("\n")
    .some((l) => l.trim() === GITIGNORE_ENTRY || l.trim() === normalised);

  if (alreadyPresent) return;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  try {
    await writeFile(gitignorePath, existing + separator + GITIGNORE_ENTRY + "\n", "utf-8");
  } catch {
    // Best-effort — never propagate gitignore write failures.
  }
}
