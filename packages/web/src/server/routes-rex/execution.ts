/**
 * Execution routes: epic-by-epic orchestration, status, pause, resume.
 *
 * Manages the in-memory execution state machine that runs hench
 * sequentially across epics, with pause/resume support.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnManaged, killWithFallback, type ManagedChild } from "@n-dx/llm-client";
import type { ServerContext } from "../types.js";
import { jsonResponse, errorResponse, readBody } from "../response-utils.js";
import type { WebSocketBroadcaster } from "../websocket.js";
import { findItemById, loadPRD, appendLog } from "./rex-route-helpers.js";

import {
  computeStats,
  isRootLevel,
  type PRDItem,
} from "../rex-gateway.js";

// ---------------------------------------------------------------------------
// Execution types
// ---------------------------------------------------------------------------

/** Per-epic progress tracked during execution. */
interface EpicExecutionProgress {
  id: string;
  title: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  tasksTotal: number;
  tasksCompleted: number;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

/** Global execution state (one execution at a time). */
interface ExecutionState {
  status: "idle" | "running" | "paused" | "completed" | "failed";
  startedAt?: string;
  finishedAt?: string;
  currentEpicId?: string;
  currentEpicIndex: number;
  epics: EpicExecutionProgress[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

/** Singleton execution state. Reset on server restart. */
let executionState: ExecutionState = {
  status: "idle",
  currentEpicIndex: -1,
  epics: [],
};

/** Reference to the current hench child process (if any). */
let henchProcess: ManagedChild | null = null;

/** Context and broadcast saved during execution for resume. */
let savedCtx: ServerContext | null = null;
let savedBroadcast: WebSocketBroadcaster | undefined;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Broadcast the current execution state over WebSocket. */
function broadcastExecutionState(broadcast?: WebSocketBroadcaster): void {
  if (!broadcast) return;
  broadcast({
    type: "rex:execution-progress",
    state: getExecutionStatusPayload(),
    timestamp: new Date().toISOString(),
  });
}

/** Build the status payload returned by the status endpoint and broadcasts. */
function getExecutionStatusPayload() {
  const { status, startedAt, finishedAt, currentEpicId, currentEpicIndex, epics, error } = executionState;
  const totalEpics = epics.length;
  const completedEpics = epics.filter((e) => e.status === "completed").length;
  const totalTasks = epics.reduce((s, e) => s + e.tasksTotal, 0);
  const completedTasks = epics.reduce((s, e) => s + e.tasksCompleted, 0);
  return {
    status,
    startedAt,
    finishedAt,
    currentEpicId,
    currentEpicIndex,
    totalEpics,
    completedEpics,
    totalTasks,
    completedTasks,
    percentComplete: totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0,
    epics: epics.map((e) => ({ ...e })),
    error,
  };
}

/** Refresh epic task counts from the PRD on disk. */
function refreshEpicProgress(ctx: ServerContext): void {
  const doc = loadPRD(ctx);
  if (!doc) return;
  for (const ep of executionState.epics) {
    const epicItem = findItemById(doc.items, ep.id);
    if (!epicItem) continue;
    const stats = computeStats(epicItem.children ?? []);
    ep.tasksTotal = stats.total;
    ep.tasksCompleted = stats.completed;
  }
}

/**
 * Run the hench CLI for one epic.
 * Returns a promise that resolves when hench exits.
 */
async function runHenchForEpic(ctx: ServerContext, epicId: string): Promise<{ code: number | null; signal: string | null }> {
  const henchBin = join(ctx.projectDir, "node_modules", ".bin", "hench");
  const henchFallback = join(ctx.projectDir, "packages", "hench", "dist", "cli", "index.js");
  const args = ["run", "--epic=" + epicId, "--loop", "--auto", ctx.projectDir];

  const binPath = existsSync(henchBin) ? henchBin : "node";
  const binArgs = existsSync(henchBin) ? args : [henchFallback, ...args];

  const handle = spawnManaged(binPath, binArgs, {
    cwd: ctx.projectDir,
    stdio: "inherit",
    env: { ...process.env },
  });

  henchProcess = handle;

  const result = await handle.done;
  if (henchProcess === handle) henchProcess = null;
  return { code: result.exitCode, signal: null };
}

/**
 * Execute epics sequentially, starting from the current index.
 * Respects pause state and broadcasts progress.
 */
async function executeEpicSequence(ctx: ServerContext, broadcast?: WebSocketBroadcaster): Promise<void> {
  while (executionState.currentEpicIndex < executionState.epics.length) {
    // Check for pause
    if (executionState.status === "paused") return;
    if (executionState.status !== "running") return;

    const epicIdx = executionState.currentEpicIndex;
    const epic = executionState.epics[epicIdx];

    // Refresh task counts before starting
    refreshEpicProgress(ctx);
    broadcastExecutionState(broadcast);

    // Skip epics with no actionable tasks
    if (epic.tasksTotal === 0 || epic.tasksCompleted >= epic.tasksTotal) {
      epic.status = epic.tasksTotal === 0 ? "skipped" : "completed";
      epic.finishedAt = new Date().toISOString();
      executionState.currentEpicIndex++;
      broadcastExecutionState(broadcast);
      continue;
    }

    // Start this epic
    epic.status = "running";
    epic.startedAt = new Date().toISOString();
    executionState.currentEpicId = epic.id;
    broadcastExecutionState(broadcast);

    // Run hench for this epic
    const result = await runHenchForEpic(ctx, epic.id);

    // Refresh task counts after hench finishes
    refreshEpicProgress(ctx);

    // Check if we were paused/stopped while hench was running
    // (status can change via pause endpoint during the await above)
    const currentStatus = executionState.status as ExecutionState["status"];
    if (currentStatus === "paused") {
      epic.status = "pending"; // Revert to pending — will resume later
      epic.startedAt = undefined;
      broadcastExecutionState(broadcast);
      return;
    }

    if (currentStatus !== "running") return;

    // Mark epic as completed or failed
    if (result.code === 0 || epic.tasksCompleted >= epic.tasksTotal) {
      epic.status = "completed";
    } else {
      // Non-zero exit but some tasks may have completed
      // Mark completed if all tasks done, otherwise move on
      epic.status = epic.tasksCompleted >= epic.tasksTotal ? "completed" : "completed";
    }
    epic.finishedAt = new Date().toISOString();

    executionState.currentEpicIndex++;
    broadcastExecutionState(broadcast);
  }

  // All epics processed
  if (executionState.status === "running") {
    executionState.status = "completed";
    executionState.finishedAt = new Date().toISOString();
    executionState.currentEpicId = undefined;

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "epic_by_epic_completed",
      detail: `Epic-by-epic execution completed. ${executionState.epics.filter((e) => e.status === "completed").length}/${executionState.epics.length} epics processed.`,
    });

    broadcastExecutionState(broadcast);
  }
}

// ---------------------------------------------------------------------------
// Route dispatcher
// ---------------------------------------------------------------------------

/** Execution routes: epic-by-epic, status, pause, resume. */
export function routeExecution(
  path: string, method: string,
  req: IncomingMessage, res: ServerResponse, ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean | Promise<boolean> {
  // POST /api/rex/execute/epic-by-epic — start epic-by-epic execution
  if (path === "execute/epic-by-epic" && method === "POST") {
    return handleStartEpicByEpic(req, res, ctx, broadcast);
  }

  // GET /api/rex/execute/status — current execution state
  if (path === "execute/status" && method === "GET") {
    return handleExecutionStatus(res);
  }

  // POST /api/rex/execute/pause — pause execution
  if (path === "execute/pause" && method === "POST") {
    return handleExecutionPause(res, broadcast);
  }

  // POST /api/rex/execute/resume — resume execution
  if (path === "execute/resume" && method === "POST") {
    return handleExecutionResume(res, ctx, broadcast);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

/** Handle POST /api/rex/execute/epic-by-epic — start sequential epic execution. */
async function handleStartEpicByEpic(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  // Don't allow starting if already running
  if (executionState.status === "running" || executionState.status === "paused") {
    errorResponse(res, 409, `Execution already ${executionState.status}. Use pause/resume or wait for completion.`);
    return true;
  }

  const doc = loadPRD(ctx);
  if (!doc) {
    errorResponse(res, 404, "No PRD data found");
    return true;
  }

  try {
    const body = await readBody(req);
    const input = JSON.parse(body) as {
      /** Optional list of epic IDs to execute (in order). If omitted, all non-completed epics. */
      epicIds?: string[];
    };

    // Build the list of epics to execute
    const allEpics = doc.items.filter((item) => isRootLevel(item.level));

    let epicsToRun: PRDItem[];
    if (input.epicIds && input.epicIds.length > 0) {
      epicsToRun = input.epicIds
        .map((id) => allEpics.find((e) => e.id === id))
        .filter((e): e is PRDItem => e != null);
    } else {
      // All epics that aren't fully completed
      epicsToRun = allEpics.filter((epic) => {
        const stats = computeStats(epic.children ?? []);
        return stats.total === 0 || stats.completed < stats.total;
      });
    }

    if (epicsToRun.length === 0) {
      jsonResponse(res, 200, { ok: true, message: "No actionable epics to execute" });
      return true;
    }

    // Initialize execution state
    executionState = {
      status: "running",
      startedAt: new Date().toISOString(),
      currentEpicIndex: 0,
      epics: epicsToRun.map((epic) => {
        const stats = computeStats(epic.children ?? []);
        return {
          id: epic.id,
          title: epic.title,
          status: "pending" as const,
          tasksTotal: stats.total,
          tasksCompleted: stats.completed,
        };
      }),
    };

    savedCtx = ctx;
    savedBroadcast = broadcast;

    appendLog(ctx, {
      timestamp: new Date().toISOString(),
      event: "epic_by_epic_started",
      detail: `Started epic-by-epic execution with ${epicsToRun.length} epics: ${epicsToRun.map((e) => e.title).join(", ")}`,
    });

    broadcastExecutionState(broadcast);

    // Respond immediately — execution runs in the background
    jsonResponse(res, 200, {
      ok: true,
      epicCount: epicsToRun.length,
      epics: executionState.epics.map((e) => ({ id: e.id, title: e.title })),
    });

    // Start execution asynchronously (don't await)
    executeEpicSequence(ctx, broadcast).catch((err) => {
      executionState.status = "failed";
      executionState.error = String(err);
      executionState.finishedAt = new Date().toISOString();
      broadcastExecutionState(broadcast);
    });
  } catch (err) {
    errorResponse(res, 400, String(err));
  }
  return true;
}

/** Handle GET /api/rex/execute/status — return current execution state. */
function handleExecutionStatus(res: ServerResponse): boolean {
  // Refresh epic progress if running
  if (savedCtx && (executionState.status === "running" || executionState.status === "paused")) {
    refreshEpicProgress(savedCtx);
  }
  jsonResponse(res, 200, getExecutionStatusPayload());
  return true;
}

/** Handle POST /api/rex/execute/pause — pause the current execution. */
function handleExecutionPause(
  res: ServerResponse,
  broadcast?: WebSocketBroadcaster,
): boolean {
  if (executionState.status !== "running") {
    errorResponse(res, 409, `Cannot pause: execution is ${executionState.status}`);
    return true;
  }

  executionState.status = "paused";

  // Kill the current hench process if running
  if (henchProcess) {
    henchProcess.kill("SIGINT");
    henchProcess = null;
  }

  broadcastExecutionState(broadcast);
  jsonResponse(res, 200, { ok: true, status: "paused" });
  return true;
}

/** Handle POST /api/rex/execute/resume — resume a paused execution. */
function handleExecutionResume(
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): boolean {
  if (executionState.status !== "paused") {
    errorResponse(res, 409, `Cannot resume: execution is ${executionState.status}`);
    return true;
  }

  executionState.status = "running";
  savedCtx = ctx;
  savedBroadcast = broadcast;

  broadcastExecutionState(broadcast);
  jsonResponse(res, 200, { ok: true, status: "running" });

  // Continue execution asynchronously
  executeEpicSequence(ctx, broadcast).catch((err) => {
    executionState.status = "failed";
    executionState.error = String(err);
    executionState.finishedAt = new Date().toISOString();
    broadcastExecutionState(broadcast);
  });

  return true;
}

// ---------------------------------------------------------------------------
// Shutdown
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link shutdownRexExecution}.
 *
 * Callers (e.g. `gracefulShutdown` in start.ts) use this to build a final
 * verification summary for the rex epic-by-epic execution component.
 */
export interface ShutdownRexResult {
  /** Whether a rex epic-by-epic hench process was running at shutdown time. */
  hadActiveProcess: boolean;
  /** Whether the process was successfully terminated (false if it errored or was not present). */
  terminated: boolean;
}

/**
 * Terminate any active rex epic-by-epic hench process.
 *
 * Called during server graceful shutdown to ensure the hench child spawned
 * by the rex execution engine is cleaned up alongside the hench-route
 * executions. Mirrors the pattern used by `shutdownActiveExecutions` in
 * routes-hench.ts.
 *
 * @param gracePeriodMs  How long to wait for graceful SIGTERM before
 *                       sending SIGKILL (default: HENCH_SHUTDOWN_TIMEOUT_MS
 *                       env var, or 5 000 ms).
 * @returns Result indicating whether the process was present and terminated.
 */
export async function shutdownRexExecution(
  gracePeriodMs: number = Number(process.env["HENCH_SHUTDOWN_TIMEOUT_MS"] ?? 5_000),
): Promise<ShutdownRexResult> {
  if (!henchProcess) return { hadActiveProcess: false, terminated: false };

  const handle = henchProcess;
  const pid = handle.pid;
  const pidInfo = pid != null ? ` (pid ${pid})` : "";
  henchProcess = null;

  console.log(`[shutdown] terminating rex epic-by-epic execution${pidInfo}`);

  let terminated = false;
  try {
    await killWithFallback(handle, gracePeriodMs);
    console.log(`[shutdown] rex epic-by-epic execution${pidInfo} terminated`);
    terminated = true;
  } catch (err) {
    const error = err as Error;
    console.error(`[shutdown] rex epic-by-epic execution${pidInfo} failed to terminate: ${error.message}`);
  }

  // Mark execution as failed so callers (status endpoint, WebSocket) see a
  // clean terminal state rather than a stale "running" after restart.
  if (executionState.status === "running" || executionState.status === "paused") {
    executionState.status = "failed";
    executionState.error = "Server shutting down";
    executionState.finishedAt = new Date().toISOString();
  }

  return { hadActiveProcess: true, terminated };
}
