/**
 * The Live analysis page's facts — one read of the served worktree's
 * `sv analyze`.
 *
 * GET  /api/live/analyze      — the structured progress the analyzing process
 *   publishes (phase, pass, batch, LLM use, the previous same-mode run's
 *   timings), plus what the progress file does not carry: who started the run,
 *   the stdout tail (dashboard-started runs only), the `.sourcevision/` files
 *   the manifest says were written, background narration, and recent runs
 *   from `analyses.jsonl`.
 * POST /api/live/analyze/stop — stop a run this server did not start, by the
 *   pid its progress file records. Dashboard-started runs stop through
 *   `POST /api/commands/sv-analyze/stop`, which owns the child handle.
 *
 * One analysis per worktree: the served workspace's `.sourcevision/` is the
 * only thing read, so another worktree's analysis is opened under its own
 * `/w/<key>/` prefix. Changes reach the page through the
 * `sv:analyze-progress` frame (`analyze-progress-watcher.ts`); this route is
 * what it refetches.
 *
 * @module web/server/routes-live-analyze
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { ServerContext } from "./types.js";
import { errorResponse, jsonResponse } from "./response-utils.js";
import { workspaceKeyOf } from "./workspace-scoped.js";
import {
  confirmAnalyzeProcess,
  readAnalyzeProgress,
  type AnalyzeProgressReport,
  type ProcessCommandLine,
} from "./domain-gateway.js";
import { svAnalyzeRunOf } from "./routes-commands.js";
import { resolveActiveModel } from "./routes-llm.js";
import { estimateCostFromTotals } from "./rex-gateway.js";
import type { LiveSources, LiveWorktree } from "./routes-live.js";

/** Lines of stdout the page shows. */
export const LIVE_ANALYZE_OUTPUT_LINES = 200;
/** Recent analyses listed in the side column. */
export const LIVE_ANALYZE_RECENT_RUNS = 8;

export interface LiveAnalyzeModule {
  name: string;
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
}

export interface LiveAnalyzeNarration {
  status: string;
  zones: number;
  reason: string | null;
}

export interface LiveAnalyzeHistoryRun {
  at: string;
  mode: string;
  durationMs: number;
  calls: number;
  costUsd: number | null;
}

export interface LiveAnalyzeSnapshot {
  generatedAt: string;
  worktree: LiveWorktree;
  /** Null until any analysis has run under the progress writer. */
  progress: AnalyzeProgressReport | null;
  /** Meaningful only while the run is going; null otherwise. */
  startedFrom: "dashboard" | "terminal" | null;
  output: {
    /** False for a terminal-started run: its stdout belongs to its terminal. */
    available: boolean;
    lines: string[];
  };
  /** The enrichment vendor and model the project is configured with. */
  llm: { vendor: string | null; model: string | null };
  /** USD for the LLM calls so far, priced per task class at the model that answered. */
  costUsd: number;
  modules: LiveAnalyzeModule[];
  /** Phase name → what it produced, for phases this run has finished. */
  results: Record<string, string>;
  /** The enrichment pass zones.json records as completed, once this run's zones phase has finished. */
  enrichmentPass: number | null;
  narration: LiveAnalyzeNarration | null;
  /** Newest first. */
  recent: LiveAnalyzeHistoryRun[];
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function canonical(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** Parsed JSON object at `path`, or null when the file is absent or not an object. */
function readJsonObject(path: string): Record<string, unknown> | null {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function modulesOf(manifest: Record<string, unknown> | null): LiveAnalyzeModule[] {
  return Object.entries(asRecord(manifest?.modules)).map(([name, raw]) => {
    const m = asRecord(raw);
    return { name, status: str(m.status) ?? "pending", startedAt: str(m.startedAt), completedAt: str(m.completedAt), error: str(m.error) };
  });
}

function narrationOf(manifest: Record<string, unknown> | null): LiveAnalyzeNarration | null {
  const n = manifest?.narration;
  if (!n || typeof n !== "object") return null;
  const r = n as Record<string, unknown>;
  return {
    status: str(r.status) ?? "pending",
    zones: (Array.isArray(r.zones) ? r.zones.length : 0) + (Array.isArray(r.names) ? r.names.length : 0),
    reason: str(r.reason),
  };
}

/** The last {@link LIVE_ANALYZE_RECENT_RUNS} lines of `analyses.jsonl`, newest first; unreadable lines are skipped. */
function recentRuns(svDir: string): LiveAnalyzeHistoryRun[] {
  let lines: string[];
  try {
    lines = readFileSync(join(svDir, ".cache", "analyses.jsonl"), "utf-8").split("\n");
  } catch {
    return [];
  }
  const runs: LiveAnalyzeHistoryRun[] = [];
  for (let i = lines.length - 1; i >= 0 && runs.length < LIVE_ANALYZE_RECENT_RUNS; i--) {
    if (!lines[i].trim()) continue;
    let run: Record<string, unknown>;
    try {
      run = asRecord(JSON.parse(lines[i]));
    } catch {
      continue;
    }
    const at = str(run.at);
    if (!at) continue;
    const llm = asRecord(run.llm);
    const calls = Object.values(asRecord(llm.byTaskClass)).reduce<number>((n, c) => n + num(asRecord(c).calls), 0);
    runs.push({
      at,
      mode: str(run.mode) ?? "generative",
      durationMs: num(run.durationMs),
      calls,
      costUsd: typeof llm.costUsd === "number" ? llm.costUsd : null,
    });
  }
  return runs;
}

// ── Phase results ────────────────────────────────────────────────────────

interface PhaseResult {
  text: string;
  /** Zones only: the enrichment pass the file records as completed. */
  enrichmentPass?: number;
}

interface PhaseResultSource {
  phase: string;
  file: string;
  describe: (data: Record<string, unknown>) => PhaseResult;
}

function count(n: unknown): string {
  return num(n).toLocaleString("en-US");
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** What each phase leaves in `.sourcevision/`, said in a line. Keyed by the phase names `sv analyze` reports. */
const PHASE_RESULTS: readonly PhaseResultSource[] = [
  {
    phase: "inventory",
    file: "inventory.json",
    describe: (d) => {
      const summary = asRecord(d.summary);
      const languages = Object.entries(asRecord(summary.byLanguage))
        .map(([name, n]) => [name, num(n)] as const)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, n]) => `${name} ${count(n)}`);
      return { text: [plural(num(summary.totalFiles), "file"), ...(languages.length > 0 ? [languages.join(", ")] : [])].join(" · ") };
    },
  },
  {
    phase: "imports",
    file: "imports.json",
    describe: (d) => {
      const summary = asRecord(d.summary);
      return { text: `${plural(num(summary.totalEdges), "import edge")} · ${plural(num(summary.circularCount), "circular dependency", "circular dependencies")}` };
    },
  },
  {
    phase: "classifications",
    file: "classifications.json",
    describe: (d) => {
      const summary = asRecord(d.summary);
      return { text: `${plural(num(summary.totalClassified), "file")} classified · ${plural(Object.keys(asRecord(summary.byArchetype)).length, "archetype")}` };
    },
  },
  {
    phase: "zones",
    file: "zones.json",
    describe: (d) => ({
      text: plural(Array.isArray(d.zones) ? d.zones.length : 0, "zone"),
      ...(typeof d.enrichmentPass === "number" ? { enrichmentPass: d.enrichmentPass } : {}),
    }),
  },
  {
    phase: "components",
    file: "components.json",
    describe: (d) => {
      const summary = asRecord(d.summary);
      return { text: `${plural(num(summary.totalComponents), "component")} · ${plural(num(summary.totalRouteModules), "route module")}` };
    },
  },
  {
    phase: "callgraph",
    file: "callgraph.json",
    describe: (d) => {
      const summary = asRecord(d.summary);
      return { text: `${plural(num(summary.totalFunctions), "function")} · ${plural(num(summary.totalCalls), "call")}` };
    },
  },
];

/** A data file is parsed once per write; its description is kept against the mtime it was made from. */
const resultCache = new Map<string, { mtimeMs: number; result: PhaseResult | null }>();

/** Clear the phase-result cache (tests). */
export function clearLiveAnalyzeCaches(): void {
  resultCache.clear();
}

/**
 * One line per finished phase of the current run. A file counts only if this
 * run wrote it (modified at or after the run started): until then it is the
 * previous run's, and the page says so rather than showing it as a result.
 */
function phaseResults(
  svDir: string,
  progress: AnalyzeProgressReport | null,
): { results: Record<string, string>; enrichmentPass: number | null } {
  const results: Record<string, string> = {};
  let enrichmentPass: number | null = null;
  if (!progress) return { results, enrichmentPass };
  const startedMs = Date.parse(progress.startedAt);
  for (const source of PHASE_RESULTS) {
    const entry = progress.phases.find((p) => p.name === source.phase);
    if (entry?.outcome !== "ok") continue;
    const path = join(svDir, source.file);
    let mtimeMs: number;
    try {
      mtimeMs = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs < startedMs) continue;
    const cached = resultCache.get(path);
    let result: PhaseResult | null;
    if (cached && cached.mtimeMs === mtimeMs) {
      result = cached.result;
    } else {
      const data = readJsonObject(path);
      result = data ? source.describe(data) : null;
      resultCache.set(path, { mtimeMs, result });
    }
    if (!result) continue;
    results[source.phase] = result.text;
    if (result.enrichmentPass !== undefined) enrichmentPass = result.enrichmentPass;
  }
  return { results, enrichmentPass };
}

/** USD for the run's LLM use so far. Cache tokens are not tracked per class, so this prices input and output only. */
export function priceAnalyzeUsage(progress: AnalyzeProgressReport | null): number {
  if (!progress) return 0;
  const buckets = Object.values(progress.llm.byTaskClass);
  if (buckets.length === 0) return 0;
  const byModel: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number }> = {};
  const totals = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
  for (const usage of buckets) {
    const bucket = (byModel[usage.model || "unknown"] ??= { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 });
    for (const target of [bucket, totals]) {
      target.inputTokens += usage.inputTokens;
      target.outputTokens += usage.outputTokens;
    }
  }
  return estimateCostFromTotals(totals, byModel).totalRaw;
}

function worktreeOf(ctx: ServerContext, sources: LiveSources): LiveWorktree {
  const served = canonical(ctx.projectDir);
  const listed = sources.listWorkspaces().find((w) => canonical(w.path) === served);
  return listed
    ? { key: listed.key, name: basename(listed.path), path: listed.path, branch: listed.branch, isAnchor: listed.isAnchor, isServed: true }
    : { key: workspaceKeyOf(ctx), name: basename(ctx.projectDir), path: ctx.projectDir, branch: null, isAnchor: true, isServed: true };
}

/** Build the answer for the served worktree. Exported for tests. */
export function buildLiveAnalyzeSnapshot(ctx: ServerContext, sources: LiveSources, now = Date.now()): LiveAnalyzeSnapshot {
  const worktree = worktreeOf(ctx, sources);
  const progress = readAnalyzeProgress(ctx.svDir, { processCommandLine: sources.processCommandLine });
  const slot = svAnalyzeRunOf(workspaceKeyOf(ctx));
  const running = progress?.running === true;
  // The slot says the dashboard spawned a run; the progress file says it is a live one.
  const dashboardRun = slot?.running === true;
  const manifest = readJsonObject(join(ctx.svDir, "manifest.json"));
  const outputAvailable = slot !== null && (dashboardRun || !running);
  return {
    generatedAt: new Date(now).toISOString(),
    worktree,
    progress,
    startedFrom: running || dashboardRun ? (dashboardRun ? "dashboard" : "terminal") : null,
    output: {
      available: outputAvailable,
      lines: outputAvailable && slot ? slot.output.split("\n").map((l) => l.trimEnd()).filter(Boolean).slice(-LIVE_ANALYZE_OUTPUT_LINES) : [],
    },
    llm: resolveActiveModel(ctx.projectDir),
    costUsd: priceAnalyzeUsage(progress),
    modules: modulesOf(manifest),
    ...phaseResults(ctx.svDir, progress),
    narration: narrationOf(manifest),
    recent: recentRuns(ctx.svDir),
  };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const ANALYZE_PATH = "/api/live/analyze";
const STOP_PATH = "/api/live/analyze/stop";

function pidReusedMessage(pid: number, command: string): string {
  return `Process ${pid} is no longer the analysis (it is now "${command}"); not signalling it`;
}

/**
 * Signal the process a progress file names. Returns the HTTP outcome rather
 * than throwing: a process that is already gone, or one this server may not
 * signal, is an answer for the page, not a server error.
 *
 * The pid comes from a file, and after a hard kill the OS may have given it
 * to another program, so its command line must be an analyze's. Where `ps`
 * cannot say (it failed, or the process just exited) the signal is refused;
 * only on Windows, which has no command-line reader, does the pid alone do.
 */
function signalRecordedPid(
  pid: number,
  commandLine: ProcessCommandLine | undefined,
): { ok: true } | { ok: false; status: number; error: string } {
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) {
    return { ok: false, status: 409, error: "The analysis has no process to stop" };
  }
  const check = confirmAnalyzeProcess(pid, commandLine);
  if (check.analyze === false) {
    return { ok: false, status: 409, error: pidReusedMessage(pid, check.command ?? "") };
  }
  if (check.analyze === null && process.platform !== "win32") {
    return { ok: false, status: 409, error: `Could not confirm process ${pid} is the analysis; not signalling it` };
  }
  try {
    process.kill(pid, "SIGTERM");
    return { ok: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return { ok: false, status: 403, error: `Not allowed to stop process ${pid}` };
    return { ok: false, status: 409, error: "The analysis has already ended" };
  }
}

/**
 * Handle GET /api/live/analyze and POST /api/live/analyze/stop. Returns true
 * if the request was handled.
 */
export function handleLiveAnalyzeRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  sources: LiveSources,
): boolean {
  const url = (req.url || "/").split("?")[0];
  const method = req.method || "GET";
  if (url === ANALYZE_PATH && method === "GET") {
    jsonResponse(res, 200, buildLiveAnalyzeSnapshot(ctx, sources));
    return true;
  }
  if (url !== STOP_PATH || method !== "POST") return false;

  const commandLine = sources.processCommandLine;
  const progress = readAnalyzeProgress(ctx.svDir, { processCommandLine: commandLine });
  if (!progress?.running) {
    const why = progress?.pidReusedBy ? pidReusedMessage(progress.pid, progress.pidReusedBy) : "No analysis is running in this worktree";
    errorResponse(res, 409, why);
    return true;
  }
  if (svAnalyzeRunOf(workspaceKeyOf(ctx))?.running) {
    errorResponse(res, 409, "This analysis was started from the dashboard; stop it with POST /api/commands/sv-analyze/stop");
    return true;
  }
  const outcome = signalRecordedPid(progress.pid, commandLine);
  if (!outcome.ok) {
    errorResponse(res, outcome.status, outcome.error);
    return true;
  }
  jsonResponse(res, 200, { ok: true, message: `Stop requested (pid ${progress.pid}); the run halts after the current step.` });
  return true;
}
