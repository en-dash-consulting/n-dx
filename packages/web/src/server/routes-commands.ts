/**
 * Command trigger API routes — invoke CLI operations from the dashboard.
 *
 * All endpoints are under /api/commands/.
 *
 * POST /api/commands/sv-analyze      — re-run sourcevision analyze (full: true → async, see status)
 * GET  /api/commands/sv-analyze/status — check running full-analysis status
 * POST /api/commands/sync            — rex sync (body: { direction: "push"|"pull"|"sync" })
 * POST /api/commands/recommend       — rex recommend (refresh sourcevision-based recommendations)
 * POST /api/commands/export          — ndx export static dashboard
 * POST /api/commands/self-heal       — ndx self-heal iterative loop (body: { iterations?: number })
 * GET  /api/commands/self-heal/status — check running self-heal status
 * POST /api/commands/self-heal/stop   — cancel the running self-heal loop
 * POST /api/commands/refresh         — refresh SourceVision data (live server; --data-only --live-server)
 * GET  /api/commands/refresh/status  — check running refresh status
 * GET  /api/commands/manifest        — grouped command reference with resolved CLI name and availability
 * POST /api/commands/fix             — rex fix (body: { dryRun?: boolean }); repairs PRD validation issues
 * POST /api/commands/ci              — ndx ci analysis + health validation (async, see status)
 * GET  /api/commands/ci/status       — CI check status and structured report
 * POST /api/commands/reshape         — rex reshape (body: { accept?: boolean }); previews unless accepted
 * GET  /api/commands/reshape/status  — reshape status and proposal report
 * GET  /api/commands/auth            — verify LLM provider credentials (read-only)
 * POST /api/commands/validate-tokens — hench vendor token-accuracy check
 * POST /api/commands/export-pdf      — sourcevision PDF report (returns the written path)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { exec as foundationExec, spawnManaged } from "@n-dx/llm-client";
import type { ManagedChild, SpawnToolResult } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import { readCliName } from "./cli-name.js";
import type { WebSocketBroadcaster } from "./websocket.js";

const CMD_PREFIX = "/api/commands/";

// ── Self-heal state tracking ──────────────────────────────────────────

interface SelfHealStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  iterations: number;
  output: string;
  error: string | null;
  /** True when the last run ended because an operator pressed Stop. */
  stopped: boolean;
}

/**
 * Handle for the in-flight self-heal loop.
 *
 * Kept outside the wire status (a process handle is not serialisable) so the
 * stop endpoint can signal the child without the status carrying it.
 */
let selfHealChild: ManagedChild | null = null;
let selfHealStopRequested = false;

// Module-level singleton — one self-heal at a time per server process.
const selfHealStatus: SelfHealStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  iterations: 0,
  output: "",
  error: null,
  stopped: false,
};

// ── Binary resolution helpers ─────────────────────────────────────────

/**
 * Resolve an n-dx CLI: project-local install first, then the package
 * resolved from THIS server's own module graph (correct for any analyzed
 * project — the CLIs ship with the running n-dx install), and only then the
 * monorepo dogfood path (valid solely when analyzing the n-dx repo itself).
 * The middle step prevents `Cannot find module
 * '<projectDir>/packages/<pkg>/dist/cli/index.js'` for non-n-dx projects.
 *
 * The CLI subpath is resolved directly (e.g. `@n-dx/rex/dist/cli/index.js`):
 * these packages' `exports["."]` only define an `import` condition, so a bare
 * CJS `require.resolve("@n-dx/rex")` throws ERR_PACKAGE_PATH_NOT_EXPORTED.
 * The subpath matches the `"./dist/*"` export and resolves under CJS.
 */
function resolveNdxCli(
  projectDir: string,
  localBin: string,
  pkg: string,
  dogfoodRel: string[],
): { bin: string; args: string[] } {
  const local = join(projectDir, "node_modules", ".bin", localBin);
  if (existsSync(local)) return { bin: local, args: [] };
  try {
    const req = createRequire(import.meta.url);
    const cli = req.resolve(`${pkg}/dist/cli/index.js`);
    if (existsSync(cli)) return { bin: "node", args: [cli] };
  } catch {
    /* fall through to dogfood path */
  }
  return { bin: "node", args: [join(projectDir, ...dogfoodRel)] };
}

function resolveSvBin(ctx: ServerContext): { bin: string; args: string[] } {
  return resolveNdxCli(ctx.projectDir, "sourcevision", "@n-dx/sourcevision",
    ["packages", "sourcevision", "dist", "cli", "index.js"]);
}

function resolveRexBin(ctx: ServerContext): { bin: string; args: string[] } {
  return resolveNdxCli(ctx.projectDir, "rex", "@n-dx/rex",
    ["packages", "rex", "dist", "cli", "index.js"]);
}

function resolveNdxBin(ctx: ServerContext): { bin: string; args: string[] } {
  const bin = join(ctx.projectDir, "node_modules", ".bin", "ndx");
  if (existsSync(bin)) return { bin, args: [] };
  const fallback = join(ctx.projectDir, "packages", "core", "cli.js");
  return { bin: "node", args: [fallback] };
}

/**
 * Map a managed child's exit to a status error string (null on success).
 * `exitCode: null` means the spawn-level timeout fired and killed the child.
 */
function managedChildError(
  result: SpawnToolResult,
  timeoutMs: number,
): string | null {
  if (result.exitCode === 0) return null;
  if (result.exitCode === null) {
    return `Timed out after ${Math.round(timeoutMs / 1000)}s`;
  }
  return (result.stderr || `Exited with code ${result.exitCode}`).slice(-1000);
}

// ── Handlers ──────────────────────────────────────────────────────────

// ── Full-analysis state tracking ─────────────────────────────────────

interface SvAnalyzeStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Tail of the analyzer's output — phase and enrichment-pass lines. */
  recentOutput: string;
  error: string | null;
}

// Module-level singleton — one full analysis at a time per server process.
const svAnalyzeStatus: SvAnalyzeStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  recentOutput: "",
  error: null,
};

/**
 * POST /api/commands/sv-analyze — re-run sourcevision analyze.
 *
 * Quick runs (default / `lite: true`) execute synchronously and return 200
 * with the output. Full runs (`full: true` — all four enrichment passes,
 * which unlock the Architecture/Problems/Suggestions tabs) and targeted
 * runs (`targetPass: 2–4` — enrichment up to just the pass a locked view
 * needs) can take many minutes of LLM work, so they run as an async
 * singleton: 202 immediately, progress via
 * GET /api/commands/sv-analyze/status. Either way the viewer's data polling
 * repopulates the tabs when the new files land.
 */
async function handleSvAnalyze(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let lite = false;
  let full = false;
  let targetPass: number | undefined;
  try {
    const body = await readBody(req);
    if (body) {
      const input = JSON.parse(body) as { lite?: boolean; full?: boolean; targetPass?: number };
      lite = !!input.lite;
      full = !!input.full;
      if (input.targetPass !== undefined) {
        if (!Number.isInteger(input.targetPass) || input.targetPass < 2 || input.targetPass > 4) {
          errorResponse(res, 400, "targetPass must be an integer between 2 and 4");
          return true;
        }
        targetPass = input.targetPass;
      }
    }
  } catch {
    // Use defaults
  }

  const { bin, args: prefixArgs } = resolveSvBin(ctx);
  const cmdArgs = [...prefixArgs, "analyze"];
  if (lite) cmdArgs.push("--lite");
  if (full) cmdArgs.push("--full");
  else if (targetPass !== undefined) cmdArgs.push(`--target-pass=${targetPass}`);
  cmdArgs.push(ctx.projectDir);

  // Both full runs and targeted enrichment runs involve LLM passes that can
  // take minutes — run them as the async singleton with status polling.
  if (full || targetPass !== undefined) {
    if (svAnalyzeStatus.running) {
      jsonResponse(res, 409, {
        error: "A full analysis is already running",
        startedAt: svAnalyzeStatus.startedAt,
      });
      return true;
    }

    svAnalyzeStatus.running = true;
    svAnalyzeStatus.startedAt = new Date().toISOString();
    svAnalyzeStatus.finishedAt = null;
    svAnalyzeStatus.recentOutput = "";
    svAnalyzeStatus.error = null;

    if (broadcast) {
      broadcast({ type: "commands:sv-analyze-started", timestamp: svAnalyzeStatus.startedAt });
    }

    jsonResponse(res, 202, {
      ok: true,
      startedAt: svAnalyzeStatus.startedAt,
      message: full
        ? "Full analysis started. Poll /api/commands/sv-analyze/status for progress."
        : `Enrichment to pass ${targetPass} started. Poll /api/commands/sv-analyze/status for progress.`,
    });

    // spawnManaged with piped stdio streams stdout chunk-by-chunk, so the
    // status endpoint shows live progress while the passes run — the
    // buffered exec() only hands output over after the child exits.
    const analyzeTimeout = 1_800_000; // 30 minutes — four LLM enrichment passes
    const child = spawnManaged(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: analyzeTimeout,
      stdio: "pipe",
      onStdout: (chunk) => {
        svAnalyzeStatus.recentOutput =
          (svAnalyzeStatus.recentOutput + chunk).slice(-3000);
      },
    });
    child.done.then((result) => {
      svAnalyzeStatus.running = false;
      svAnalyzeStatus.finishedAt = new Date().toISOString();
      svAnalyzeStatus.recentOutput = (result.stdout || "").trim().slice(-3000);
      svAnalyzeStatus.error = managedChildError(result, analyzeTimeout);

      if (broadcast) {
        broadcast({
          type: "sv:data-changed",
          source: "sv-analyze-full",
          ok: !svAnalyzeStatus.error,
          timestamp: svAnalyzeStatus.finishedAt,
        });
      }
    }).catch((err: unknown) => {
      svAnalyzeStatus.running = false;
      svAnalyzeStatus.finishedAt = new Date().toISOString();
      svAnalyzeStatus.error = String(err);
    });

    return true;
  }

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 180_000,
      maxBuffer: 20 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Analysis failed: ${result.stderr || result.error.message}`);
      return true;
    }

    if (broadcast) {
      broadcast({ type: "sv:data-changed", source: "sv-analyze", timestamp: new Date().toISOString() });
    }

    jsonResponse(res, 200, {
      ok: true,
      output: result.stdout.trim().slice(-2000),
    });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** GET /api/commands/sv-analyze/status */
function handleSvAnalyzeStatus(
  _req: IncomingMessage,
  res: ServerResponse,
): boolean {
  jsonResponse(res, 200, { ...svAnalyzeStatus });
  return true;
}

/** POST /api/commands/sync — rex sync push/pull */
async function handleSync(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let direction: "push" | "pull" | "sync" = "sync";
  try {
    const body = await readBody(req);
    if (body) {
      const input = JSON.parse(body) as { direction?: string };
      if (input.direction === "push" || input.direction === "pull" || input.direction === "sync") {
        direction = input.direction;
      }
    }
  } catch {
    // Use default
  }

  const { bin, args: prefixArgs } = resolveRexBin(ctx);
  const cmdArgs = [...prefixArgs, "sync", "--format=json"];
  if (direction === "push") cmdArgs.push("--push");
  if (direction === "pull") cmdArgs.push("--pull");
  cmdArgs.push(ctx.projectDir);

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Sync failed: ${result.stderr || result.error.message}`);
      return true;
    }

    if (broadcast) {
      broadcast({ type: "rex:prd-changed", source: "sync", timestamp: new Date().toISOString() });
    }

    try {
      const parsed = JSON.parse(result.stdout) as Record<string, unknown>;
      jsonResponse(res, 200, { ok: true, ...parsed });
    } catch {
      jsonResponse(res, 200, { ok: true, output: result.stdout.trim().slice(-2000) });
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** POST /api/commands/recommend — rex recommend */
async function handleRecommend(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const { bin, args: prefixArgs } = resolveRexBin(ctx);
  const cmdArgs = [...prefixArgs, "recommend", "--format=json", "--actionable-only", ctx.projectDir];

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Recommend failed: ${result.stderr || result.error.message}`);
      return true;
    }

    try {
      const parsed = JSON.parse(result.stdout);
      // `rex recommend --format=json` emits a JSON array of recommendations.
      // Spreading an array into an object turns it into numeric-keyed props
      // and loses the count, so expose it under a named key instead.
      if (Array.isArray(parsed)) {
        jsonResponse(res, 200, { ok: true, recommendations: parsed, count: parsed.length });
      } else {
        jsonResponse(res, 200, { ok: true, ...(parsed as Record<string, unknown>) });
      }
    } catch {
      jsonResponse(res, 200, { ok: true, output: result.stdout.trim().slice(-2000) });
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** POST /api/commands/export — ndx export static dashboard */
async function handleExport(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let outDir: string | undefined;
  try {
    const body = await readBody(req);
    if (body) {
      const input = JSON.parse(body) as { outDir?: string };
      if (input.outDir && typeof input.outDir === "string") {
        outDir = input.outDir.trim();
      }
    }
  } catch {
    // Use defaults
  }

  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [...prefixArgs, "export"];
  if (outDir) cmdArgs.push(`--out-dir=${outDir}`);
  cmdArgs.push(ctx.projectDir);

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Export failed: ${result.stderr || result.error.message}`);
      return true;
    }

    jsonResponse(res, 200, { ok: true, output: result.stdout.trim().slice(-2000) });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** POST /api/commands/self-heal — ndx self-heal (background) */
async function handleSelfHeal(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  if (selfHealStatus.running) {
    jsonResponse(res, 409, {
      error: "Self-heal is already running",
      startedAt: selfHealStatus.startedAt,
    });
    return true;
  }

  let iterations = 3;
  try {
    const body = await readBody(req);
    if (body) {
      const input = JSON.parse(body) as { iterations?: number };
      if (typeof input.iterations === "number" && input.iterations > 0 && input.iterations <= 10) {
        iterations = input.iterations;
      }
    }
  } catch {
    // Use defaults
  }

  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [...prefixArgs, "self-heal", String(iterations), ctx.projectDir];

  // Reset status and start background execution
  selfHealStatus.running = true;
  selfHealStatus.startedAt = new Date().toISOString();
  selfHealStatus.finishedAt = null;
  selfHealStatus.iterations = iterations;
  selfHealStatus.output = "";
  selfHealStatus.error = null;
  selfHealStatus.stopped = false;
  selfHealStopRequested = false;

  if (broadcast) {
    broadcast({ type: "commands:self-heal-started", timestamp: selfHealStatus.startedAt });
  }

  // Return 202 immediately, run in background
  jsonResponse(res, 202, {
    ok: true,
    startedAt: selfHealStatus.startedAt,
    iterations,
    message: "Self-heal started. Poll /api/commands/self-heal/status for progress.",
  });

  // Run in background (fire-and-forget from response perspective).
  // spawnManaged streams stdout as it arrives — the SelfHealPanel parses
  // iteration/phase progress from `output` while the loop is running — and
  // its kill() backs the stop endpoint.
  const selfHealTimeout = 600_000; // 10 minutes
  const child = spawnManaged(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout: selfHealTimeout,
    stdio: "pipe",
    onStdout: (chunk) => {
      selfHealStatus.output = (selfHealStatus.output + chunk).slice(-5000);
    },
  });
  selfHealChild = child;
  child.done.then((result) => {
    // An operator-requested stop is a normal outcome, not a failure: the
    // kill it triggers must not be reported as an error.
    const wasStopped = selfHealStopRequested;
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.output = (result.stdout || "").trim().slice(-5000);
    selfHealStatus.stopped = wasStopped;
    selfHealStatus.error = wasStopped
      ? null
      : managedChildError(result, selfHealTimeout);
    selfHealChild = null;
    selfHealStopRequested = false;

    if (broadcast) {
      broadcast({
        type: "commands:self-heal-finished",
        ok: wasStopped || !selfHealStatus.error,
        stopped: wasStopped,
        timestamp: selfHealStatus.finishedAt,
      });
    }
  }).catch((err: unknown) => {
    const wasStopped = selfHealStopRequested;
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.stopped = wasStopped;
    selfHealStatus.error = wasStopped ? null : String(err);
    selfHealChild = null;
    selfHealStopRequested = false;

    if (broadcast) {
      broadcast({
        type: "commands:self-heal-finished",
        ok: wasStopped,
        stopped: wasStopped,
        timestamp: selfHealStatus.finishedAt,
      });
    }
  });

  return true;
}

/**
 * POST /api/commands/self-heal/stop — cancel the running loop.
 *
 * Self-heal makes autonomous PRD and code changes, so an operator needs a way
 * to interrupt it. Killing the managed child (SIGTERM) ends the loop; the run
 * then reports `stopped: true` with no error.
 */
function handleSelfHealStop(
  _req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!selfHealStatus.running || !selfHealChild) {
    jsonResponse(res, 409, { error: "Self-heal is not running" });
    return true;
  }
  selfHealStopRequested = true;
  selfHealChild.kill("SIGTERM");
  jsonResponse(res, 200, { ok: true, message: "Stop requested; the loop will halt after the current step." });
  return true;
}

/** GET /api/commands/self-heal/status */
function handleSelfHealStatus(
  _req: IncomingMessage,
  res: ServerResponse,
): boolean {
  jsonResponse(res, 200, { ...selfHealStatus });
  return true;
}

// ── Refresh (live-server data refresh) ────────────────────────────────

interface RefreshStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  fast: boolean;
  /** Phase lines emitted by the CLI's `[refresh]` progress tags. */
  phases: string[];
  output: string;
  error: string | null;
}

// Module-level singleton — one refresh at a time per server process.
const refreshStatus: RefreshStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  fast: false,
  phases: [],
  output: "",
  error: null,
};

/** Extract the `[refresh] …` phase lines from CLI output (ANSI stripped). */
function parseRefreshPhases(stdout: string): string[] {
  // eslint-disable-next-line no-control-regex
  const plain = stdout.replace(/\[[0-9;]*m/g, "");
  return plain
    .split("\n")
    .filter((line) => line.startsWith("[refresh]"))
    .map((line) => line.slice("[refresh]".length).trim())
    .filter(Boolean);
}

/**
 * POST /api/commands/refresh — refresh SourceVision data while the dashboard
 * keeps running. Spawns `ndx refresh --data-only --live-server`; the
 * --live-server plan is validated CLI-side to never rebuild the UI assets
 * this server is serving, and skips the pre-refresh server termination.
 */
async function handleRefresh(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  if (refreshStatus.running) {
    jsonResponse(res, 409, {
      error: "A refresh is already running",
      startedAt: refreshStatus.startedAt,
    });
    return true;
  }

  let fast = false;
  try {
    const body = await readBody(req);
    if (body) {
      const input = JSON.parse(body) as { fast?: boolean };
      fast = !!input.fast;
    }
  } catch {
    // Use defaults
  }

  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [...prefixArgs, "refresh", "--data-only", "--live-server"];
  if (fast) cmdArgs.push("--fast");
  cmdArgs.push(ctx.projectDir);

  refreshStatus.running = true;
  refreshStatus.startedAt = new Date().toISOString();
  refreshStatus.finishedAt = null;
  refreshStatus.fast = fast;
  refreshStatus.phases = [];
  refreshStatus.output = "";
  refreshStatus.error = null;

  if (broadcast) {
    broadcast({ type: "commands:refresh-started", timestamp: refreshStatus.startedAt });
  }

  // Return 202 immediately, run in background
  jsonResponse(res, 202, {
    ok: true,
    startedAt: refreshStatus.startedAt,
    message: "Refresh started. Poll /api/commands/refresh/status for progress.",
  });

  // spawnManaged streams stdout as it arrives so the RefreshPanel can show
  // completed `[refresh]` phases while the run is still going. Phase parsing
  // needs whole lines, so accumulate the raw stream (capped) rather than
  // parsing the tail-sliced display output.
  const refreshTimeout = 300_000; // 5 minutes — data analysis, no UI build
  let streamed = "";
  const child = spawnManaged(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout: refreshTimeout,
    stdio: "pipe",
    onStdout: (chunk) => {
      streamed = (streamed + chunk).slice(-1_000_000);
      refreshStatus.output = streamed.trim().slice(-5000);
      refreshStatus.phases = parseRefreshPhases(streamed);
    },
  });
  child.done.then((result) => {
    refreshStatus.running = false;
    refreshStatus.finishedAt = new Date().toISOString();
    refreshStatus.output = (result.stdout || "").trim().slice(-5000);
    refreshStatus.phases = parseRefreshPhases(result.stdout || "");
    refreshStatus.error = managedChildError(result, refreshTimeout);

    if (broadcast) {
      broadcast({
        type: "sv:data-changed",
        source: "refresh",
        ok: !refreshStatus.error,
        timestamp: refreshStatus.finishedAt,
      });
    }
  }).catch((err: unknown) => {
    refreshStatus.running = false;
    refreshStatus.finishedAt = new Date().toISOString();
    refreshStatus.error = String(err);
  });

  return true;
}

/** GET /api/commands/refresh/status */
function handleRefreshStatus(
  _req: IncomingMessage,
  res: ServerResponse,
): boolean {
  jsonResponse(res, 200, { ...refreshStatus });
  return true;
}

// ── Async job helper ──────────────────────────────────────────────────

/**
 * Status of a background command that produces a structured report.
 *
 * `ci` and `reshape` both run a long CLI pass and return JSON, so they share
 * one shape rather than each growing its own near-identical singleton.
 */
interface AsyncJobStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Parsed `--format=json` payload, when the CLI produced one. */
  report: unknown;
  /** Raw output tail — the fallback when stdout was not JSON. */
  output: string;
  error: string | null;
}

function newJobStatus(): AsyncJobStatus {
  return { running: false, startedAt: null, finishedAt: null, report: null, output: "", error: null };
}

const ciStatus = newJobStatus();
const reshapeStatus = newJobStatus();

/**
 * Start a background CLI job that reports through `status`, or answer 409 when
 * one is already in flight. Returns 202 immediately; the caller polls.
 */
function startAsyncJob(
  res: ServerResponse,
  status: AsyncJobStatus,
  label: string,
  bin: string,
  cmdArgs: string[],
  ctx: ServerContext,
  timeout: number,
  broadcast?: WebSocketBroadcaster,
  broadcastType?: string,
): boolean {
  if (status.running) {
    jsonResponse(res, 409, { error: `${label} is already running`, startedAt: status.startedAt });
    return true;
  }

  status.running = true;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.report = null;
  status.output = "";
  status.error = null;

  jsonResponse(res, 202, {
    ok: true,
    startedAt: status.startedAt,
    message: `${label} started. Poll the status endpoint for progress.`,
  });

  foundationExec(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout,
    maxBuffer: 20 * 1024 * 1024,
  }).then((result) => {
    status.running = false;
    status.finishedAt = new Date().toISOString();
    status.output = (result.stdout || "").trim().slice(-5000);
    try {
      status.report = JSON.parse(result.stdout);
    } catch {
      status.report = null; // not JSON — `output` carries the text
    }
    status.error = result.error ? (result.stderr || result.error.message).slice(-1000) : null;

    if (broadcast && broadcastType) {
      broadcast({ type: broadcastType, ok: !result.error, timestamp: status.finishedAt });
    }
  }).catch((err: unknown) => {
    status.running = false;
    status.finishedAt = new Date().toISOString();
    status.error = String(err);
  });

  return true;
}

// ── Validation actions: rex fix, ndx ci, rex reshape ──────────────────

/**
 * POST /api/commands/fix — `rex fix`, repairing common PRD validation issues.
 *
 * `{ dryRun: true }` adds `--dry-run` so the dashboard can show what would
 * change before touching the PRD. Synchronous: fix is a fast local pass.
 */
async function handleFix(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let dryRun = false;
  try {
    const body = await readBody(req);
    if (body) dryRun = (JSON.parse(body) as { dryRun?: boolean }).dryRun === true;
  } catch {
    // Use defaults
  }

  const { bin, args: prefixArgs } = resolveRexBin(ctx);
  const cmdArgs = [...prefixArgs, "fix", "--format=json"];
  if (dryRun) cmdArgs.push("--dry-run");
  cmdArgs.push(ctx.projectDir);

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Fix failed: ${result.stderr || result.error.message}`);
      return true;
    }

    if (broadcast && !dryRun) {
      broadcast({ type: "rex:prd-changed", source: "fix", timestamp: new Date().toISOString() });
    }

    try {
      jsonResponse(res, 200, { ok: true, dryRun, report: JSON.parse(result.stdout) });
    } catch {
      jsonResponse(res, 200, { ok: true, dryRun, output: result.stdout.trim().slice(-2000) });
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** POST /api/commands/ci — `ndx ci` analysis + PRD health validation. */
function handleCi(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  return startAsyncJob(
    res, ciStatus, "CI check", bin,
    [...prefixArgs, "ci", "--format=json", ctx.projectDir],
    ctx, 900_000, // 15 minutes — runs the full analysis pipeline
    broadcast, "commands:ci-finished",
  );
}

/**
 * POST /api/commands/reshape — `rex reshape`, LLM-driven PRD restructuring.
 *
 * Defaults to `--dry-run` so the dashboard always previews proposals first;
 * `{ accept: true }` applies them. Async because the LLM pass is slow.
 */
async function handleReshape(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let accept = false;
  try {
    const body = await readBody(req);
    if (body) accept = (JSON.parse(body) as { accept?: boolean }).accept === true;
  } catch {
    // Preview by default — never restructure the PRD without an explicit accept.
  }

  const { bin, args: prefixArgs } = resolveRexBin(ctx);
  // --quiet is load-bearing: reshape emits info() progress lines to stdout
  // even with --format=json, which would break the JSON.parse in
  // startAsyncJob. Quiet suppresses info() while result() still emits JSON.
  const cmdArgs = [...prefixArgs, "reshape", "--format=json", "--quiet"];
  cmdArgs.push(accept ? "--accept" : "--dry-run");
  cmdArgs.push(ctx.projectDir);

  return startAsyncJob(
    res, reshapeStatus, "Reshape", bin, cmdArgs, ctx,
    900_000, // 15 minutes — LLM restructuring pass
    broadcast, accept ? "rex:prd-changed" : undefined,
  );
}

// ── Tier 3: credential check and small package triggers ───────────────

/**
 * GET /api/commands/auth — verify LLM provider credentials.
 *
 * Read-only (hence GET): runs `ndx auth`, whose exit code answers "are the
 * configured provider's credentials usable". Surfaced as a chip in LLM
 * settings so a missing key is visible *before* an agent command fails.
 */
async function handleAuth(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  try {
    const result = await foundationExec(bin, [...prefixArgs, "auth", ctx.projectDir], {
      cwd: ctx.projectDir,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const ok = !result.error;
    jsonResponse(res, 200, {
      ok,
      output: result.stdout.trim().slice(-2000),
      error: ok ? null : (result.stderr || result.error?.message || "Credential check failed").slice(-1000),
    });
  } catch (err) {
    // Report the failure in the body rather than as a 500: "could not check"
    // is a legitimate chip state, not a broken endpoint.
    jsonResponse(res, 200, { ok: false, output: "", error: String(err) });
  }
  return true;
}

/** POST /api/commands/validate-tokens — hench vendor token-accuracy check. */
async function handleValidateTokens(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const { bin, args: prefixArgs } = resolveNdxCli(
    ctx.projectDir, "hench", "@n-dx/hench",
    ["packages", "hench", "dist", "cli", "index.js"],
  );
  try {
    const result = await foundationExec(bin, [...prefixArgs, "validate-tokens", ctx.projectDir], {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Token validation failed: ${result.stderr || result.error.message}`);
      return true;
    }
    jsonResponse(res, 200, { ok: true, output: result.stdout.trim().slice(-4000) });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/**
 * POST /api/commands/export-pdf — sourcevision PDF report.
 *
 * Reports the path the CLI wrote. The dashboard cannot hand the file to the
 * browser (the viewer sandbox blocks downloads it initiates), so the path is
 * the useful result.
 */
async function handleExportPdf(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const { bin, args: prefixArgs } = resolveSvBin(ctx);
  try {
    const result = await foundationExec(bin, [...prefixArgs, "export-pdf", ctx.projectDir], {
      cwd: ctx.projectDir,
      timeout: 300_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    if (result.error && !result.stdout) {
      errorResponse(res, 500, `PDF export failed: ${result.stderr || result.error.message}`);
      return true;
    }
    jsonResponse(res, 200, { ok: true, output: result.stdout.trim().slice(-2000) });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

// ── Command reference manifest ────────────────────────────────────────

type CommandStatus = "available" | "needs-init" | "needs-llm";

/**
 * Dashboard trigger for a command. When present, the Commands reference
 * renders an inline Run button that POSTs `endpoint` — the same endpoint the
 * command's primary view uses, so results are identical. `statusEndpoint`
 * marks async singletons (202 + poll) like refresh and full analysis.
 */
interface CommandTrigger {
  endpoint: string;
  method: "POST";
  statusEndpoint?: string;
}

interface ManifestCommand {
  /** Subcommand name, e.g. "plan". */
  name: string;
  /** One-line description shown in the reference row. */
  description: string;
  /** What the command needs before it can run. */
  requires?: "init" | "llm";
  /**
   * Dashboard trigger, when the command supports one. Deliberately absent
   * for: `work` (requires task selection — use the next-task card),
   * `self-heal` (destructive; confirmation-gated panel), and terminal-side
   * commands (init, auth, config, start, dev).
   */
  trigger?: CommandTrigger;
}

interface ManifestGroup {
  id: string;
  label: string;
  commands: ManifestCommand[];
}

/**
 * Server-driven command manifest — the single place to add or edit commands
 * shown in the dashboard's Commands reference section. The viewer renders
 * whatever this returns, so new commands appear without UI code changes.
 *
 * `requires: "init"` — needs the tool directories (.rex/.sourcevision/.hench).
 * `requires: "llm"` — additionally drives an LLM. Informational: the CLI
 * resolves an absent llm.vendor to "claude", so this never gates status.
 */
const COMMAND_MANIFEST: ManifestGroup[] = [
  {
    id: "setup", label: "Setup", commands: [
      { name: "init", description: "Initialize project — sourcevision, rex, and hench directories plus LLM model selection" },
      { name: "auth", description: "Verify LLM provider credentials" },
    ],
  },
  {
    id: "analysis", label: "Analysis", commands: [
      { name: "analyze", description: "Run codebase analysis (--deep, --full, --lite)", requires: "init", trigger: { endpoint: "/api/commands/sv-analyze", method: "POST", statusEndpoint: "/api/commands/sv-analyze/status" } },
      { name: "recommend", description: "Show or accept sourcevision-based recommendations", requires: "llm", trigger: { endpoint: "/api/commands/recommend", method: "POST" } },
      { name: "refresh", description: "Refresh dashboard data and UI artifacts", requires: "init", trigger: { endpoint: "/api/commands/refresh", method: "POST", statusEndpoint: "/api/commands/refresh/status" } },
      { name: "ci", description: "Run the analysis pipeline and validate PRD health", requires: "init" },
    ],
  },
  {
    id: "planning", label: "Planning", commands: [
      { name: "plan", description: "Analyze the codebase and generate PRD proposals (--accept to apply)", requires: "llm", trigger: { endpoint: "/api/rex/analyze", method: "POST" } },
      { name: "add", description: "Add PRD items from freeform descriptions, files, or stdin", requires: "llm" },
      { name: "status", description: "Show the PRD status tree with completion stats", requires: "init" },
      { name: "next", description: "Print the next actionable task", requires: "init" },
      { name: "sync", description: "Sync the local PRD with a remote adapter (--push, --pull)", requires: "init", trigger: { endpoint: "/api/commands/sync", method: "POST" } },
    ],
  },
  {
    id: "execution", label: "Execution", commands: [
      { name: "work", description: "Execute the next task autonomously with the hench agent", requires: "llm" },
      { name: "self-heal", description: "Iterative improvement loop: analyze → recommend → execute", requires: "llm" },
      { name: "pair-programming", description: "Agent + cross-vendor review (alias: bicker)", requires: "llm" },
      { name: "start", description: "Start the server: dashboard + MCP endpoints", requires: "init" },
      { name: "dev", description: "Start the web dev server with live reload", requires: "init" },
      { name: "export", description: "Export a static deployable dashboard", requires: "init", trigger: { endpoint: "/api/commands/export", method: "POST" } },
    ],
  },
  {
    id: "config", label: "Configuration", commands: [
      { name: "config", description: "View or edit settings across all packages" },
      { name: "usage", description: "Token usage analytics (--group=day|week|month)", requires: "init" },
    ],
  },
];

/** GET /api/commands/manifest — grouped command reference with availability. */
function handleManifest(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const cliName = readCliName(ctx.projectDir);
  const initialized = [".rex", ".sourcevision", ".hench"]
    .every((d) => existsSync(join(ctx.projectDir, d)));

  // An LLM vendor is always resolvable: the CLI treats an absent (or empty,
  // or malformed) llm.vendor as "claude" (config.js runAuthCheck, reshape's
  // getLLMVendor() ?? "claude"), so an explicit vendor key must not gate
  // availability — LLM commands run fine on projects that never set one.
  // "needs-llm" stays in the wire type for when vendor resolution gains a
  // real failure mode; nothing produces it today.
  const statusFor = (cmd: ManifestCommand): CommandStatus => {
    if (!cmd.requires) return "available";
    return initialized ? "available" : "needs-init";
  };

  jsonResponse(res, 200, {
    cliName,
    groups: COMMAND_MANIFEST.map((group) => ({
      id: group.id,
      label: group.label,
      commands: group.commands.map((cmd) => ({
        name: cmd.name,
        invocation: `${cliName} ${cmd.name}`,
        description: cmd.description,
        status: statusFor(cmd),
        ...(cmd.trigger ? { trigger: cmd.trigger } : {}),
      })),
    })),
  });
  return true;
}

// ── Dispatcher ────────────────────────────────────────────────────────

/** Handle command trigger API requests. Returns true if the request was handled. */
export function handleCommandsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(CMD_PREFIX) && url !== CMD_PREFIX.slice(0, -1)) return false;

  const path = url.slice(CMD_PREFIX.length).split("?")[0];

  if (path === "sv-analyze" && method === "POST") {
    return handleSvAnalyze(req, res, ctx, broadcast);
  }
  if (path === "sv-analyze/status" && method === "GET") {
    return handleSvAnalyzeStatus(req, res);
  }
  if (path === "sync" && method === "POST") {
    return handleSync(req, res, ctx, broadcast);
  }
  if (path === "recommend" && method === "POST") {
    return handleRecommend(req, res, ctx);
  }
  if (path === "export" && method === "POST") {
    return handleExport(req, res, ctx);
  }
  if (path === "self-heal" && method === "POST") {
    return handleSelfHeal(req, res, ctx, broadcast);
  }
  if (path === "self-heal/status" && method === "GET") {
    return handleSelfHealStatus(req, res);
  }
  if (path === "self-heal/stop" && method === "POST") {
    return handleSelfHealStop(req, res);
  }
  if (path === "refresh" && method === "POST") {
    return handleRefresh(req, res, ctx, broadcast);
  }
  if (path === "refresh/status" && method === "GET") {
    return handleRefreshStatus(req, res);
  }
  if (path === "manifest" && method === "GET") {
    return handleManifest(req, res, ctx);
  }
  if (path === "auth" && method === "GET") {
    return handleAuth(req, res, ctx);
  }
  if (path === "validate-tokens" && method === "POST") {
    return handleValidateTokens(req, res, ctx);
  }
  if (path === "export-pdf" && method === "POST") {
    return handleExportPdf(req, res, ctx);
  }
  if (path === "fix" && method === "POST") {
    return handleFix(req, res, ctx, broadcast);
  }
  if (path === "ci" && method === "POST") {
    return handleCi(req, res, ctx, broadcast);
  }
  if (path === "ci/status" && method === "GET") {
    jsonResponse(res, 200, { ...ciStatus });
    return true;
  }
  if (path === "reshape" && method === "POST") {
    return handleReshape(req, res, ctx, broadcast);
  }
  if (path === "reshape/status" && method === "GET") {
    jsonResponse(res, 200, { ...reshapeStatus });
    return true;
  }

  return false;
}
