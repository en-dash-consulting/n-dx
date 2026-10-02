/**
 * Command trigger API routes — invoke CLI operations from the dashboard.
 *
 * All endpoints are under /api/commands/.
 *
 * POST /api/commands/init            — bootstrap ndx init from the dashboard's setup wizard (pre-init only)
 * GET  /api/commands/init/status     — check running init status
 * GET  /api/commands/init/preflight  — pre-init environment check (git repo / git on PATH)
 * POST /api/commands/sv-analyze      — re-run sourcevision analyze (full: true → async, see status)
 * GET  /api/commands/sv-analyze/status — check running full-analysis status
 * POST /api/commands/sv-analyze/stop — interrupt the running full analysis
 * POST /api/commands/sync            — rex sync (body: { direction: "push"|"pull"|"sync" })
 * POST /api/commands/recommend       — rex recommend (async, see status)
 * GET  /api/commands/recommend/status — recommend status and recommendation report
 * POST /api/commands/recommend/stop  — interrupt the running recommend pass
 * POST /api/commands/export          — ndx export static dashboard
 * POST /api/commands/self-heal       — ndx self-heal iterative loop (body: { iterations?: number })
 * GET  /api/commands/self-heal/status — check running self-heal status
 * POST /api/commands/self-heal/stop   — cancel the running self-heal loop
 * POST /api/commands/refresh         — refresh SourceVision data (live server; --data-only --live-server)
 * GET  /api/commands/refresh/status  — check running refresh status
 * POST /api/commands/refresh/stop    — interrupt the running refresh
 * GET  /api/commands/manifest        — grouped command reference with resolved CLI name and availability
 * POST /api/commands/fix             — rex fix (body: { dryRun?: boolean }); repairs PRD validation issues
 * POST /api/commands/ci              — ndx ci analysis + health validation (async, see status)
 * GET  /api/commands/ci/status       — CI check status and structured report
 * POST /api/commands/ci/stop         — interrupt the running CI check
 * POST /api/commands/reshape         — rex reshape (body: { accept?: boolean }); previews unless accepted
 * GET  /api/commands/reshape/status  — reshape status and proposal report
 * POST /api/commands/reshape/stop    — interrupt the running reshape pass
 * GET  /api/commands/auth            — verify LLM provider credentials (read-only)
 * POST /api/commands/validate-tokens — hench vendor token-accuracy check
 * POST /api/commands/export-pdf      — sourcevision PDF report (returns the written path)
 *
 * Every async trigger above is a {@link JobSlot}: a pollable status plus the
 * child handle its `/stop` needs. The dashboard's shared job tray polls those
 * status endpoints and offers Stop on every row — see
 * `viewer/hooks/use-active-operations.ts`.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { redactSecrets, exec as foundationExec, spawnManaged, isVerbose, isDebug, resolveLayout } from "@n-dx/llm-client";
import type { ManagedChild, SpawnToolResult } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { WorkspaceScoped } from "./workspace-scoped.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import { readCliName } from "./cli-name.js";
import { resolveEffectiveCliTimeoutMs } from "./routes-cli-timeout.js";
import { readAnalyzeProgress } from "./domain-gateway.js";
import type { WebSocketBroadcaster } from "./websocket.js";

const CMD_PREFIX = "/api/commands/";

/**
 * Flag to append to a spawned command trigger's argv, matching how this
 * dashboard server itself was launched (`ndx start --verbose` / `--debug`) —
 * one setting at server-launch time governs every command trigger's
 * verbosity, rather than a per-click "Verbose output" checkbox in the UI.
 * `isVerbose()`/`isDebug()` read the same process-wide flags `ndx start`
 * sets at startup (see `setVerbose`/`setDebug` in web/src/cli/index.ts).
 */
function serverVerbosityFlag(): "--debug" | "--verbose" | null {
  if (isDebug()) return "--debug";
  if (isVerbose()) return "--verbose";
  return null;
}

// ── Stoppable background jobs ─────────────────────────────────────────

/**
 * A background command trigger and the handle needed to interrupt it.
 *
 * Every async trigger on this surface has the same three parts, so they share
 * one shape rather than each growing its own: the serialisable `status` the
 * viewer polls, the process handle — which is *not* serialisable, hence kept
 * beside the status rather than in it, since the status endpoints spread it
 * straight onto the wire — and the flag that tells the completion handler an
 * exit was asked for rather than suffered.
 *
 * Every job in the dashboard's shared job tray is stoppable, and this is why:
 * a tray row offering Stop must have something to signal.
 */
interface JobSlot<S extends StoppableStatus> {
  status: S;
  child: ManagedChild | null;
  stopRequested: boolean;
}

/** The fields {@link stopJob} needs from any job's wire status. */
interface StoppableStatus {
  running: boolean;
  startedAt: string | null;
}

/**
 * Interrupt a running job, or answer 409 when there is nothing to interrupt.
 *
 * SIGTERM rather than SIGKILL: every one of these children is a CLI that
 * cleans up after itself, and a half-written `.sourcevision/` is worse than a
 * few extra seconds of shutdown. The run then reports `stopped: true` with no
 * error — an operator-requested halt is a normal outcome, not a failure.
 */
function stopJob(
  res: ServerResponse,
  slot: JobSlot<StoppableStatus>,
  label: string,
  message = "Stop requested; the run will halt after the current step.",
): boolean {
  if (!slot.status.running || !slot.child) {
    jsonResponse(res, 409, { error: `${label} is not running` });
    return true;
  }
  slot.stopRequested = true;
  slot.child.kill("SIGTERM");
  jsonResponse(res, 200, { ok: true, message });
  return true;
}

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

// One self-heal at a time per WORKSPACE — worktree A's loop must not block or
// report in worktree B.
const selfHealSlots = new WorkspaceScoped<JobSlot<SelfHealStatus>>(() => ({
  status: { running: false, startedAt: null, finishedAt: null, iterations: 0, output: "", error: null, stopped: false },
  child: null,
  stopRequested: false,
}));

// ── Setup-wizard init state tracking ──────────────────────────────────

const VALID_INIT_PROVIDERS = new Set(["claude", "codex", "google", "local"]);
const VALID_INIT_ASSISTANTS = new Set(["claude", "codex"]);

interface InitStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  output: string;
  error: string | null;
  /** True when this run was asked to create a git repository (`git: true`). */
  gitRequested: boolean;
  /**
   * Whether the directory is a git repository now that init has finished.
   * Null until a run that requested one completes — the wizard reports
   * "repository created" from this rather than from the run's exit code,
   * because `ndx init` treats a failed `git init` as a warning, not a failure.
   */
  gitInitialized: boolean | null;
}

// Module-level singleton — one init at a time per server process. The
// dashboard's setup wizard only ever appears pre-init (the landing page is
// only served when the project is uninitialized), so this never races with
// any other command trigger.
const initStatuses = new WorkspaceScoped<InitStatus>(() => ({
  running: false,
  startedAt: null,
  finishedAt: null,
  output: "",
  error: null,
  gitRequested: false,
  gitInitialized: null,
}));

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

/**
 * Resolve the ndx orchestrator CLI. Ladder:
 *
 *  1. `NDX_CLI_PATH` — the launching CLI's own path.
 *  2. Project-local `node_modules/.bin/ndx` — the analyzed project's own
 *     install, matching {@link resolveNdxCli}.
 *  3. `N_DX_CLI_PATH` — also the launching CLI's own path.
 *  4. `@n-dx/core/cli.js` resolved from THIS server's module graph — covers
 *     servers not started via ndx on flat (npm-hoisted) installs. Unlike the
 *     domain CLIs, this step often fails by design: web cannot declare
 *     @n-dx/core as a dependency (core depends on web — a cycle), so strict
 *     pnpm layouts won't resolve it.
 *  5. The monorepo dogfood path — valid solely when the analyzed project is
 *     the n-dx repo itself.
 *
 * Rungs 1 and 3 are one mechanism under two names: `cli.js` assigns both to
 * `fileURLToPath(import.meta.url)` on startup (packages/core/cli.js), so a
 * server started by `ndx start` knows the running install's cli.js whatever
 * the layout (global, npm, pnpm, monorepo). Rung 1 straddles the project-local
 * bin and rung 3 sits below it, which means the launcher outranks the analyzed
 * project's own install today — the two names were added at different times
 * and only rung 3's placement was deliberate. Consolidating them is a
 * behaviour change for anyone reading either name, so it is left alone; what
 * matters here is that both are documented and both are covered by the ladder
 * tests, because an ambient `NDX_CLI_PATH` answering silently from rung 1 is
 * what made the rungs below it untested.
 *
 * Both env rungs are guarded on `existsSync`. The value is exported to every
 * child of an `ndx` process, so it outlives the install that wrote it: a
 * dev-link install that moved or was uninstalled leaves a path that no longer
 * exists, and spawning it verbatim fails with MODULE_NOT_FOUND where the rungs
 * below would have resolved.
 */
export function resolveNdxBin(ctx: ServerContext): { bin: string; args: string[] } {
  const launcherCli = process.env["NDX_CLI_PATH"];
  if (launcherCli && existsSync(launcherCli)) {
    return { bin: "node", args: [launcherCli] };
  }
  const bin = join(ctx.projectDir, "node_modules", ".bin", "ndx");
  if (existsSync(bin)) return { bin, args: [] };

  const envCli = process.env["N_DX_CLI_PATH"];
  if (envCli && existsSync(envCli)) return { bin: "node", args: [envCli] };

  try {
    const req = createRequire(import.meta.url);
    const cli = req.resolve("@n-dx/core/cli.js");
    if (existsSync(cli)) return { bin: "node", args: [cli] };
  } catch {
    /* fall through to dogfood path */
  }

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

// ── Shared .sourcevision write lock ───────────────────────────────────

/**
 * Human label of the `.sourcevision/`-writing job currently in flight, or
 * null when none is.
 *
 * sv-analyze (every mode, including the synchronous quick path), refresh
 * --data-only, and ndx ci all rewrite `.sourcevision/`. The concurrency
 * contract forbids overlapping writers, but the per-job `running` flags
 * cannot see each other — three dashboard buttons could start three
 * concurrent writers. One shared lock covers them all, so a second writer
 * gets a 409 naming whatever is actually running instead of clobbering it.
 */
const svWriteJobs = new WorkspaceScoped<{ job: string | null }>(() => ({ job: null }));

/** Take the workspace's lock or answer 409 naming the in-flight job. */
function acquireSvWriteLock(res: ServerResponse, ctx: ServerContext, jobName: string): boolean {
  const lock = svWriteJobs.get(ctx);
  if (lock.job) {
    jsonResponse(res, 409, {
      error: `Cannot start ${jobName}: ${lock.job} is already running`,
      runningJob: lock.job,
    });
    return false;
  }
  lock.job = jobName;
  return true;
}

function releaseSvWriteLock(ctx: ServerContext): void {
  svWriteJobs.get(ctx).job = null;
}

// ── Handlers ──────────────────────────────────────────────────────────

// ── Full-analysis state tracking ─────────────────────────────────────
/**
 * The tail of a command's output as the dashboard shows it.
 *
 * Redact *before* slicing, never after: a tail boundary falling inside a token
 * leaves its surviving half unmatched by every rule, and therefore on screen.
 * Having one helper is the point — the live sv-analyze path scrubbed its
 * stream while the completion path overwrote the result with raw stdout, so
 * credentials appeared the moment the analysis finished.
 */
function outputTail(text: string, limit: number): string {
  return redactSecrets(text).slice(-limit);
}


interface SvAnalyzeStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Tail of the analyzer's output — phase and enrichment-pass lines. */
  recentOutput: string;
  error: string | null;
  /** True when the last run ended because an operator pressed Stop. */
  stopped: boolean;
}

// Module-level singleton — one full analysis at a time per server process.
const svAnalyzeSlots = new WorkspaceScoped<JobSlot<SvAnalyzeStatus>>(() => ({
  status: {
    running: false,
    startedAt: null,
    finishedAt: null,
    recentOutput: "",
    error: null,
    stopped: false,
  },
  child: null,
  stopRequested: false,
}));

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
  const svAnalyzeSlot = svAnalyzeSlots.get(ctx);
  const svAnalyzeStatus = svAnalyzeSlot.status;
  let lite = false;
  let full = false;
  let deep = false;
  let targetPass: number | undefined;
  try {
    const body = await readBody(req, res);
    if (body) {
      const input = JSON.parse(body) as { lite?: boolean; full?: boolean; deep?: boolean; targetPass?: number };
      lite = !!input.lite;
      full = !!input.full;
      deep = !!input.deep;
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
  // Re-analyzes detected sub-packages before the root analysis — combinable
  // with lite/full/targetPass, and does not itself trigger LLM enrichment
  // passes, so it doesn't change whether this runs sync vs. as the async job.
  if (deep) cmdArgs.push("--deep");
  const verboseFlag = serverVerbosityFlag();
  if (verboseFlag) cmdArgs.push(verboseFlag);
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
    const jobLabel = full ? "full analysis" : "targeted analysis";
    if (!acquireSvWriteLock(res, ctx, jobLabel)) return true;

    svAnalyzeStatus.running = true;
    svAnalyzeStatus.startedAt = new Date().toISOString();
    svAnalyzeStatus.finishedAt = null;
    svAnalyzeStatus.recentOutput = "";
    svAnalyzeStatus.error = null;
    svAnalyzeStatus.stopped = false;
    svAnalyzeSlot.stopRequested = false;

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
    // Honors the "CLI Timeouts" settings page's "analyze" entry (30 min
    // default) instead of hardcoding that default directly, so a user's
    // explicit cli.timeouts.analyze override actually takes effect here.
    const analyzeTimeout = resolveEffectiveCliTimeoutMs(ctx.projectDir, "analyze");
    const child = spawnManaged(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: analyzeTimeout,
      stdio: "pipe",
      onStdout: (chunk) => {
        // Live output goes to the dashboard; scrub it like a run record.
        svAnalyzeStatus.recentOutput = outputTail(svAnalyzeStatus.recentOutput + chunk, 3000);
      },
    });
    svAnalyzeSlot.child = child;
    const settleSvAnalyze = (error: string | null, stdout: string | null) => {
      const wasStopped = svAnalyzeSlot.stopRequested;
      svAnalyzeStatus.running = false;
      svAnalyzeStatus.finishedAt = new Date().toISOString();
      if (stdout !== null) svAnalyzeStatus.recentOutput = outputTail(stdout.trim(), 3000);
      svAnalyzeStatus.stopped = wasStopped;
      // A kill the operator asked for is not a failed analysis.
      svAnalyzeStatus.error = wasStopped ? null : error;
      svAnalyzeSlot.child = null;
      svAnalyzeSlot.stopRequested = false;
      releaseSvWriteLock(ctx);
    };
    child.done.then((result) => {
      settleSvAnalyze(managedChildError(result, analyzeTimeout), result.stdout || "");

      if (broadcast) {
        broadcast({
          type: "sv:data-changed",
          source: "sv-analyze-full",
          ok: !svAnalyzeStatus.error,
          timestamp: svAnalyzeStatus.finishedAt,
        });
      }
    }).catch((err: unknown) => {
      settleSvAnalyze(String(err), null);
    });

    return true;
  }

  // The quick path is synchronous but still rewrites .sourcevision/, so it
  // takes the same lock — a quick re-analyze on top of a full run corrupts
  // the analysis exactly like any other overlapping writer.
  if (!acquireSvWriteLock(res, ctx, "quick analysis")) return true;
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
      output: outputTail(result.stdout.trim(), 2000),
    });
  } catch (err) {
    errorResponse(res, 500, String(err));
  } finally {
    releaseSvWriteLock(ctx);
  }
  return true;
}

/**
 * GET /api/commands/sv-analyze/status
 *
 * The dashboard job's slot (`running`, `recentOutput`, …) as before, plus
 * `progress`: the structured progress the analyzing process itself publishes
 * (phase, pass, batch, LLM use, the previous same-mode run's phase timings).
 * The slot only knows runs this server started; `progress` covers a run
 * started from a terminal too, so it can say running while `running` is false.
 * Null until any analysis has run under the progress writer.
 */
function handleSvAnalyzeStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  jsonResponse(res, 200, { ...svAnalyzeSlots.get(ctx).status, progress: readAnalyzeProgress(ctx.svDir) });
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
    const body = await readBody(req, res);
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
      jsonResponse(res, 200, { ok: true, output: outputTail(result.stdout.trim(), 2000) });
    }
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/**
 * POST /api/commands/recommend — `rex recommend`.
 *
 * Async, like every other LLM-backed trigger on this surface: the pass takes
 * minutes, and a synchronous handler held the browser request open for all of
 * them with no progress, no Stop, and no presence in the shared job tray.
 * `report` carries the parsed payload — for `--format=json` that is a JSON
 * *array* of recommendations, which is why it is stored whole rather than
 * spread onto the response (spreading an array yields numeric-keyed props and
 * loses the count).
 */
function handleRecommend(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean {
  const { bin, args: prefixArgs } = resolveRexBin(ctx);
  return startAsyncJob(
    res, recommendJobs.get(ctx), "Recommend", bin,
    [...prefixArgs, "recommend", "--format=json", "--actionable-only", ctx.projectDir],
    ctx, 120_000, broadcast, "commands:recommend-finished",
  );
}

/**
 * POST /api/commands/export — ndx export static dashboard
 *
 * `deploy: "github"` additionally force-pushes the exported output to the
 * `n-dx-dashboard` branch on the project's git remote (see `deployToGitHubPages`
 * in packages/core/export.js). That is a real, irreversible remote write, so it
 * requires `confirmDeploy: true` in the body — set by the viewer's confirmation
 * step — and is refused (400) without it. The spawned CLI has no TTY and would
 * refuse `--deploy=github` on its own; this route passes `--yes` to carry the
 * confirmation already collected in the browser past that refusal. `deploy`
 * without `confirmDeploy` is refused rather than silently downgraded, so a
 * plain export request can never turn into a deploy. `includeTranscripts: true`
 * maps to `--include-transcripts`; by default agent transcripts are stripped.
 */
async function handleExport(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let outDir: string | undefined;
  let basePath: string | undefined;
  let cname: string | undefined;
  let deployGithub = false;
  let confirmDeploy = false;
  let includeTranscripts = false;
  try {
    const body = await readBody(req, res);
    if (body) {
      const input = JSON.parse(body) as {
        outDir?: string; basePath?: string; cname?: string; deploy?: string;
        confirmDeploy?: boolean; includeTranscripts?: boolean;
      };
      if (input.outDir && typeof input.outDir === "string") {
        outDir = input.outDir.trim();
      }
      if (input.basePath && typeof input.basePath === "string") {
        basePath = input.basePath.trim();
      }
      if (input.cname && typeof input.cname === "string") {
        cname = input.cname.trim();
      }
      deployGithub = input.deploy === "github";
      confirmDeploy = input.confirmDeploy === true;
      includeTranscripts = input.includeTranscripts === true;
    }
  } catch {
    // Use defaults
  }

  // `--deploy=github` force-pushes to the project's remote. The spawned CLI
  // refuses that in this non-TTY child unless `--yes` is passed, so the viewer
  // gates it behind an explicit confirmation step and sends `confirmDeploy`.
  // Refuse here rather than spawn a command that will only refuse itself —
  // and never turn a plain export request into a silent deploy.
  if (deployGithub && !confirmDeploy) {
    errorResponse(res, 400, "Deploy to GitHub Pages requires confirmDeploy: true (the dashboard's deploy confirmation step sets it).");
    return true;
  }

  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [...prefixArgs, "export"];
  if (outDir) cmdArgs.push(`--out-dir=${outDir}`);
  if (basePath) cmdArgs.push(`--base-path=${basePath}`);
  if (cname) cmdArgs.push(`--cname=${cname}`);
  if (includeTranscripts) cmdArgs.push("--include-transcripts");
  if (deployGithub) {
    cmdArgs.push("--deploy=github");
    // The child has no TTY; --yes carries the confirmation already collected
    // in the browser past the CLI's own non-TTY refusal.
    cmdArgs.push("--yes");
  }
  cmdArgs.push(ctx.projectDir);

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      // Deploy pushes to a remote over the network (git worktree + push),
      // which can run longer than a local-only export.
      timeout: deployGithub ? 180_000 : 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Export failed: ${result.stderr || result.error.message}`);
      return true;
    }

    jsonResponse(res, 200, { ok: true, output: outputTail(result.stdout.trim(), 2000) });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** POST /api/commands/install-sample — ndx install-sample */
async function handleInstallSample(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [...prefixArgs, "install-sample", ctx.projectDir];

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Install failed: ${result.stderr || result.error.message}`);
      return true;
    }

    jsonResponse(res, 200, { ok: true, output: outputTail(result.stdout.trim(), 2000) });
  } catch (err) {
    errorResponse(res, 500, String(err));
  }
  return true;
}

/** POST /api/commands/destroy-sample — ndx destroy-sample */
async function handleDestroySample(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [...prefixArgs, "destroy-sample", ctx.projectDir];

  try {
    const result = await foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    if (result.error && !result.stdout) {
      errorResponse(res, 500, `Destroy failed: ${result.stderr || result.error.message}`);
      return true;
    }

    jsonResponse(res, 200, { ok: true, output: outputTail(result.stdout.trim(), 2000) });
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
  const slot = selfHealSlots.get(ctx);
  const selfHealStatus = slot.status;
  if (selfHealStatus.running) {
    jsonResponse(res, 409, {
      error: "Self-heal is already running",
      startedAt: selfHealStatus.startedAt,
    });
    return true;
  }

  let iterations = 3;
  try {
    const body = await readBody(req, res);
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
  const verboseFlag = serverVerbosityFlag();
  const cmdArgs = [...prefixArgs, "self-heal", String(iterations), ...(verboseFlag ? [verboseFlag] : []), ctx.projectDir];

  // Reset status and start background execution
  selfHealStatus.running = true;
  selfHealStatus.startedAt = new Date().toISOString();
  selfHealStatus.finishedAt = null;
  selfHealStatus.iterations = iterations;
  selfHealStatus.output = "";
  selfHealStatus.error = null;
  selfHealStatus.stopped = false;
  slot.stopRequested = false;

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
  slot.child = child;
  child.done.then((result) => {
    // An operator-requested stop is a normal outcome, not a failure: the
    // kill it triggers must not be reported as an error.
    const wasStopped = slot.stopRequested;
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    // --verbose/--debug output writes to stderr (see llm-client's output.ts
    // contract), so append it whenever this server itself is running in
    // that mode — otherwise it would silently never reach the panel.
    const combinedOutput = verboseFlag && result.stderr
      ? `${result.stdout || ""}\n--- verbose/debug output (stderr) ---\n${result.stderr}`
      : (result.stdout || "");
    selfHealStatus.output = combinedOutput.trim().slice(-5000);
    selfHealStatus.stopped = wasStopped;
    selfHealStatus.error = wasStopped
      ? null
      : managedChildError(result, selfHealTimeout);
    slot.child = null;
    slot.stopRequested = false;

    if (broadcast) {
      broadcast({
        type: "commands:self-heal-finished",
        ok: wasStopped || !selfHealStatus.error,
        stopped: wasStopped,
        timestamp: selfHealStatus.finishedAt,
      });
    }
  }).catch((err: unknown) => {
    const wasStopped = slot.stopRequested;
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.stopped = wasStopped;
    selfHealStatus.error = wasStopped ? null : String(err);
    slot.child = null;
    slot.stopRequested = false;

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
  ctx: ServerContext,
): boolean {
  return stopJob(
    res, selfHealSlots.get(ctx), "Self-heal",
    "Stop requested; the loop will halt after the current step.",
  );
}

/** GET /api/commands/self-heal/status */
function handleSelfHealStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  jsonResponse(res, 200, { ...selfHealSlots.get(ctx).status });
  return true;
}

// ── Init (dashboard setup wizard — bootstraps an uninitialized project) ─

/**
 * POST /api/commands/init — run `ndx init` from the dashboard's setup
 * wizard. Only ever called from the landing page shown pre-init (see
 * `isProjectInitialized` in routes-static.ts), so it never races another
 * command trigger.
 *
 * Spawned with piped stdio (not a TTY), so `ndx init`'s own interactive
 * prompts never fire — vendor and assistant selection must come from flags,
 * which is why this handler requires `provider` explicitly rather than
 * falling back to an interactive default.
 *
 * The same piped stdio is why `git` is part of the body: `ndx init`'s git
 * preflight prompt never fires without a TTY, so a blank folder would stay
 * outside version control no matter what the operator wanted. The wizard asks
 * in the browser instead and the answer travels as `--git` / `--no-git`.
 *
 * Body: { assistants?: ("claude"|"codex")[], provider: "claude"|"codex"|"google"|"local",
 *   googleApiKey?: string, localHost?: string, localPort?: number, git?: boolean }
 */
async function handleInit(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  onProjectInitialized?: () => void,
): Promise<boolean> {
  const initStatus = initStatuses.get(ctx);
  if (initStatus.running) {
    jsonResponse(res, 409, { error: "Init is already running", startedAt: initStatus.startedAt });
    return true;
  }

  let assistants: string[] = ["claude", "codex"];
  let provider = "";
  let googleApiKey = "";
  let localHost = "";
  let localPort: number | undefined;
  let git: boolean | undefined;

  try {
    const body = await readBody(req, res);
    const input = JSON.parse(body) as {
      assistants?: unknown;
      provider?: unknown;
      googleApiKey?: unknown;
      localHost?: unknown;
      localPort?: unknown;
      git?: unknown;
    };

    if (Array.isArray(input.assistants) && input.assistants.length > 0) {
      const filtered = input.assistants.filter(
        (a): a is string => typeof a === "string" && VALID_INIT_ASSISTANTS.has(a),
      );
      if (filtered.length > 0) assistants = filtered;
    }

    if (typeof input.provider !== "string" || !VALID_INIT_PROVIDERS.has(input.provider)) {
      errorResponse(res, 400, `provider must be one of: ${[...VALID_INIT_PROVIDERS].join(", ")}`);
      return true;
    }
    provider = input.provider;

    if (typeof input.git === "boolean") git = input.git;

    if (typeof input.googleApiKey === "string") googleApiKey = input.googleApiKey.trim();
    if (typeof input.localHost === "string") localHost = input.localHost.trim();
    if (typeof input.localPort === "number" && Number.isInteger(input.localPort) && input.localPort > 0 && input.localPort <= 65535) {
      localPort = input.localPort;
    }
  } catch (err) {
    errorResponse(res, 400, err instanceof Error ? err.message : "Invalid request body");
    return true;
  }

  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  const cmdArgs = [
    ...prefixArgs, "init", "--quiet",
    `--provider=${provider}`,
    `--assistants=${assistants.join(",")}`,
    // Omitted when the wizard sent no answer, so `ndx init` keeps its own
    // default rather than this route deciding for it.
    ...(git === undefined ? [] : [git ? "--git" : "--no-git"]),
    ctx.projectDir,
  ];

  initStatus.running = true;
  initStatus.startedAt = new Date().toISOString();
  initStatus.finishedAt = null;
  initStatus.output = "";
  initStatus.error = null;
  initStatus.gitRequested = git === true;
  initStatus.gitInitialized = null;

  // Return 202 immediately, run in background — first-time init runs a
  // sourcevision analyze pass and can take a while on a large repo.
  jsonResponse(res, 202, {
    ok: true,
    startedAt: initStatus.startedAt,
    message: "Initializing. Poll /api/commands/init/status for progress.",
  });

  const initTimeout = 300_000; // 5 minutes — the first sourcevision analyze --fast pass dominates
  const child = spawnManaged(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout: initTimeout,
    stdio: "pipe",
    onStdout: (chunk) => {
      initStatus.output = (initStatus.output + chunk).slice(-5000);
    },
  });

  child.done.then(async (result) => {
    const failure = managedChildError(result, initTimeout);
    if (failure) {
      initStatus.running = false;
      initStatus.finishedAt = new Date().toISOString();
      initStatus.output = outputTail((result.stdout || "").trim(), 5000);
      initStatus.error = failure;
      if (git === true) initStatus.gitInitialized = isInsideGitRepo(ctx.projectDir);
      return;
    }

    // Post-init: persist the vendor details the wizard collected that
    // `ndx init` itself never asks for — it doesn't collect API keys or a
    // local server's host/port (see the Robot Wrangler settings page, which
    // covers these same fields post-init). Set here via the same `ndx
    // config` CLI path that page documents; failures here are non-fatal —
    // init itself already succeeded, and these can be set from Settings.
    if (provider === "google" && googleApiKey) {
      await foundationExec(bin, [...prefixArgs, "config", "llm.google.api_key", googleApiKey, ctx.projectDir], { cwd: ctx.projectDir, timeout: 15_000 }).catch(() => {});
    }
    if (provider === "local") {
      if (localHost) {
        await foundationExec(bin, [...prefixArgs, "config", "llm.local.host", localHost, ctx.projectDir], { cwd: ctx.projectDir, timeout: 15_000 }).catch(() => {});
      }
      if (localPort !== undefined) {
        await foundationExec(bin, [...prefixArgs, "config", "llm.local.port", String(localPort), ctx.projectDir], { cwd: ctx.projectDir, timeout: 15_000 }).catch(() => {});
      }
    }

    initStatus.running = false;
    initStatus.finishedAt = new Date().toISOString();
    initStatus.output = outputTail((result.stdout || "").trim(), 5000);
    initStatus.error = null;
    // `ndx init` reports a failed `git init` as a warning in its recap and
    // still exits 0, so the repository is confirmed on disk rather than
    // inferred from the exit code.
    if (git === true) initStatus.gitInitialized = isInsideGitRepo(ctx.projectDir);

    // The project is now initialized — re-register the file watchers that
    // were skipped at server startup (because .rex/.sourcevision/.hench
    // didn't exist yet) and drop the /api/status cache, so the dashboard
    // the client reloads into has live updates working immediately instead
    // of only after a manual server restart.
    onProjectInitialized?.();
  }).catch((err: unknown) => {
    initStatus.running = false;
    initStatus.finishedAt = new Date().toISOString();
    initStatus.error = String(err);
  });

  return true;
}

/**
 * Walk up from `dir` looking for a `.git` entry. A submodule or linked
 * worktree keeps a `.git` *file* rather than a directory, so both forms count.
 *
 * Mirrors `isInsideGitRepo` in packages/core/git-preflight.js — duplicated
 * rather than imported because core is the orchestration tier and the web
 * server, two tiers below it, must not import from it.
 */
function isInsideGitRepo(dir: string): boolean {
  let cur = resolve(dir);
  for (;;) {
    if (existsSync(join(cur, ".git"))) return true;
    const parent = dirname(cur);
    if (parent === cur) return false;
    cur = parent;
  }
}

/**
 * GET /api/commands/init/preflight — what the setup wizard needs to know
 * about this folder before it offers to initialize it:
 *
 *   isRepo       — already inside a git working tree (the wizard then has no
 *                  git question to ask).
 *   gitAvailable — `git` answers on this machine's PATH. Without it, asking
 *                  for a repository can only produce a warning, so the wizard
 *                  says so up front instead of after a five-minute init.
 *
 * Pre-init only, like the rest of the wizard's surface; safe to call at any
 * time (it reads the filesystem and runs `git --version`).
 */
async function handleInitPreflight(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const isRepo = isInsideGitRepo(ctx.projectDir);
  const version = await foundationExec("git", ["--version"], {
    cwd: ctx.projectDir,
    timeout: 10_000,
  }).catch(() => null);
  jsonResponse(res, 200, {
    isRepo,
    // `launched` is what separates "git is not installed" from "git ran and
    // said no" — an exitCode check alone reports both as unavailable.
    gitAvailable: version !== null && version.launched && version.exitCode === 0,
    projectDir: ctx.projectDir,
  });
  return true;
}

/** GET /api/commands/init/status */
function handleInitStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  jsonResponse(res, 200, { ...initStatuses.get(ctx) });
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
  /** True when the last run ended because an operator pressed Stop. */
  stopped: boolean;
}

// Module-level singleton — one refresh at a time per server process.
const refreshSlots = new WorkspaceScoped<JobSlot<RefreshStatus>>(() => ({
  status: {
    running: false,
    startedAt: null,
    finishedAt: null,
    fast: false,
    phases: [],
    output: "",
    error: null,
    stopped: false,
  },
  child: null,
  stopRequested: false,
}));

/** Extract the `[refresh] …` phase lines from CLI output (ANSI stripped). */
function parseRefreshPhases(stdout: string): string[] {
  // Written as the \x1b ESCAPE SEQUENCE, not a raw ESC byte: the raw byte
  // is invisible in most views, which has already caused this regex to be
  // misread as missing its escape prefix entirely.
  // eslint-disable-next-line no-control-regex
  const plain = stdout.replace(/\x1b\[[0-9;]*m/g, "");
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
  const refreshSlot = refreshSlots.get(ctx);
  const refreshStatus = refreshSlot.status;
  if (refreshStatus.running) {
    jsonResponse(res, 409, {
      error: "A refresh is already running",
      startedAt: refreshStatus.startedAt,
    });
    return true;
  }

  let fast = false;
  try {
    const body = await readBody(req, res);
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
  const verboseFlag = serverVerbosityFlag();
  if (verboseFlag) cmdArgs.push(verboseFlag);
  cmdArgs.push(ctx.projectDir);

  // Refresh runs sourcevision analyze under the hood — same writer lock.
  if (!acquireSvWriteLock(res, ctx, "refresh")) return true;

  refreshStatus.running = true;
  refreshStatus.startedAt = new Date().toISOString();
  refreshStatus.finishedAt = null;
  refreshStatus.fast = fast;
  refreshStatus.phases = [];
  refreshStatus.output = "";
  refreshStatus.error = null;
  refreshStatus.stopped = false;
  refreshSlot.stopRequested = false;

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
  refreshSlot.child = child;
  const settleRefresh = (error: string | null) => {
    const wasStopped = refreshSlot.stopRequested;
    refreshStatus.running = false;
    refreshStatus.finishedAt = new Date().toISOString();
    refreshStatus.stopped = wasStopped;
    refreshStatus.error = wasStopped ? null : error;
    refreshSlot.child = null;
    refreshSlot.stopRequested = false;
    releaseSvWriteLock(ctx);
  };
  child.done.then((result) => {
    // --verbose/--debug output writes to stderr — append it for display
    // whenever this server itself is running in that mode (phase parsing
    // above stays stdout-only; that format is structured and would break if
    // stderr lines were mixed in).
    const combinedOutput = verboseFlag && result.stderr
      ? `${result.stdout || ""}\n--- verbose/debug output (stderr) ---\n${result.stderr}`
      : (result.stdout || "");
    refreshStatus.output = combinedOutput.trim().slice(-5000);
    refreshStatus.phases = parseRefreshPhases(result.stdout || "");
    settleRefresh(managedChildError(result, refreshTimeout));

    if (broadcast) {
      broadcast({
        type: "sv:data-changed",
        source: "refresh",
        ok: !refreshStatus.error,
        timestamp: refreshStatus.finishedAt,
      });
    }
  }).catch((err: unknown) => {
    settleRefresh(String(err));
  });

  return true;
}

/** GET /api/commands/refresh/status */
function handleRefreshStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  jsonResponse(res, 200, { ...refreshSlots.get(ctx).status });
  return true;
}

// ── Async job helper ──────────────────────────────────────────────────

/**
 * Status of a background command that produces a structured report.
 *
 * `ci` and `reshape` both run a long CLI pass and return JSON, so they share
 * one shape rather than each growing its own near-identical singleton.
 */
export interface AsyncJobStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  /** Parsed `--format=json` payload, when the CLI produced one. */
  report: unknown;
  /** Raw output tail — the fallback when stdout was not JSON. */
  output: string;
  error: string | null;
  /** True when the last run ended because an operator pressed Stop. */
  stopped: boolean;
}

/** A background report-producing job, with the handle its Stop needs. */
export type AsyncJob = JobSlot<AsyncJobStatus>;

export function newJobStatus(): AsyncJobStatus {
  return { running: false, startedAt: null, finishedAt: null, report: null, output: "", error: null, stopped: false };
}

export function newAsyncJob(): AsyncJob {
  return { status: newJobStatus(), child: null, stopRequested: false };
}

const ciJobs = new WorkspaceScoped<AsyncJob>(newAsyncJob);
const reshapeJobs = new WorkspaceScoped<AsyncJob>(newAsyncJob);
const recommendJobs = new WorkspaceScoped<AsyncJob>(newAsyncJob);

/**
 * Start a background CLI job that reports through `job.status`, or answer 409
 * when one is already in flight. Returns 202 immediately; the caller polls.
 *
 * Spawned rather than `exec`ed so the job is interruptible: the dashboard's
 * job tray offers Stop on every row, and a buffered `exec` hands back no
 * handle to signal. Streaming `onStdout` is the second reason — `output` is
 * readable while the run is still going, instead of appearing all at once on
 * exit.
 */
export function startAsyncJob(
  res: ServerResponse,
  job: AsyncJob,
  label: string,
  bin: string,
  cmdArgs: string[],
  ctx: ServerContext,
  timeout: number,
  broadcast?: WebSocketBroadcaster,
  broadcastType?: string,
  /** Set when the job writes .sourcevision/ — takes the shared writer lock. */
  svWriteLockLabel?: string,
): boolean {
  const status = job.status;
  if (status.running) {
    jsonResponse(res, 409, { error: `${label} is already running`, startedAt: status.startedAt });
    return true;
  }
  if (svWriteLockLabel && !acquireSvWriteLock(res, ctx, svWriteLockLabel)) {
    return true;
  }

  status.running = true;
  status.startedAt = new Date().toISOString();
  status.finishedAt = null;
  status.report = null;
  status.output = "";
  status.error = null;
  status.stopped = false;
  job.stopRequested = false;

  jsonResponse(res, 202, {
    ok: true,
    startedAt: status.startedAt,
    message: `${label} started. Poll the status endpoint for progress.`,
  });

  // The whole stream is accumulated, not just the displayed tail: `report`
  // is JSON.parse'd from it, and a payload larger than the display slice
  // would otherwise be truncated into a parse failure.
  let streamed = "";
  const child = spawnManaged(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout,
    stdio: "pipe",
    onStdout: (chunk) => {
      streamed = (streamed + chunk).slice(-1_000_000);
      status.output = streamed.trim().slice(-5000);
    },
  });
  job.child = child;

  const settle = (error: string | null) => {
    const wasStopped = job.stopRequested;
    status.running = false;
    status.finishedAt = new Date().toISOString();
    status.stopped = wasStopped;
    status.error = wasStopped ? null : error;
    job.child = null;
    job.stopRequested = false;
    if (svWriteLockLabel) releaseSvWriteLock(ctx);
  };

  child.done.then((result) => {
    status.output = outputTail((result.stdout || "").trim(), 5000);
    try {
      status.report = JSON.parse(result.stdout);
    } catch {
      status.report = null; // not JSON — `output` carries the text
    }
    settle(managedChildError(result, timeout));

    if (broadcast && broadcastType) {
      broadcast({ type: broadcastType, ok: !status.error, timestamp: status.finishedAt });
    }
  }).catch((err: unknown) => {
    settle(String(err));
  });

  return true;
}

/** Interrupt a report-producing job started by {@link startAsyncJob}. */
export function stopAsyncJob(res: ServerResponse, job: AsyncJob, label: string): boolean {
  return stopJob(res, job, label);
}

/** The dashboard-started background jobs the job tray and the Live overview list. */
export type CommandJobKind = "sv-analyze" | "self-heal" | "ci" | "reshape" | "refresh" | "recommend";

/** One job's status, reduced to what every kind shares. */
export interface CommandJobSnapshot {
  kind: CommandJobKind;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  stopped: boolean;
  /** Last output line — for refresh, its latest phase — or null. */
  detail: string | null;
}

function lastOutputLine(text: string | undefined): string | null {
  const lines = (text ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.at(-1) ?? null;
}

/**
 * Every job one workspace has started, by its key (`workspaceKeyOf`). A
 * workspace that never started a job has no slots and lists nothing; reading
 * creates none.
 */
export function commandJobsOf(workspaceKey: string): CommandJobSnapshot[] {
  return [
    snapshotJob("sv-analyze", svAnalyzeSlots.peekByKey(workspaceKey)?.status, (s) => lastOutputLine(s.recentOutput)),
    snapshotJob("self-heal", selfHealSlots.peekByKey(workspaceKey)?.status, (s) => lastOutputLine(s.output)),
    snapshotJob("ci", ciJobs.peekByKey(workspaceKey)?.status, (s) => lastOutputLine(s.output)),
    snapshotJob("reshape", reshapeJobs.peekByKey(workspaceKey)?.status, (s) => lastOutputLine(s.output)),
    snapshotJob("refresh", refreshSlots.peekByKey(workspaceKey)?.status, (s) => s.phases.at(-1) ?? lastOutputLine(s.output)),
    snapshotJob("recommend", recommendJobs.peekByKey(workspaceKey)?.status, (s) => lastOutputLine(s.output)),
  ].filter((job): job is CommandJobSnapshot => job !== null);
}

/** What the Live analysis page reads of the dashboard's own analyze slot. */
export interface SvAnalyzeRunSnapshot {
  running: boolean;
  startedAt: string | null;
  /** When the dashboard's run ended; null while running or never run. */
  finishedAt: string | null;
  /** Tail of the analyzer's stdout (about the last 3000 characters). */
  output: string;
}

/**
 * The dashboard's analyze slot for one workspace, or null when that
 * workspace never started one. Output exists only for runs the dashboard
 * spawned: a terminal run's stdout belongs to its terminal.
 */
export function svAnalyzeRunOf(workspaceKey: string): SvAnalyzeRunSnapshot | null {
  const status = svAnalyzeSlots.peekByKey(workspaceKey)?.status;
  return status ? { running: status.running, startedAt: status.startedAt, finishedAt: status.finishedAt, output: status.recentOutput } : null;
}

type JobStatusBase = Pick<CommandJobSnapshot, "running" | "startedAt" | "finishedAt" | "error" | "stopped">;

function snapshotJob<S extends JobStatusBase>(
  kind: CommandJobKind,
  status: S | undefined,
  detail: (status: S) => string | null,
): CommandJobSnapshot | null {
  if (!status) return null;
  const { running, startedAt, finishedAt, error, stopped } = status;
  return { kind, running, startedAt, finishedAt, error, stopped, detail: detail(status) };
}

/**
 * The job trackers of one workspace, for tests that need to observe or drive
 * them without spawning the real CLIs. Mirrors `resetHenchRouteStateForTests`.
 * @internal
 */
export function getCommandJobStatusesForTests(ctx: ServerContext): {
  ci: AsyncJobStatus;
  reshape: AsyncJobStatus;
  svAnalyze: SvAnalyzeStatus;
  refresh: RefreshStatus;
  selfHeal: SelfHealStatus;
  init: InitStatus;
} {
  return {
    ci: ciJobs.get(ctx).status,
    reshape: reshapeJobs.get(ctx).status,
    svAnalyze: svAnalyzeSlots.get(ctx).status,
    refresh: refreshSlots.get(ctx).status,
    selfHeal: selfHealSlots.get(ctx).status,
    init: initStatuses.get(ctx),
  };
}

/**
 * The report-producing job slots of one workspace, for tests that need to
 * drive `startAsyncJob` against the very object a status route serializes.
 * @internal
 */
export function getCommandJobsForTests(ctx: ServerContext): {
  ci: AsyncJob;
  reshape: AsyncJob;
  recommend: AsyncJob;
} {
  return {
    ci: ciJobs.get(ctx),
    reshape: reshapeJobs.get(ctx),
    recommend: recommendJobs.get(ctx),
  };
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
    const body = await readBody(req, res);
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
      jsonResponse(res, 200, { ok: true, dryRun, output: outputTail(result.stdout.trim(), 2000) });
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
    res, ciJobs.get(ctx), "CI check", bin,
    [...prefixArgs, "ci", "--format=json", ctx.projectDir],
    ctx, 900_000, // 15 minutes — runs the full analysis pipeline
    broadcast, "commands:ci-finished",
    "CI check", // runs the analysis pipeline → writes .sourcevision/
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
    const body = await readBody(req, res);
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
    res, reshapeJobs.get(ctx), "Reshape", bin, cmdArgs, ctx,
    900_000, // 15 minutes — LLM restructuring pass
    broadcast, accept ? "rex:prd-changed" : undefined,
  );
}

// ── Tier 3: credential check and small package triggers ───────────────

interface AuthCheckResult {
  ok: boolean;
  output: string;
  error: string | null;
}

/**
 * Cached `ndx auth` result and the check currently in flight, if any.
 *
 * The check spawns a subprocess with a 60s budget, and the settings page
 * mounts its chip on every navigation — without a cache, each visit costs a
 * spawn and rapid Re-checks stack processes. What the check reports only
 * changes when credentials or LLM config change, so the result is cached for
 * the server's lifetime and invalidated on LLM config saves
 * ({@link invalidateAuthCheckCache}); `?refresh=true` forces a fresh run.
 * Concurrent requests share the in-flight check instead of spawning again.
 */
let authCheckCache: AuthCheckResult | null = null;
let authCheckInFlight: Promise<AuthCheckResult> | null = null;

/** Drop the cached credential-check result (call when LLM config changes). */
export function invalidateAuthCheckCache(): void {
  authCheckCache = null;
}

async function runAuthCheck(ctx: ServerContext): Promise<AuthCheckResult> {
  const { bin, args: prefixArgs } = resolveNdxBin(ctx);
  try {
    const result = await foundationExec(bin, [...prefixArgs, "auth", ctx.projectDir], {
      cwd: ctx.projectDir,
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
    const ok = !result.error;
    return {
      ok,
      output: outputTail(result.stdout.trim(), 2000),
      error: ok ? null : (result.stderr || result.error?.message || "Credential check failed").slice(-1000),
    };
  } catch (err) {
    // Report the failure in the body rather than as a 500: "could not check"
    // is a legitimate chip state, not a broken endpoint.
    return { ok: false, output: "", error: String(err) };
  }
}

/**
 * GET /api/commands/auth — verify LLM provider credentials.
 *
 * Read-only (hence GET): runs `ndx auth`, whose exit code answers "are the
 * configured provider's credentials usable". Surfaced as a chip in LLM
 * settings so a missing key is visible *before* an agent command fails.
 * Served from cache after the first check; `?refresh=true` re-runs it.
 */
async function handleAuth(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const refresh = new URL(req.url || "/", "http://localhost")
    .searchParams.get("refresh") === "true";

  if (!refresh && authCheckCache) {
    jsonResponse(res, 200, { ...authCheckCache, cached: true });
    return true;
  }

  // Whoever asks while a check runs gets that check's answer — a forced
  // refresh included, since the in-flight result is just as fresh.
  if (!authCheckInFlight) {
    authCheckInFlight = runAuthCheck(ctx).then((result) => {
      authCheckCache = result;
      authCheckInFlight = null;
      return result;
    });
  }
  const result = await authCheckInFlight;
  jsonResponse(res, 200, { ...result, cached: false });
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
    jsonResponse(res, 200, { ok: true, output: outputTail(result.stdout.trim(), 4000) });
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
    jsonResponse(res, 200, { ok: true, output: outputTail(result.stdout.trim(), 2000) });
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
   * `self-heal` (destructive; confirmation-gated panel), `plan` (no endpoint
   * runs the full plan pipeline — /api/rex/analyze skips the sourcevision
   * step, so a button labeled with the plan invocation would misrepresent
   * what ran), and terminal-side commands (init, auth, config, start, dev).
   * `rex fix` and `rex reshape` are likewise deliberately not manifest rows:
   * they are confirmation-gated actions owned by the Validation view.
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
      // No `requires`: identifying which CLI is running is most useful when the
      // project is *not* set up, so gating it on init would hide it exactly when
      // it is needed. No trigger either — the answer would describe the server's
      // own install, which the dashboard footer already reports.
      { name: "which", description: "Show which n-dx is running — version, cli path, install kind, and git identity" },
      { name: "auth", description: "Verify LLM provider credentials" },
    ],
  },
  {
    id: "analysis", label: "Analysis", commands: [
      // The analyze trigger posts an empty body — the synchronous quick
      // analysis (200) — so it declares no statusEndpoint; the sv-analyze
      // status endpoint only applies to full runs started from the
      // Overview/SourceVision views.
      { name: "analyze", description: "Run codebase analysis (--deep, --full, --lite; Run performs a quick analysis)", requires: "init", trigger: { endpoint: "/api/commands/sv-analyze", method: "POST" } },
      { name: "recommend", description: "Show or accept sourcevision-based recommendations", requires: "llm", trigger: { endpoint: "/api/commands/recommend", method: "POST" } },
      { name: "refresh", description: "Refresh dashboard data (Run uses --data-only; rebuilding UI artifacts needs a terminal run)", requires: "init", trigger: { endpoint: "/api/commands/refresh", method: "POST", statusEndpoint: "/api/commands/refresh/status" } },
      { name: "ci", description: "Run the analysis pipeline and validate PRD health", requires: "init", trigger: { endpoint: "/api/commands/ci", method: "POST", statusEndpoint: "/api/commands/ci/status" } },
    ],
  },
  {
    id: "planning", label: "Planning", commands: [
      // No trigger: /api/rex/analyze runs only the rex step, and a Run
      // button beside the "plan" invocation would claim the full pipeline.
      { name: "plan", description: "Analyze the codebase and generate PRD proposals (--accept to apply)", requires: "llm" },
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
  const layout = resolveLayout(ctx.projectDir);
  const initialized = [layout.rexDir, layout.sourcevisionDir, layout.henchDir]
    .every((d) => existsSync(d));

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

/** GET /api/commands/sample-status — check if sample app exists */
function handleSampleStatus(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const sampleDir = join(ctx.projectDir, "sample-app");
  const isInstalled = existsSync(sampleDir);

  jsonResponse(res, 200, {
    ok: true,
    isInstalled,
  });
  return true;
}

// ── Dispatcher ────────────────────────────────────────────────────────

/** Handle command trigger API requests. Returns true if the request was handled. */
/** Options threaded into {@link handleCommandsRoute} from start.ts, beyond the plain ctx/broadcast pair. */
export interface CommandsRouteOptions {
  /**
   * Called once, right after `ndx init` (triggered via the dashboard's
   * setup wizard) finishes successfully. Lets start.ts re-register the file
   * watchers it skipped at boot because the project wasn't initialized yet,
   * and drop the /api/status cache — see `handleInit`.
   */
  onProjectInitialized?: () => void;
}

export function handleCommandsRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
  options?: CommandsRouteOptions,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(CMD_PREFIX) && url !== CMD_PREFIX.slice(0, -1)) return false;

  const path = url.slice(CMD_PREFIX.length).split("?")[0];

  if (path === "init" && method === "POST") {
    return handleInit(req, res, ctx, options?.onProjectInitialized);
  }
  if (path === "init/status" && method === "GET") {
    return handleInitStatus(req, res, ctx);
  }
  if (path === "init/preflight" && method === "GET") {
    return handleInitPreflight(req, res, ctx);
  }
  if (path === "sv-analyze" && method === "POST") {
    return handleSvAnalyze(req, res, ctx, broadcast);
  }
  if (path === "sv-analyze/status" && method === "GET") {
    return handleSvAnalyzeStatus(req, res, ctx);
  }
  if (path === "sv-analyze/stop" && method === "POST") {
    return stopJob(res, svAnalyzeSlots.get(ctx), "Analysis");
  }
  if (path === "sync" && method === "POST") {
    return handleSync(req, res, ctx, broadcast);
  }
  if (path === "recommend" && method === "POST") {
    return handleRecommend(req, res, ctx, broadcast);
  }
  if (path === "recommend/status" && method === "GET") {
    jsonResponse(res, 200, { ...recommendJobs.get(ctx).status });
    return true;
  }
  if (path === "recommend/stop" && method === "POST") {
    return stopAsyncJob(res, recommendJobs.get(ctx), "Recommend");
  }
  if (path === "export" && method === "POST") {
    return handleExport(req, res, ctx);
  }
  if (path === "install-sample" && method === "POST") {
    return handleInstallSample(req, res, ctx);
  }
  if (path === "destroy-sample" && method === "POST") {
    return handleDestroySample(req, res, ctx);
  }
  if (path === "sample-status" && method === "GET") {
    return handleSampleStatus(req, res, ctx);
  }
  if (path === "self-heal" && method === "POST") {
    return handleSelfHeal(req, res, ctx, broadcast);
  }
  if (path === "self-heal/status" && method === "GET") {
    return handleSelfHealStatus(req, res, ctx);
  }
  if (path === "self-heal/stop" && method === "POST") {
    return handleSelfHealStop(req, res, ctx);
  }
  if (path === "refresh" && method === "POST") {
    return handleRefresh(req, res, ctx, broadcast);
  }
  if (path === "refresh/status" && method === "GET") {
    return handleRefreshStatus(req, res, ctx);
  }
  if (path === "refresh/stop" && method === "POST") {
    return stopJob(res, refreshSlots.get(ctx), "Refresh");
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
    jsonResponse(res, 200, { ...ciJobs.get(ctx).status });
    return true;
  }
  if (path === "ci/stop" && method === "POST") {
    return stopAsyncJob(res, ciJobs.get(ctx), "CI check");
  }
  if (path === "reshape" && method === "POST") {
    return handleReshape(req, res, ctx, broadcast);
  }
  if (path === "reshape/status" && method === "GET") {
    jsonResponse(res, 200, { ...reshapeJobs.get(ctx).status });
    return true;
  }
  if (path === "reshape/stop" && method === "POST") {
    return stopAsyncJob(res, reshapeJobs.get(ctx), "Reshape");
  }

  return false;
}
