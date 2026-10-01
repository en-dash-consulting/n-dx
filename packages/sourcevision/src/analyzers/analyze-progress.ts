/**
 * Live progress of a running `sv analyze`, as a small file other processes
 * can watch: `.sourcevision/.cache/analyze-progress.json`.
 *
 * Before this file, a running analysis was visible only as `[phase N]` lines
 * on its own stdout and `manifest.modules[*].status`; the run ledger reaches
 * `analyses.jsonl` only when the run ends. The dashboard captured stdout for
 * the runs it started itself and nothing for runs started in a terminal. This
 * file is written by the analyzing process, so whoever started it, a reader
 * sees the same thing: mode, current phase, every phase's start and end, the
 * enrichment pass and its batch k of n, judgment-cache hits and misses, and
 * LLM calls, tokens and time per task class so far.
 *
 * Writes:
 * - Phase, pass, batch and scope markers write at once — they are the
 *   changes a watcher is waiting for, and there are few of them.
 * - Ledger changes (one per LLM call or cache tally) write at most once per
 *   {@link ANALYZE_PROGRESS_WRITE_INTERVAL_MS}, the rest coalesced into one
 *   trailing write, so a burst of cached judgments is not a burst of writes.
 * - Every write is atomic (temp file + rename): a reader never parses half.
 *
 * Ending: {@link finishAnalyzeProgress} marks the file `complete` or `failed`
 * rather than deleting it, so the outcome stays readable after the process is
 * gone. A run that leaves through `process.exit` — which analyze's phase
 * runner uses on a critical failure, and which skips `finally` blocks — is
 * caught by an exit listener and marked `failed`. A run killed outright
 * (SIGKILL, a crash in native code) cannot write anything, so
 * {@link readAnalyzeProgress} checks the recorded pid and reports a `running`
 * file whose process is gone as `interrupted`: a file never reads as running
 * after its process exits. A pid the OS has since given to another program,
 * or one written inside a container and read on the host, is alive but not
 * the analysis, so where the platform shows command lines the reader checks
 * that one too ({@link readProcessCommandLine}).
 *
 * Module-level state, one run per process, owned by the outermost `analyze`
 * call — the recursive `--deep` sub-analyses report into the same file under
 * {@link markScope}. Markers are no-ops while no run owns the file, so the
 * analyzers they sit in still run unchanged under `sv narrate` and in tests.
 *
 * @module sourcevision/analyzers/analyze-progress
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { AnalysisRun, LLMClassUsage } from "../schema/index.js";
import { execFileSyncCli } from "../util/exec-cli.js";
import { describePass } from "./enrich-config.js";
import { setRunLedgerListener, snapshotRunLedger } from "./run-ledger.js";

/** File name under `<svDir>/.cache/`. */
export const ANALYZE_PROGRESS_FILE = "analyze-progress.json";

/** Minimum gap between two ledger-driven writes. */
export const ANALYZE_PROGRESS_WRITE_INTERVAL_MS = 250;

/** Phases `sv analyze` runs, in order (`executePhases` in cli/commands/analyze.ts). */
const PHASE_COUNT = 6;

/** One phase as it ran. `endedAt`, `durationMs` and `outcome` appear when it ends. */
export interface AnalyzePhaseProgress {
  index: number;
  name: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  outcome?: "ok" | "failed";
}

/** The file's content. */
export interface AnalyzeProgress {
  version: 1;
  /** The analyzing process — what a reader checks to tell a live run from a dead one. */
  pid: number;
  /**
   * What the writer last said. `interrupted` is never written: the reader
   * reports it for a `running` file whose process is gone.
   */
  status: "running" | "complete" | "failed" | "interrupted";
  /** The ledger's mode; `generative` until the zone phase settles cascade versus generative. */
  mode: AnalysisRun["mode"];
  /** Sub-package a `--deep` run is analyzing (its path relative to the root), or null for the root. */
  scope: string | null;
  startedAt: string;
  updatedAt: string;
  endedAt?: string;
  /** The command line the run was started with (`sv analyze --deep`), for the page that names it. */
  command?: string;
  /** Why the run failed or was stopped: the last error line the analyzer reported. Absent on success. */
  error?: string;
  /** The phase in progress, or null between phases and after the run. */
  phase: { index: number; name: string; total: number } | null;
  /** Every phase started in the current scope, in order. */
  phases: AnalyzePhaseProgress[];
  /** The enrichment pass in progress (zone phase only). */
  pass: { number: number; label: string } | null;
  /** The batched step in progress: `done` of `total` batches finished. */
  batch: { label: string; done: number; total: number } | null;
  judgmentCache: { hits: number; misses: number };
  /** LLM use so far: run totals plus the ledger's per-task-class buckets. */
  llm: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    durationMs: number;
    byTaskClass: Record<string, LLMClassUsage>;
  };
}

/** Per-phase timings of an earlier run, from `analyses.jsonl`. */
export interface PreviousAnalyzeRun {
  at: string;
  durationMs: number;
  /** Phase name → wall-clock ms. */
  phases: Record<string, number>;
}

/** What {@link readAnalyzeProgress} returns: the file, judged against its pid, plus the last comparable run. */
export interface AnalyzeProgressReport extends AnalyzeProgress {
  /** The file says running and its process is alive. */
  running: boolean;
  /** The file says running but its process is gone; `status` is then `interrupted`. */
  stale: boolean;
  /**
   * When the file is stale because its pid now belongs to another program,
   * that program's command line; otherwise null. Never signal it.
   */
  pidReusedBy: string | null;
  /** The latest run of the same mode that started before this one, or null. */
  previous: PreviousAnalyzeRun | null;
}

export function analyzeProgressPath(svDir: string): string {
  return join(svDir, ".cache", ANALYZE_PROGRESS_FILE);
}

// ── Writer ───────────────────────────────────────────────────────────────

interface ActiveRun {
  path: string;
  startedAt: string;
  scope: string | null;
  command: string | undefined;
  error: string | undefined;
  phase: AnalyzeProgress["phase"];
  phases: AnalyzePhaseProgress[];
  pass: AnalyzeProgress["pass"];
  batch: AnalyzeProgress["batch"];
  lastWriteAt: number;
  pending: ReturnType<typeof setTimeout> | null;
  /** A write failed and was reported; later failures stay quiet. */
  writeFailed: boolean;
  onExit: (code: number) => void;
}

let _active: ActiveRun | null = null;

export function isAnalyzeProgressActive(): boolean {
  return _active !== null;
}

/**
 * Start publishing progress for the run whose output directory is `svDir`.
 *
 * Returns false, and changes nothing, when a run already owns the file — the
 * nested `cmdAnalyze` of a `--deep` sub-package. Only the call that got true
 * may finish it. `command` is recorded for readers that show what was run.
 */
export function startAnalyzeProgress(svDir: string, command?: string): boolean {
  if (_active) return false;
  const run: ActiveRun = {
    path: analyzeProgressPath(svDir),
    // The ledger's clock, not a fresh one: the run's own analyses.jsonl line
    // carries the ledger's `at`, and readAnalyzeProgress tells "previous"
    // runs apart by starting strictly before this.
    startedAt: snapshotRunLedger().at,
    scope: null,
    command,
    error: undefined,
    phase: null,
    phases: [],
    pass: null,
    batch: null,
    lastWriteAt: 0,
    pending: null,
    writeFailed: false,
    onExit: () => finish("failed"),
  };
  _active = run;
  process.on("exit", run.onExit);
  setRunLedgerListener(onLedgerChange);
  write();
  return true;
}

/** Mark the run finished, close any open phase, and stop publishing. */
export function finishAnalyzeProgress(outcome: "complete" | "failed"): void {
  finish(outcome);
}

/**
 * Record why the run is failing; written with the next progress write, and
 * kept by the final `failed` one. The latest message wins.
 */
export function noteAnalyzeError(message: string): void {
  const run = _active;
  if (!run) return;
  run.error = message;
  write();
}

/**
 * The phase in progress at the root scope, or null between phases and inside
 * a `--deep` sub-package (whose phases are not the root manifest's).
 */
export function openRootPhase(): string | null {
  const run = _active;
  return run && run.scope === null ? run.phase?.name ?? null : null;
}

/** The phase runner is starting phase `index` (1–6). Clears pass and batch. */
export function markPhaseStarted(index: number, name: string): void {
  const run = _active;
  if (!run) return;
  closeOpenPhase(run, "ok");
  run.phase = { index, name, total: PHASE_COUNT };
  run.phases.push({ index, name, startedAt: new Date().toISOString() });
  run.pass = null;
  run.batch = null;
  write();
}

/** The phase runner finished `name`. */
export function markPhaseEnded(name: string, outcome: "ok" | "failed"): void {
  const run = _active;
  if (!run) return;
  for (const p of run.phases) {
    if (p.name === name && p.endedAt === undefined) endPhase(p, outcome);
  }
  if (run.phase?.name === name) run.phase = null;
  run.pass = null;
  run.batch = null;
  write();
}

/** An enrichment pass is starting. Clears the batch. */
export function markPass(passNumber: number): void {
  const run = _active;
  if (!run) return;
  run.pass = { number: passNumber, label: describePass(passNumber) };
  run.batch = null;
  write();
}

/** `done` of `total` batches of a batched step are finished. */
export function markBatch(label: string, done: number, total: number): void {
  const run = _active;
  if (!run) return;
  run.batch = { label, done, total };
  write();
}

/**
 * A `--deep` run moved to sub-package `scope`, or back to the root (`null`).
 * Each scope runs its own phases, so the phase list restarts.
 */
export function markScope(scope: string | null): void {
  const run = _active;
  if (!run) return;
  closeOpenPhase(run, "ok");
  run.scope = scope;
  run.phase = null;
  run.phases = [];
  run.pass = null;
  run.batch = null;
  write();
}

function onLedgerChange(): void {
  const run = _active;
  if (!run || run.pending) return;
  const wait = run.lastWriteAt + ANALYZE_PROGRESS_WRITE_INTERVAL_MS - Date.now();
  if (wait <= 0) {
    write();
    return;
  }
  run.pending = setTimeout(() => {
    run.pending = null;
    if (_active === run) write();
  }, wait);
  // Never keep a finished analysis alive for a progress write.
  run.pending.unref?.();
}

function finish(outcome: "complete" | "failed"): void {
  const run = _active;
  if (!run) return;
  closeOpenPhase(run, outcome === "complete" ? "ok" : "failed");
  run.phase = null;
  run.pass = null;
  run.batch = null;
  write({ status: outcome, endedAt: new Date().toISOString() });
  if (run.pending) clearTimeout(run.pending);
  process.off("exit", run.onExit);
  setRunLedgerListener(null);
  _active = null;
}

function closeOpenPhase(run: ActiveRun, outcome: "ok" | "failed"): void {
  for (const p of run.phases) {
    if (p.endedAt === undefined) endPhase(p, outcome);
  }
}

function endPhase(p: AnalyzePhaseProgress, outcome: "ok" | "failed"): void {
  const now = Date.now();
  p.endedAt = new Date(now).toISOString();
  p.durationMs = now - Date.parse(p.startedAt);
  p.outcome = outcome;
}

function write(end?: { status: "complete" | "failed"; endedAt: string }): void {
  const run = _active;
  if (!run) return;
  if (run.pending) {
    clearTimeout(run.pending);
    run.pending = null;
  }
  const ledger = snapshotRunLedger();
  const byTaskClass = ledger.llm.byTaskClass;
  const buckets = Object.values(byTaskClass);
  const progress: AnalyzeProgress = {
    version: 1,
    pid: process.pid,
    status: end?.status ?? "running",
    mode: ledger.mode,
    scope: run.scope,
    startedAt: run.startedAt,
    updatedAt: new Date().toISOString(),
    ...(end ? { endedAt: end.endedAt } : {}),
    ...(run.command !== undefined ? { command: run.command } : {}),
    ...(run.error !== undefined ? { error: run.error } : {}),
    phase: run.phase,
    phases: run.phases,
    pass: run.pass,
    batch: run.batch,
    judgmentCache: ledger.llm.judgmentCache ?? { hits: 0, misses: 0 },
    llm: {
      calls: sum(buckets, "calls"),
      inputTokens: sum(buckets, "inputTokens"),
      outputTokens: sum(buckets, "outputTokens"),
      durationMs: sum(buckets, "durationMs"),
      byTaskClass,
    },
  };
  run.lastWriteAt = Date.now();
  try {
    mkdirSync(join(run.path, ".."), { recursive: true });
    const tmp = `${run.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(progress, null, 2) + "\n");
    renameSync(tmp, run.path);
  } catch (err) {
    // Progress is for watchers; an unwritable .cache/ must not fail the
    // analysis it describes. Said once, then the run carries on unwatched.
    if (!run.writeFailed) {
      run.writeFailed = true;
      console.warn(`  [progress] could not write ${run.path}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

function sum(buckets: LLMClassUsage[], key: "calls" | "inputTokens" | "outputTokens" | "durationMs"): number {
  return buckets.reduce((n, b) => n + b[key], 0);
}

// ── Reader ───────────────────────────────────────────────────────────────

export interface ReadAnalyzeProgressOptions {
  /** Liveness check for the recorded pid; injectable for tests. */
  isPidAlive?: (pid: number) => boolean;
  /** The recorded pid's command line; injectable for tests. Defaults to {@link readProcessCommandLine}. */
  processCommandLine?: ProcessCommandLine;
}

/** A process's command line, or null when it cannot be told. */
export type ProcessCommandLine = (pid: number) => string | null;

/**
 * `ps -ww -o command= -p <pid>` on POSIX. Null on Windows, when `ps` is
 * missing or fails, and when no such process exists: null means "cannot
 * tell", never "not an analysis".
 */
export function readProcessCommandLine(pid: number): string | null {
  if (process.platform === "win32" || !Number.isInteger(pid) || pid <= 0) return null;
  let out: string;
  try {
    out = String(execFileSyncCli("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf-8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }));
  } catch {
    // ps exits 1 for a pid with no process; missing ps or a timeout lands here too.
    return null;
  }
  return out.trim() || null;
}

/** Program names `sv analyze` runs as: the `sv` / `sourcevision` bins and their shims. */
const ANALYZER_PROGRAM = /^(sv|sourcevision)(\.c?js|\.cmd)?$/;

/**
 * Whether a command line is a sourcevision analyze: an `analyze` argument,
 * run by a program named `sv` / `sourcevision` or from a path inside a
 * `sourcevision` package (`node …/sourcevision/dist/cli/index.js analyze`).
 */
export function isAnalyzeCommandLine(command: string): boolean {
  const tokens = command.trim().split(/\s+/);
  if (!tokens.includes("analyze")) return false;
  return tokens.some((t) => ANALYZER_PROGRAM.test(basename(t)) || /[\\/]sourcevision[\\/]/.test(t));
}

/** Whether a pid is running an analyze: `analyze` is null when its command line cannot be read. */
export interface AnalyzeProcessCheck {
  analyze: boolean | null;
  command: string | null;
}

/** Read `pid`'s command line and judge it with {@link isAnalyzeCommandLine}. */
export function confirmAnalyzeProcess(pid: number, commandLine: ProcessCommandLine = readProcessCommandLine): AnalyzeProcessCheck {
  const command = commandLine(pid);
  return { analyze: command === null ? null : isAnalyzeCommandLine(command), command };
}

/**
 * Read the progress file under `svDir`, judged against its pid, with the
 * per-phase timings of the previous run of the same mode attached. Null when
 * there is no file or it cannot be parsed. Never throws.
 */
export function readAnalyzeProgress(svDir: string, options: ReadAnalyzeProgressOptions = {}): AnalyzeProgressReport | null {
  const path = analyzeProgressPath(svDir);
  let progress: AnalyzeProgress;
  try {
    if (!existsSync(path)) return null;
    progress = JSON.parse(readFileSync(path, "utf-8")) as AnalyzeProgress;
  } catch {
    return null;
  }
  if (progress?.version !== 1 || typeof progress.pid !== "number") return null;

  const alive = options.isPidAlive ?? defaultIsPidAlive;
  const claimsRunning = progress.status === "running";
  let running = claimsRunning && alive(progress.pid);
  let pidReusedBy: string | null = null;
  if (running) {
    // Alive is not enough: after a hard kill the OS may have given the pid
    // to another program. Unknown (Windows, no `ps`) keeps the liveness answer.
    const check = confirmAnalyzeProcess(progress.pid, options.processCommandLine);
    if (check.analyze === false) {
      pidReusedBy = check.command;
      running = false;
    }
  }
  const stale = claimsRunning && !running;
  return {
    ...progress,
    status: stale ? "interrupted" : progress.status,
    running,
    stale,
    pidReusedBy,
    previous: previousRun(svDir, progress.mode, progress.startedAt),
  };
}

/** `kill(pid, 0)`; EPERM means the process exists but is not ours to signal. */
function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * The latest `analyses.jsonl` entry of `mode` that started before
 * `startedAt`. Comparing start times rather than skipping the last line keeps
 * a finished run from being its own "previous".
 */
function previousRun(svDir: string, mode: AnalysisRun["mode"], startedAt: string): PreviousAnalyzeRun | null {
  const before = Date.parse(startedAt);
  let lines: string[];
  try {
    lines = readFileSync(join(svDir, ".cache", "analyses.jsonl"), "utf-8").split("\n");
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    let run: Partial<AnalysisRun>;
    try {
      run = JSON.parse(lines[i]) as Partial<AnalysisRun>;
    } catch {
      continue;
    }
    if (run.mode !== mode || typeof run.at !== "string" || !(Date.parse(run.at) < before)) continue;
    return { at: run.at, durationMs: run.durationMs ?? 0, phases: { ...(run.phases ?? {}) } };
  }
  return null;
}
