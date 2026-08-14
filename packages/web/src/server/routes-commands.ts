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
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { exec as foundationExec } from "@n-dx/llm-client";
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
 * Abort handle for the in-flight self-heal loop.
 *
 * Kept outside the wire status (an AbortController is not serialisable) so the
 * stop endpoint can cancel the child process without holding a ChildProcess.
 */
let selfHealAbort: AbortController | null = null;

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
 * which unlock the Architecture/Problems/Suggestions tabs) can take many
 * minutes of LLM work, so they run as an async singleton: 202 immediately,
 * progress via GET /api/commands/sv-analyze/status. Either way the viewer's
 * data polling repopulates the tabs when the new files land.
 */
async function handleSvAnalyze(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let lite = false;
  let full = false;
  try {
    const body = await readBody(req);
    if (body) {
      const input = JSON.parse(body) as { lite?: boolean; full?: boolean };
      lite = !!input.lite;
      full = !!input.full;
    }
  } catch {
    // Use defaults
  }

  const { bin, args: prefixArgs } = resolveSvBin(ctx);
  const cmdArgs = [...prefixArgs, "analyze"];
  if (lite) cmdArgs.push("--lite");
  if (full) cmdArgs.push("--full");
  cmdArgs.push(ctx.projectDir);

  if (full) {
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
      message: "Full analysis started. Poll /api/commands/sv-analyze/status for progress.",
    });

    foundationExec(bin, cmdArgs, {
      cwd: ctx.projectDir,
      timeout: 1_800_000, // 30 minutes — four LLM enrichment passes
      maxBuffer: 20 * 1024 * 1024,
    }).then((result) => {
      svAnalyzeStatus.running = false;
      svAnalyzeStatus.finishedAt = new Date().toISOString();
      svAnalyzeStatus.recentOutput = (result.stdout || "").trim().slice(-3000);
      svAnalyzeStatus.error = result.error
        ? (result.stderr || result.error.message).slice(-1000)
        : null;

      if (broadcast) {
        broadcast({
          type: "sv:data-changed",
          source: "sv-analyze-full",
          ok: !result.error,
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
  selfHealAbort = new AbortController();

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

  // Run in background (fire-and-forget from response perspective)
  foundationExec(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout: 600_000, // 10 minutes
    maxBuffer: 20 * 1024 * 1024,
    signal: selfHealAbort.signal,
  }).then((result) => {
    // An operator-requested stop is a normal outcome, not a failure: the
    // AbortError it produces must not be reported as an error.
    const wasStopped = selfHealAbort?.signal.aborted === true;
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.output = (result.stdout || "").trim().slice(-5000);
    selfHealStatus.stopped = wasStopped;
    selfHealStatus.error = !wasStopped && result.error
      ? (result.stderr || result.error.message).slice(-1000)
      : null;
    selfHealAbort = null;

    if (broadcast) {
      broadcast({
        type: "commands:self-heal-finished",
        ok: wasStopped || !result.error,
        stopped: wasStopped,
        timestamp: selfHealStatus.finishedAt,
      });
    }
  }).catch((err: unknown) => {
    const wasStopped = selfHealAbort?.signal.aborted === true;
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.stopped = wasStopped;
    selfHealStatus.error = wasStopped ? null : String(err);
    selfHealAbort = null;

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
 * to interrupt it. Aborting kills the child; the run then reports
 * `stopped: true` with no error.
 */
function handleSelfHealStop(
  _req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!selfHealStatus.running || !selfHealAbort) {
    jsonResponse(res, 409, { error: "Self-heal is not running" });
    return true;
  }
  selfHealAbort.abort();
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

  foundationExec(bin, cmdArgs, {
    cwd: ctx.projectDir,
    timeout: 300_000, // 5 minutes — data analysis, no UI build
    maxBuffer: 20 * 1024 * 1024,
  }).then((result) => {
    refreshStatus.running = false;
    refreshStatus.finishedAt = new Date().toISOString();
    refreshStatus.output = (result.stdout || "").trim().slice(-5000);
    refreshStatus.phases = parseRefreshPhases(result.stdout || "");
    refreshStatus.error = result.error ? (result.stderr || result.error.message).slice(-1000) : null;

    if (broadcast) {
      broadcast({
        type: "sv:data-changed",
        source: "refresh",
        ok: !result.error,
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
 * `requires: "llm"` — additionally needs a configured LLM vendor.
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

/** Check whether the project has an LLM vendor configured. */
function hasLlmVendor(projectDir: string): boolean {
  try {
    const raw = readFileSync(join(projectDir, ".n-dx.json"), "utf-8");
    const config = JSON.parse(raw) as { llm?: { vendor?: unknown } };
    return typeof config.llm?.vendor === "string" && config.llm.vendor.length > 0;
  } catch {
    return false;
  }
}

/** GET /api/commands/manifest — grouped command reference with availability. */
function handleManifest(
  _req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const cliName = readCliName(ctx.projectDir);
  const initialized = [".rex", ".sourcevision", ".hench"]
    .every((d) => existsSync(join(ctx.projectDir, d)));
  const llmConfigured = hasLlmVendor(ctx.projectDir);

  const statusFor = (cmd: ManifestCommand): CommandStatus => {
    if (cmd.requires === "llm") {
      if (!initialized) return "needs-init";
      return llmConfigured ? "available" : "needs-llm";
    }
    if (cmd.requires === "init") {
      return initialized ? "available" : "needs-init";
    }
    return "available";
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

  return false;
}
