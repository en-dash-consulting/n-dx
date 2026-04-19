/**
 * Command trigger API routes — invoke CLI operations from the dashboard.
 *
 * All endpoints are under /api/commands/.
 *
 * POST /api/commands/sv-analyze      — re-run sourcevision analyze
 * POST /api/commands/sync            — rex sync (body: { direction: "push"|"pull"|"sync" })
 * POST /api/commands/recommend       — rex recommend (refresh sourcevision-based recommendations)
 * POST /api/commands/export          — ndx export static dashboard
 * POST /api/commands/self-heal       — ndx self-heal iterative loop (body: { iterations?: number })
 * GET  /api/commands/self-heal/status — check running self-heal status
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { exec as foundationExec } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
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
}

// Module-level singleton — one self-heal at a time per server process.
const selfHealStatus: SelfHealStatus = {
  running: false,
  startedAt: null,
  finishedAt: null,
  iterations: 0,
  output: "",
  error: null,
};

// ── Binary resolution helpers ─────────────────────────────────────────

function resolveSvBin(ctx: ServerContext): { bin: string; args: string[] } {
  const bin = join(ctx.projectDir, "node_modules", ".bin", "sourcevision");
  if (existsSync(bin)) return { bin, args: [] };
  const fallback = join(ctx.projectDir, "packages", "sourcevision", "dist", "cli", "index.js");
  return { bin: "node", args: [fallback] };
}

function resolveRexBin(ctx: ServerContext): { bin: string; args: string[] } {
  const bin = join(ctx.projectDir, "node_modules", ".bin", "rex");
  if (existsSync(bin)) return { bin, args: [] };
  const fallback = join(ctx.projectDir, "packages", "rex", "dist", "cli", "index.js");
  return { bin: "node", args: [fallback] };
}

function resolveNdxBin(ctx: ServerContext): { bin: string; args: string[] } {
  const bin = join(ctx.projectDir, "node_modules", ".bin", "ndx");
  if (existsSync(bin)) return { bin, args: [] };
  const fallback = join(ctx.projectDir, "packages", "core", "cli.js");
  return { bin: "node", args: [fallback] };
}

// ── Handlers ──────────────────────────────────────────────────────────

/** POST /api/commands/sv-analyze — re-run sourcevision analyze */
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
  }).then((result) => {
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.output = (result.stdout || "").trim().slice(-5000);
    selfHealStatus.error = result.error ? (result.stderr || result.error.message).slice(-1000) : null;

    if (broadcast) {
      broadcast({
        type: "commands:self-heal-finished",
        ok: !result.error,
        timestamp: selfHealStatus.finishedAt,
      });
    }
  }).catch((err: unknown) => {
    selfHealStatus.running = false;
    selfHealStatus.finishedAt = new Date().toISOString();
    selfHealStatus.error = String(err);

    if (broadcast) {
      broadcast({
        type: "commands:self-heal-finished",
        ok: false,
        timestamp: selfHealStatus.finishedAt,
      });
    }
  });

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

  return false;
}
