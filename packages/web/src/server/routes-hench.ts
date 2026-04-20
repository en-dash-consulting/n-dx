/**
 * Hench API routes — agent run history, workflow configuration, and templates.
 *
 * All endpoints are under /api/hench/.
 *
 * GET    /api/hench/runs                  — list runs with summary (newest first, ?limit=N)
 * GET    /api/hench/runs/:id              — full run detail with transcript
 * GET    /api/hench/runs/health           — staleness health check for running runs
 * POST   /api/hench/runs/:id/mark-stuck   — mark a stuck run as failed
 * GET    /api/hench/task-usage            — incremental per-task token usage aggregation
 * GET    /api/hench/audit                 — audit info for active tasks (PIDs, resource usage)
 * GET    /api/hench/metrics              — concurrent execution metrics and resource utilization
 * GET    /api/hench/metrics/snapshots    — time-series execution metrics snapshots
 * GET    /api/hench/memory               — system memory, per-process memory, and resource health
 * GET    /api/hench/memory/history        — per-process memory history (all tracked processes)
 * GET    /api/hench/memory/history/:taskId — memory history for a specific task
 * GET    /api/hench/memory/leaks          — leak detection summary for all active processes
 * GET    /api/hench/concurrency           — concurrent execution count, limits, and queue status
 * POST   /api/hench/execute/:taskId/terminate — terminate a running task
 * GET    /api/hench/config                — current workflow configuration with field metadata
 * PUT    /api/hench/config                — update workflow configuration (partial or full)
 * GET    /api/hench/templates             — list all workflow templates (built-in + user)
 * GET    /api/hench/templates/:id         — get template details
 * POST   /api/hench/templates             — create/update a user-defined template
 * POST   /api/hench/templates/:id/apply   — apply a template to current config
 * DELETE /api/hench/templates/:id         — delete a user-defined template
 * POST   /api/hench/execute               — trigger Hench run for a specific task
 * GET    /api/hench/execute/status         — get all active execution statuses
 * GET    /api/hench/execute/status/:taskId — get specific task execution status
 * GET    /api/hench/throttle              — current throttle state (paused, concurrency override, etc.)
 * PUT    /api/hench/throttle              — adjust concurrency limit override
 * POST   /api/hench/throttle/pause        — pause new task executions
 * POST   /api/hench/throttle/resume       — resume new task executions
 * POST   /api/hench/throttle/emergency-stop — terminate all running executions immediately
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { totalmem, freemem, loadavg, cpus } from "node:os";
import type { IncomingMessage, ServerResponse } from "node:http";
import { spawnManaged, killWithFallback, type ManagedChild } from "@n-dx/llm-client";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";
import type { WebSocketBroadcaster } from "./websocket.js";
import { IncrementalTaskUsageAggregator } from "./task-usage.js";
import { collectAllIds } from "./rex-gateway.js";
import type { PRDDocument } from "./rex-gateway.js";
import { loadPRDSync } from "./prd-io.js";
import { ProcessMemoryTracker } from "./process-memory-tracker.js";
import { ConcurrentExecutionMetrics } from "./concurrent-execution-metrics.js";

const HENCH_PREFIX = "/api/hench/";

/**
 * Per-project aggregator singletons. Keyed by runsDir so each project
 * gets its own incremental cache that persists across requests.
 */
const aggregatorCache = new Map<string, IncrementalTaskUsageAggregator>();

export function getAggregator(runsDir: string): IncrementalTaskUsageAggregator {
  let aggregator = aggregatorCache.get(runsDir);
  if (!aggregator) {
    aggregator = new IncrementalTaskUsageAggregator(runsDir);
    aggregatorCache.set(runsDir, aggregator);
  }
  return aggregator;
}

/**
 * Module-level process memory tracker singleton.
 *
 * Records per-process RSS samples during each memory broadcast cycle
 * and provides historical data + leak detection via the API.
 */
const processMemoryTracker = new ProcessMemoryTracker();

/**
 * Module-level concurrent execution metrics singleton.
 *
 * Records time-series snapshots of concurrent process counts, total memory
 * utilization, and per-task resource metrics during each monitoring cycle.
 * Provides aggregate patterns (peak, average) for dashboard consumption.
 */
const executionMetrics = new ConcurrentExecutionMetrics();

/** Minimal run shape for listing (avoids loading full toolCalls/transcript). */
interface RunSummary {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
  lastActivityAt?: string;
  status: string;
  turns: number;
  summary?: string;
  error?: string;
  model: string;
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  structuredSummary?: {
    counts?: {
      filesRead: number;
      filesChanged: number;
      commandsExecuted: number;
      testsRun: number;
      toolCallsTotal: number;
    };
  };
  /** Vendor active for this run (e.g. "claude", "codex"). */
  vendor?: string;
  /** Token diagnostic status: complete, partial, or unavailable. */
  tokenDiagnosticStatus?: "complete" | "partial" | "unavailable";
  /** Invocation context: "cli" for CLI, "api" for HTTP/MCP. */
  invocationContext?: "cli" | "api";
}

/** Config field metadata for the UI. */
interface ConfigFieldInfo {
  path: string;
  label: string;
  description: string;
  type: "string" | "number" | "boolean" | "enum" | "array";
  enumValues?: string[];
  category: string;
}

/** Known config field metadata — mirrors the CLI config module. */
const CONFIG_FIELD_META: ConfigFieldInfo[] = [
  { path: "provider", label: "Provider", description: "Claude provider: 'cli' (Claude Code) or 'api' (direct API)", type: "enum", enumValues: ["cli", "api"], category: "execution" },
  { path: "model", label: "Model", description: "Claude model to use (e.g. sonnet, opus, haiku)", type: "string", category: "execution" },
  { path: "maxTurns", label: "Max Turns", description: "Maximum conversation turns per run", type: "number", category: "execution" },
  { path: "maxTokens", label: "Max Tokens per Request", description: "Maximum tokens per API request", type: "number", category: "execution" },
  { path: "tokenBudget", label: "Token Budget", description: "Total token budget per run (input+output). 0 = unlimited", type: "number", category: "execution" },
  { path: "loopPauseMs", label: "Loop Pause (ms)", description: "Pause between loop/iteration runs in milliseconds", type: "number", category: "execution" },
  { path: "maxFailedAttempts", label: "Max Failed Attempts", description: "Consecutive failures before a task is considered stuck", type: "number", category: "task-selection" },
  { path: "rexDir", label: "Rex Directory", description: "Path to the .rex directory for task data", type: "string", category: "task-selection" },
  { path: "retry.maxRetries", label: "Max Retries", description: "Number of retry attempts for transient API errors", type: "number", category: "retry" },
  { path: "retry.baseDelayMs", label: "Base Retry Delay (ms)", description: "Initial delay before first retry (doubles each attempt)", type: "number", category: "retry" },
  { path: "retry.maxDelayMs", label: "Max Retry Delay (ms)", description: "Maximum delay between retries (caps exponential backoff)", type: "number", category: "retry" },
  { path: "guard.blockedPaths", label: "Blocked Paths", description: "Glob patterns for paths the agent cannot modify", type: "array", category: "guard" },
  { path: "guard.allowedCommands", label: "Allowed Commands", description: "Shell commands the agent is permitted to execute", type: "array", category: "guard" },
  { path: "guard.commandTimeout", label: "Command Timeout (ms)", description: "Maximum time for a single command execution", type: "number", category: "guard" },
  { path: "guard.maxFileSize", label: "Max File Size (bytes)", description: "Maximum file size the agent can write", type: "number", category: "guard" },
  { path: "apiKeyEnv", label: "API Key Env Var", description: "Environment variable name for Anthropic API key", type: "string", category: "general" },
];

/** Default config values for detecting non-default settings. */
const DEFAULT_CONFIG: Record<string, unknown> = {
  provider: "cli",
  model: "sonnet",
  maxTurns: 50,
  maxTokens: 8192,
  tokenBudget: 0,
  loopPauseMs: 2000,
  maxFailedAttempts: 3,
  rexDir: ".rex",
  "retry.maxRetries": 3,
  "retry.baseDelayMs": 2000,
  "retry.maxDelayMs": 30000,
  "guard.commandTimeout": 30000,
  "guard.maxFileSize": 1048576,
  apiKeyEnv: "ANTHROPIC_API_KEY",
};

/** Impact descriptions keyed by field path. */
function getImpact(path: string, value: unknown): string {
  switch (path) {
    case "provider":
      return value === "cli"
        ? "Agent will use Claude Code CLI (tool-use mode, filesystem access)"
        : "Agent will call Anthropic API directly (requires API key)";
    case "model":
      return `Agent will use model "${value}" for task execution`;
    case "maxTurns": {
      const n = Number(value);
      return `Agent will stop after ${n} turns (${n <= 10 ? "short" : n <= 30 ? "medium" : "long"} runs)`;
    }
    case "maxTokens":
      return `Each API response limited to ${Number(value).toLocaleString()} tokens`;
    case "tokenBudget":
      return Number(value) === 0
        ? "No token limit per run (unlimited)"
        : `Run will stop after ${Number(value).toLocaleString()} total tokens`;
    case "loopPauseMs":
      return `${Number(value) / 1000}s pause between consecutive task runs`;
    case "maxFailedAttempts":
      return `Tasks will be skipped as stuck after ${value} consecutive failures`;
    case "retry.maxRetries":
      return `Transient errors will be retried up to ${value} times`;
    case "retry.baseDelayMs":
      return `First retry after ${Number(value) / 1000}s, then exponential backoff`;
    case "retry.maxDelayMs":
      return `Retry delay capped at ${Number(value) / 1000}s`;
    case "guard.commandTimeout":
      return `Commands will be killed after ${Number(value) / 1000}s`;
    case "guard.maxFileSize":
      return `Agent limited to writing files under ${(Number(value) / 1024 / 1024).toFixed(1)}MB`;
    case "guard.blockedPaths":
      return `Agent blocked from ${(value as string[]).length} path patterns`;
    case "guard.allowedCommands":
      return `Agent can execute: ${(value as string[]).join(", ")}`;
    default:
      return "";
  }
}

/** Read the hench config.json directly from disk. */
function loadHenchConfig(projectDir: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(join(projectDir, ".hench", "config.json"), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Get a nested value from an object using dot-path notation. */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Set a nested value in an object using dot-path notation. */
function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== "object" || current[parts[i]] === null) {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/** Basic type validation for config values. */
function validateFieldValue(field: ConfigFieldInfo, value: unknown): string | null {
  switch (field.type) {
    case "number":
      if (typeof value !== "number" || isNaN(value)) return `${field.label} must be a number`;
      if (value < 0) return `${field.label} must be non-negative`;
      return null;
    case "boolean":
      if (typeof value !== "boolean") return `${field.label} must be a boolean`;
      return null;
    case "enum":
      if (field.enumValues && !field.enumValues.includes(String(value)))
        return `${field.label} must be one of: ${field.enumValues.join(", ")}`;
      return null;
    case "array":
      if (!Array.isArray(value)) return `${field.label} must be an array`;
      return null;
    case "string":
      if (typeof value !== "string" || value.length === 0) return `${field.label} must be a non-empty string`;
      return null;
    default:
      return null;
  }
}

/** Read a single run file, returning the full parsed JSON or null on error. */
function loadRunFile(runsDir: string, id: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(join(runsDir, `${id}.json`), "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Strip heavy fields to produce a lightweight summary for list views. */
function toRunSummary(run: Record<string, unknown>): RunSummary {
  const structured = run.structuredSummary as Record<string, unknown> | undefined;
  const diagnostics = run.diagnostics as Record<string, unknown> | undefined;
  return {
    id: run.id as string,
    taskId: run.taskId as string,
    taskTitle: run.taskTitle as string,
    startedAt: run.startedAt as string,
    finishedAt: run.finishedAt as string | undefined,
    lastActivityAt: run.lastActivityAt as string | undefined,
    status: run.status as string,
    turns: run.turns as number,
    summary: run.summary as string | undefined,
    error: run.error as string | undefined,
    model: run.model as string,
    tokenUsage: (run.tokenUsage ?? { input: 0, output: 0 }) as RunSummary["tokenUsage"],
    structuredSummary: structured
      ? { counts: structured.counts as RunSummary["structuredSummary"] extends { counts?: infer C } ? C : never }
      : undefined,
    vendor: diagnostics?.vendor as string | undefined,
    tokenDiagnosticStatus: diagnostics?.tokenDiagnosticStatus as RunSummary["tokenDiagnosticStatus"],
    invocationContext: run.invocationContext as RunSummary["invocationContext"],
  };
}

// ── Sub-routers ─────────────────────────────────────────────────────────────
// Each sub-router handles a resource group under /api/hench/.
// Returns false if the path doesn't belong to its group.

/** Options for the hench route handler. */
export interface HenchRouteOptions {
  /**
   * Called after mutations that change active/stale run counts so that the
   * status sidebar reflects the latest state. Injected by start.ts to avoid
   * a direct routes-hench → routes-status import.
   */
  onStatusInvalidate?: () => void;
}

/** Parsed request context shared across sub-routers. */
interface RouteContext {
  path: string;
  fullPath: string;
  qIdx: number;
  method: string;
  req: IncomingMessage;
  res: ServerResponse;
  ctx: ServerContext;
  runsDir: string;
  broadcast?: WebSocketBroadcaster;
  onStatusInvalidate?: () => void;
}

/** Routes: task-usage, audit */
function routeUsage(rc: RouteContext): boolean | Promise<boolean> | null {
  // GET /api/hench/task-usage — incremental per-task token usage aggregation
  if (rc.path === "task-usage" && rc.method === "GET") {
    const aggregator = getAggregator(rc.runsDir);
    return aggregator.getTaskUsage().then((taskUsage) => {
      const validIds = loadValidTaskIds(rc.ctx);
      if (validIds) {
        aggregator.pruneStaleEntries(validIds);
        const pruned: Record<string, (typeof taskUsage)[string]> = {};
        for (const [id, acc] of Object.entries(taskUsage)) {
          if (validIds.has(id)) pruned[id] = acc;
        }
        jsonResponse(rc.res, 200, { taskUsage: pruned });
      } else {
        jsonResponse(rc.res, 200, { taskUsage });
      }
      return true as const;
    });
  }

  // GET /api/hench/audit — task execution audit info
  if (rc.path === "audit" && rc.method === "GET") {
    return handleAudit(rc.res, rc.runsDir);
  }

  return null;
}

/** Routes: metrics, metrics/snapshots */
function routeMetrics(rc: RouteContext): boolean | null {
  if (rc.path === "metrics/snapshots" && rc.method === "GET") {
    return handleMetricsSnapshots(rc.res);
  }
  if (rc.path === "metrics" && rc.method === "GET") {
    return handleMetrics(rc.res);
  }
  return null;
}

/** Routes: memory, memory/history, memory/history/:taskId, memory/leaks */
function routeMemory(rc: RouteContext): boolean | null {
  if (!rc.path.startsWith("memory")) return null;

  if (rc.path === "memory" && rc.method === "GET") {
    return handleMemory(rc.res);
  }
  const historyMatch = rc.path.match(/^memory\/history\/([^/?]+)$/);
  if (historyMatch && rc.method === "GET") {
    return handleMemoryHistoryByTask(historyMatch[1]!, rc.res);
  }
  if (rc.path === "memory/history" && rc.method === "GET") {
    return handleMemoryHistory(rc.res);
  }
  if (rc.path === "memory/leaks" && rc.method === "GET") {
    return handleMemoryLeaks(rc.res);
  }
  return null;
}

/** Routes: throttle (GET/PUT), throttle/pause, throttle/resume, throttle/emergency-stop */
function routeThrottle(rc: RouteContext): boolean | Promise<boolean> | null {
  if (!rc.path.startsWith("throttle")) return null;

  if (rc.path === "throttle" && rc.method === "GET") {
    return handleThrottleGet(rc.res, rc.ctx);
  }
  if (rc.path === "throttle" && rc.method === "PUT") {
    return handleThrottleUpdate(rc.req, rc.res, rc.ctx, rc.broadcast);
  }
  if (rc.path === "throttle/pause" && rc.method === "POST") {
    return handleThrottlePause(rc.res, rc.broadcast, rc.ctx);
  }
  if (rc.path === "throttle/resume" && rc.method === "POST") {
    return handleThrottleResume(rc.res, rc.broadcast, rc.ctx);
  }
  if (rc.path === "throttle/emergency-stop" && rc.method === "POST") {
    return handleEmergencyStop(rc.req, rc.res, rc.broadcast, rc.ctx, rc.onStatusInvalidate);
  }
  return null;
}

/** Routes: execute (POST), execute/status, execute/status/:taskId, execute/:taskId/terminate */
function routeExecute(rc: RouteContext): boolean | Promise<boolean> | null {
  if (!rc.path.startsWith("execute")) return null;

  const terminateMatch = rc.path.match(/^execute\/([^/?]+)\/terminate$/);
  if (terminateMatch && rc.method === "POST") {
    return handleTerminate(terminateMatch[1], rc.res, rc.runsDir, rc.broadcast, rc.onStatusInvalidate);
  }
  if (rc.path === "execute" && rc.method === "POST") {
    return handleExecute(rc.req, rc.res, rc.ctx, rc.broadcast);
  }
  if (rc.path === "execute/status" && rc.method === "GET") {
    return handleExecuteStatus(rc.res);
  }
  const statusMatch = rc.path.match(/^execute\/status\/([^/?]+)$/);
  if (statusMatch && rc.method === "GET") {
    return handleExecuteStatusForTask(statusMatch[1], rc.res);
  }
  return null;
}

/** Routes: runs, runs/:id, runs/health, runs/:id/mark-stuck */
function routeRuns(rc: RouteContext): boolean | null {
  if (!rc.path.startsWith("runs")) return null;

  if (rc.path === "runs/health" && rc.method === "GET") {
    return handleRunsHealth(rc.res, rc.runsDir);
  }
  const markStuckMatch = rc.path.match(/^runs\/([^/?]+)\/mark-stuck$/);
  if (markStuckMatch && rc.method === "POST") {
    return handleMarkStuck(markStuckMatch[1], rc.res, rc.runsDir, rc.onStatusInvalidate);
  }

  // GET /api/hench/runs — list runs with summary (?limit=N&offset=N)
  if (rc.path === "runs" && rc.method === "GET") {
    let files: string[];
    try {
      files = readdirSync(rc.runsDir);
    } catch {
      jsonResponse(rc.res, 200, { runs: [], total: 0 });
      return true;
    }

    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    const total = jsonFiles.length;

    let limit = 0;
    let offset = 0;
    let filterTaskId: string | null = null;
    if (rc.qIdx !== -1) {
      const params = new URLSearchParams(rc.fullPath.slice(rc.qIdx));
      const limitStr = params.get("limit");
      const offsetStr = params.get("offset");
      const taskIdStr = params.get("taskId");
      if (limitStr) limit = Math.max(0, parseInt(limitStr, 10) || 0);
      if (offsetStr) offset = Math.max(0, parseInt(offsetStr, 10) || 0);
      if (taskIdStr) filterTaskId = taskIdStr;
    }

    jsonFiles.sort((a, b) => b.localeCompare(a));

    const filesToLoad = (!filterTaskId && (limit > 0 || offset > 0))
      ? jsonFiles.slice(offset, limit > 0 ? offset + limit : undefined)
      : jsonFiles;

    const summaries: RunSummary[] = [];
    for (const file of filesToLoad) {
      const id = file.replace(/\.json$/, "");
      const run = loadRunFile(rc.runsDir, id);
      if (run && run.id && run.startedAt) {
        // When filtering by taskId, skip non-matching runs before building summary
        if (filterTaskId && run.taskId !== filterTaskId) continue;
        summaries.push(toRunSummary(run));
      }
    }

    summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));

    // Apply limit/offset after taskId filtering (when both are present)
    const paginatedSummaries = filterTaskId && (limit > 0 || offset > 0)
      ? summaries.slice(offset, limit > 0 ? offset + limit : undefined)
      : summaries;

    jsonResponse(rc.res, 200, { runs: paginatedSummaries, total: filterTaskId ? summaries.length : total });
    return true;
  }

  // GET /api/hench/runs/:id — full run detail
  const runsMatch = rc.path.match(/^runs\/([^/?]+)$/);
  if (runsMatch && rc.method === "GET") {
    const runId = runsMatch[1];
    const run = loadRunFile(rc.runsDir, runId);
    if (!run) {
      errorResponse(rc.res, 404, `Run "${runId}" not found`);
      return true;
    }
    jsonResponse(rc.res, 200, run);
    return true;
  }

  return null;
}

/** Routes: config (GET/PUT) */
function routeConfig(rc: RouteContext): boolean | Promise<boolean> | null {
  if (!rc.path.startsWith("config")) return null;

  if (rc.path === "config" && rc.method === "GET") {
    const config = loadHenchConfig(rc.ctx.projectDir);
    if (!config) {
      errorResponse(rc.res, 404, "Hench configuration not found. Run 'hench init' first.");
      return true;
    }

    const fields = CONFIG_FIELD_META.map((field) => {
      const value = getNestedValue(config, field.path);
      const defaultValue = DEFAULT_CONFIG[field.path];
      const isDefault = JSON.stringify(value) === JSON.stringify(defaultValue);
      return {
        ...field,
        value,
        defaultValue,
        isDefault,
        impact: getImpact(field.path, value),
      };
    });

    jsonResponse(rc.res, 200, { config, fields });
    return true;
  }

  if (rc.path === "config" && rc.method === "PUT") {
    return handleConfigUpdate(rc.req, rc.res, rc.ctx);
  }
  return null;
}

/** Routes: templates (GET/POST), templates/:id (GET/DELETE), templates/:id/apply */
function routeTemplates(rc: RouteContext): boolean | Promise<boolean> | null {
  if (!rc.path.startsWith("templates")) return null;

  if (rc.path === "templates" && rc.method === "GET") {
    return handleTemplateList(rc.res, rc.ctx);
  }
  if (rc.path === "templates" && rc.method === "POST") {
    return handleTemplateCreate(rc.req, rc.res, rc.ctx);
  }
  const applyMatch = rc.path.match(/^templates\/([a-z][a-z0-9-]+)\/apply$/);
  if (applyMatch && rc.method === "POST") {
    return handleTemplateApply(applyMatch[1], rc.res, rc.ctx);
  }
  const idMatch = rc.path.match(/^templates\/([a-z][a-z0-9-]+)$/);
  if (idMatch && rc.method === "GET") {
    return handleTemplateGet(idMatch[1], rc.res, rc.ctx);
  }
  if (idMatch && rc.method === "DELETE") {
    return handleTemplateDelete(idMatch[1], rc.res, rc.ctx);
  }
  return null;
}

/** Handle Hench API requests. Returns true if the request was handled. */
export function handleHenchRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
  options?: HenchRouteOptions,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  if (!url.startsWith(HENCH_PREFIX)) return false;

  const fullPath = url.slice(HENCH_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  const rc: RouteContext = {
    path,
    fullPath,
    qIdx,
    method: req.method || "GET",
    req,
    res,
    ctx,
    runsDir: join(ctx.projectDir, ".hench", "runs"),
    broadcast,
    onStatusInvalidate: options?.onStatusInvalidate,
  };

  // Dispatch to sub-routers — first non-null result wins.
  return routeUsage(rc)
    ?? routeMetrics(rc)
    ?? routeMemory(rc)
    ?? routeThrottle(rc)
    ?? routeExecute(rc)
    ?? routeRuns(rc)
    ?? routeConfig(rc)
    ?? routeTemplates(rc)
    ?? routeConcurrency(rc)
    ?? false;
}

/** Routes: concurrency */
function routeConcurrency(rc: RouteContext): boolean | null {
  if (rc.path === "concurrency" && rc.method === "GET") {
    return handleConcurrency(rc.res, rc.ctx);
  }
  return null;
}

/** Handle PUT /api/hench/config — validate and apply config changes. */
async function handleConfigUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  const configPath = join(ctx.projectDir, ".hench", "config.json");

  // Load current config
  const current = loadHenchConfig(ctx.projectDir);
  if (!current) {
    errorResponse(res, 404, "Hench configuration not found. Run 'hench init' first.");
    return true;
  }

  // Parse request body
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const changes = body.changes as Record<string, unknown> | undefined;
  if (!changes || typeof changes !== "object") {
    errorResponse(res, 400, "Request body must include a 'changes' object with field path/value pairs");
    return true;
  }

  // Validate and apply each change
  const errors: string[] = [];
  const applied: Array<{ path: string; oldValue: unknown; newValue: unknown; impact: string }> = [];

  for (const [fieldPath, newValue] of Object.entries(changes)) {
    const field = CONFIG_FIELD_META.find((f) => f.path === fieldPath);
    if (!field) {
      errors.push(`Unknown field: ${fieldPath}`);
      continue;
    }

    const validationError = validateFieldValue(field, newValue);
    if (validationError) {
      errors.push(validationError);
      continue;
    }

    const oldValue = getNestedValue(current, fieldPath);
    setNestedValue(current, fieldPath, newValue);
    applied.push({
      path: fieldPath,
      oldValue,
      newValue,
      impact: getImpact(fieldPath, newValue),
    });
  }

  if (errors.length > 0) {
    errorResponse(res, 400, `Validation errors: ${errors.join("; ")}`);
    return true;
  }

  // Write back
  try {
    writeFileSync(configPath, JSON.stringify(current, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, { applied, config: current });
  return true;
}

// ── Workflow template types (duplicated from hench to avoid runtime coupling) ──

interface WorkflowTemplateData {
  id: string;
  name: string;
  description: string;
  useCases: string[];
  tags: string[];
  config: Record<string, unknown>;
  builtIn: boolean;
  createdAt?: string;
}

/** Built-in templates — matches hench/src/schema/templates.ts. */
const BUILT_IN_TEMPLATES: WorkflowTemplateData[] = [
  {
    id: "quick-iteration",
    name: "Quick Iteration",
    description: "Short, fast runs for rapid prototyping and small fixes",
    useCases: ["Bug fixes and small patches", "Quick refactors with clear scope", "Exploratory changes with fast feedback"],
    tags: ["fast", "lightweight", "prototyping"],
    config: { maxTurns: 15, tokenBudget: 50000, loopPauseMs: 500, retry: { maxRetries: 2, baseDelayMs: 1000, maxDelayMs: 10000 } },
    builtIn: true,
  },
  {
    id: "thorough-execution",
    name: "Thorough Execution",
    description: "Extended runs with generous limits for complex multi-file tasks",
    useCases: ["New feature implementation across multiple files", "Large refactoring efforts", "Tasks requiring extensive test writing"],
    tags: ["thorough", "complex", "multi-file"],
    config: { maxTurns: 80, maxTokens: 16384, tokenBudget: 200000, loopPauseMs: 2000, retry: { maxRetries: 5, baseDelayMs: 2000, maxDelayMs: 60000 } },
    builtIn: true,
  },
  {
    id: "budget-conscious",
    name: "Budget Conscious",
    description: "Optimized for minimal token usage while maintaining quality",
    useCases: ["Cost-sensitive environments", "High-volume task processing", "Routine maintenance tasks"],
    tags: ["budget", "cost-effective", "efficient"],
    config: { maxTurns: 20, maxTokens: 4096, tokenBudget: 30000, loopPauseMs: 3000, retry: { maxRetries: 2, baseDelayMs: 3000, maxDelayMs: 15000 } },
    builtIn: true,
  },
  {
    id: "strict-safety",
    name: "Strict Safety",
    description: "Maximum guard rails for sensitive codebases and production-adjacent work",
    useCases: ["Production infrastructure changes", "Security-sensitive code modifications", "Regulated environments requiring audit trails"],
    tags: ["safety", "security", "production"],
    config: { maxTurns: 30, maxFailedAttempts: 2, guard: { blockedPaths: [".hench/**", ".rex/**", ".git/**", "node_modules/**", ".env*", "*.pem", "*.key", "**/secrets/**", "**/credentials/**"], allowedCommands: ["npm", "npx", "node", "git", "tsc", "vitest"], commandTimeout: 15000, maxFileSize: 524288 } },
    builtIn: true,
  },
  {
    id: "api-direct",
    name: "API Direct",
    description: "Use Anthropic API directly instead of Claude Code CLI for headless environments",
    useCases: ["CI/CD pipeline integration", "Headless server environments", "Custom API key management"],
    tags: ["api", "headless", "ci-cd"],
    config: { provider: "api", maxTurns: 40, tokenBudget: 150000, retry: { maxRetries: 4, baseDelayMs: 3000, maxDelayMs: 30000 } },
    builtIn: true,
  },
];

const TEMPLATES_FILE = "templates.json";

/** Load user-defined templates from .hench/templates.json. */
function loadUserTemplates(projectDir: string): WorkflowTemplateData[] {
  const filePath = join(projectDir, ".hench", TEMPLATES_FILE);
  try {
    if (!existsSync(filePath)) return [];
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as WorkflowTemplateData[];
  } catch {
    return [];
  }
}

/** Get all templates (built-in + user). */
function getAllTemplates(projectDir: string): WorkflowTemplateData[] {
  const builtInIds = new Set(BUILT_IN_TEMPLATES.map((t) => t.id));
  const userTemplates = loadUserTemplates(projectDir).filter((t) => !builtInIds.has(t.id));
  return [...BUILT_IN_TEMPLATES, ...userTemplates];
}

/** Find a template by ID (built-in first, then user). */
function findTemplate(projectDir: string, id: string): WorkflowTemplateData | null {
  const builtIn = BUILT_IN_TEMPLATES.find((t) => t.id === id);
  if (builtIn) return builtIn;
  const user = loadUserTemplates(projectDir);
  return user.find((t) => t.id === id) ?? null;
}

/** Apply a template config overlay to a config object. */
function mergeTemplateConfig(
  config: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const result = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
  for (const [key, value] of Object.entries(overlay)) {
    if (key === "guard" || key === "retry") {
      // Deep merge nested objects
      const existing = (result[key] ?? {}) as Record<string, unknown>;
      result[key] = { ...existing, ...(value as Record<string, unknown>) };
    } else {
      result[key] = value;
    }
  }
  return result;
}

// ── Template route handlers ──────────────────────────────────────────

/** GET /api/hench/templates */
function handleTemplateList(
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const templates = getAllTemplates(ctx.projectDir);
  jsonResponse(res, 200, { templates });
  return true;
}

/** GET /api/hench/templates/:id */
function handleTemplateGet(
  id: string,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const template = findTemplate(ctx.projectDir, id);
  if (!template) {
    errorResponse(res, 404, `Template "${id}" not found`);
    return true;
  }
  jsonResponse(res, 200, template);
  return true;
}

/** POST /api/hench/templates — create/update user template. */
async function handleTemplateCreate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const id = body.id as string | undefined;
  if (!id || typeof id !== "string" || !/^[a-z][a-z0-9-]{1,49}$/.test(id)) {
    errorResponse(res, 400, "Template ID is required and must be lowercase with hyphens (2-50 chars)");
    return true;
  }

  // Reject overwriting built-in templates
  if (BUILT_IN_TEMPLATES.some((t) => t.id === id)) {
    errorResponse(res, 400, `Cannot overwrite built-in template "${id}"`);
    return true;
  }

  const template: WorkflowTemplateData = {
    id,
    name: (body.name as string) || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    description: (body.description as string) || "User-defined workflow template",
    useCases: Array.isArray(body.useCases) ? body.useCases as string[] : [],
    tags: Array.isArray(body.tags) ? body.tags as string[] : [],
    config: (body.config as Record<string, unknown>) || {},
    builtIn: false,
    createdAt: new Date().toISOString(),
  };

  // Load, update, and write back
  const filePath = join(ctx.projectDir, ".hench", TEMPLATES_FILE);
  const existing = loadUserTemplates(ctx.projectDir);
  const idx = existing.findIndex((t) => t.id === id);
  if (idx >= 0) {
    existing[idx] = template;
  } else {
    existing.push(template);
  }

  try {
    await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to save template: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 201, template);
  return true;
}

/** POST /api/hench/templates/:id/apply — apply template to current config. */
function handleTemplateApply(
  id: string,
  res: ServerResponse,
  ctx: ServerContext,
): boolean {
  const template = findTemplate(ctx.projectDir, id);
  if (!template) {
    errorResponse(res, 404, `Template "${id}" not found`);
    return true;
  }

  const config = loadHenchConfig(ctx.projectDir);
  if (!config) {
    errorResponse(res, 404, "Hench configuration not found. Run 'hench init' first.");
    return true;
  }

  const updated = mergeTemplateConfig(config, template.config);
  const configPath = join(ctx.projectDir, ".hench", "config.json");

  try {
    writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, {
    applied: template.id,
    templateName: template.name,
    config: updated,
  });
  return true;
}

/** DELETE /api/hench/templates/:id — delete user template. */
async function handleTemplateDelete(
  id: string,
  res: ServerResponse,
  ctx: ServerContext,
): Promise<boolean> {
  if (BUILT_IN_TEMPLATES.some((t) => t.id === id)) {
    errorResponse(res, 400, `Cannot delete built-in template "${id}"`);
    return true;
  }

  const filePath = join(ctx.projectDir, ".hench", TEMPLATES_FILE);
  const existing = loadUserTemplates(ctx.projectDir);
  const filtered = existing.filter((t) => t.id !== id);

  if (filtered.length === existing.length) {
    errorResponse(res, 404, `Template "${id}" not found`);
    return true;
  }

  try {
    await writeFile(filePath, JSON.stringify(filtered, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to delete template: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, { deleted: id });
  return true;
}

// ── Task execution ───────────────────────────────────────────────────

/** Actionable statuses — only tasks in these states can be triggered. */
const ACTIONABLE_STATUSES = new Set(["pending", "blocked"]);

/** Execution status for a single task run. */
export interface TaskExecutionStatus {
  taskId: string;
  taskTitle: string;
  runId: string;
  status: "starting" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt?: string;
  lastOutput?: string;
  error?: string;
  exitCode?: number | null;
}

/** Track active task executions to prevent concurrent runs on the same task. */
const activeExecutions = new Map<string, {
  runId: string;
  handle: ManagedChild;
  state: TaskExecutionStatus;
}>();

/** Load and parse prd.json from disk. */
function loadPRDForExecute(ctx: ServerContext): Record<string, unknown> | null {
  return loadPRDSync(ctx.rexDir) as Record<string, unknown> | null;
}

/**
 * Load the set of all task IDs currently in the PRD.
 * Returns null if the PRD cannot be read (e.g. not initialized yet),
 * allowing callers to degrade gracefully.
 */
function loadValidTaskIds(ctx: ServerContext): Set<string> | null {
  const doc = loadPRDSync(ctx.rexDir);
  if (!doc || !Array.isArray(doc.items)) return null;
  return collectAllIds(doc.items);
}

/** Recursively find a PRD item by ID. */
function findPRDItem(
  items: Array<Record<string, unknown>>,
  id: string,
): Record<string, unknown> | null {
  for (const item of items) {
    if (item.id === id) return item;
    const children = item.children as Array<Record<string, unknown>> | undefined;
    if (children) {
      const found = findPRDItem(children, id);
      if (found) return found;
    }
  }
  return null;
}

/** Broadcast an execution state update. */
function broadcastExecState(
  broadcast: WebSocketBroadcaster | undefined,
  state: TaskExecutionStatus,
): void {
  if (!broadcast) return;
  broadcast({
    type: "hench:task-execution-progress",
    state: { ...state },
    timestamp: new Date().toISOString(),
  });
}

/** POST /api/hench/execute — trigger Hench run for a specific task. */
async function handleExecute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  // Parse request body
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const taskId = body.taskId as string | undefined;
  if (!taskId || typeof taskId !== "string") {
    errorResponse(res, 400, "taskId is required");
    return true;
  }

  // Validate task exists in PRD
  const doc = loadPRDForExecute(ctx);
  if (!doc) {
    errorResponse(res, 404, "PRD not found. Run 'rex init' first.");
    return true;
  }

  const items = doc.items as Array<Record<string, unknown>> | undefined;
  if (!items) {
    errorResponse(res, 404, "PRD has no items");
    return true;
  }

  const task = findPRDItem(items, taskId);
  if (!task) {
    errorResponse(res, 404, `Task "${taskId}" not found in PRD`);
    return true;
  }

  // Validate task is actionable
  const status = task.status as string;
  if (!ACTIONABLE_STATUSES.has(status)) {
    errorResponse(res, 409, `Task is in "${status}" status and cannot be executed. Only pending or blocked tasks can be triggered.`);
    return true;
  }

  // Check if new executions are paused via throttle controls
  if (throttleState.paused) {
    errorResponse(res, 503, "New executions are paused. Resume via the throttle controls before starting new tasks.");
    return true;
  }

  // Check for concurrent execution
  if (activeExecutions.has(taskId)) {
    const active = activeExecutions.get(taskId)!;
    jsonResponse(res, 409, {
      error: "Task is already being executed",
      runId: active.runId,
      taskId,
    });
    return true;
  }

  // Resolve hench binary
  const henchBin = join(ctx.projectDir, "node_modules", ".bin", "hench");
  const henchFallback = join(ctx.projectDir, "packages", "hench", "dist", "cli", "index.js");
  const args = ["run", `--task=${taskId}`, "--auto", ctx.projectDir];

  const binPath = existsSync(henchBin) ? henchBin : "node";
  const binArgs = existsSync(henchBin) ? args : [henchFallback, ...args];

  // Generate a run ID for tracking (hench will generate its own, but we
  // need one to correlate the response before the process starts writing)
  const runId = `exec-${Date.now().toString(36)}`;
  const taskTitle = task.title as string;

  // Build initial execution state
  const execState: TaskExecutionStatus = {
    taskId,
    taskTitle,
    runId,
    status: "starting",
    startedAt: new Date().toISOString(),
  };

  // Spawn hench process
  const handle = spawnManaged(binPath, binArgs, {
    cwd: ctx.projectDir,
    stdio: "pipe",
    env: { ...process.env },
  });

  // Track active execution
  activeExecutions.set(taskId, { runId, handle, state: execState });

  // Register with execution metrics (uses PID when available, 0 until spawned)
  executionMetrics.taskStarted(taskId, taskTitle, handle.pid ?? 0);

  // Broadcast initial state
  broadcastExecState(broadcast, execState);

  // Transition to "running" after a short delay (hench takes a moment to initialize)
  setTimeout(() => {
    const entry = activeExecutions.get(taskId);
    if (entry && entry.state.status === "starting") {
      entry.state.status = "running";
      broadcastExecState(broadcast, { ...entry.state });
    }
  }, 2000);

  // Handle process completion
  handle.done
    .then((result) => {
      const entry = activeExecutions.get(taskId);
      if (entry) {
        const isSuccess = result.exitCode === 0;
        entry.state.status = isSuccess ? "completed" : "failed";
        entry.state.finishedAt = new Date().toISOString();
        entry.state.exitCode = result.exitCode;
        if (!isSuccess && result.stderr) {
          entry.state.error = result.stderr.slice(-200);
        }
        if (result.stdout) {
          entry.state.lastOutput = result.stdout.slice(-200);
        }
        broadcastExecState(broadcast, { ...entry.state });
      }
      processMemoryTracker.markCompleted(taskId);
      executionMetrics.taskCompleted(taskId);
      activeExecutions.delete(taskId);
    })
    .catch((err) => {
      const entry = activeExecutions.get(taskId);
      if (entry) {
        entry.state.status = "failed";
        entry.state.finishedAt = new Date().toISOString();
        entry.state.error = err instanceof Error ? err.message : String(err);
        broadcastExecState(broadcast, { ...entry.state });
      }
      processMemoryTracker.markCompleted(taskId);
      executionMetrics.taskCompleted(taskId);
      activeExecutions.delete(taskId);
    });

  // Return immediately with tracking info
  jsonResponse(res, 202, {
    runId,
    taskId,
    taskTitle,
    status: "started",
  });
  return true;
}

/** GET /api/hench/execute/status — return status of all active executions. */
function handleExecuteStatus(res: ServerResponse): boolean {
  const executions: TaskExecutionStatus[] = [];
  for (const entry of activeExecutions.values()) {
    executions.push({ ...entry.state });
  }
  jsonResponse(res, 200, { executions });
  return true;
}

/** GET /api/hench/execute/status/:taskId — return status of a specific task execution. */
function handleExecuteStatusForTask(taskId: string, res: ServerResponse): boolean {
  const entry = activeExecutions.get(taskId);
  if (!entry) {
    jsonResponse(res, 200, { execution: null });
    return true;
  }
  jsonResponse(res, 200, { execution: { ...entry.state } });
  return true;
}

// ── Health monitoring ─────────────────────────────────────────────────

/** Default staleness threshold: 5 minutes in milliseconds. */
const STALE_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Heartbeat interval expected from the agent (matches hench heartbeat writer).
 * Used to compute missedHeartbeats and heartbeatStatus.
 */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** Warning threshold: flag as "warning" after 2 missed heartbeats (60s). */
const HEARTBEAT_WARNING_MS = HEARTBEAT_INTERVAL_MS * 2;

/** Unresponsive threshold: flag as "unresponsive" after 4 missed heartbeats (120s). */
const HEARTBEAT_UNRESPONSIVE_MS = HEARTBEAT_INTERVAL_MS * 4;

export type HeartbeatStatus = "healthy" | "warning" | "unresponsive" | "unknown";

/** Compute heartbeat health from time since last activity. */
function computeHeartbeatStatus(
  lastActivityMs: number | null,
  nowMs: number,
): { status: HeartbeatStatus; missedHeartbeats: number } {
  if (lastActivityMs == null) {
    return { status: "unknown", missedHeartbeats: 0 };
  }
  const elapsed = nowMs - lastActivityMs;
  const missedHeartbeats = Math.max(0, Math.floor(elapsed / HEARTBEAT_INTERVAL_MS));

  let status: HeartbeatStatus;
  if (elapsed < HEARTBEAT_WARNING_MS) {
    status = "healthy";
  } else if (elapsed < HEARTBEAT_UNRESPONSIVE_MS) {
    status = "warning";
  } else {
    status = "unresponsive";
  }
  return { status, missedHeartbeats };
}

/** GET /api/hench/runs/health — detect stale "running" runs. */
function handleRunsHealth(res: ServerResponse, runsDir: string): boolean {
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    jsonResponse(res, 200, { activeRuns: 0, staleRuns: 0, runs: [] });
    return true;
  }

  const now = Date.now();
  const runningRuns: Array<{
    id: string;
    taskId: string;
    taskTitle: string;
    startedAt: string;
    lastActivityAt?: string;
    stale: boolean;
    staleSinceMs?: number;
  }> = [];

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    const run = loadRunFile(runsDir, id);
    if (!run || run.status !== "running") continue;

    const lastActivity = run.lastActivityAt as string | undefined;
    const lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : null;
    const stale = lastActivityMs != null
      ? (now - lastActivityMs) > STALE_THRESHOLD_MS
      : true; // No lastActivityAt = legacy run, treat as stale if still "running"

    runningRuns.push({
      id: run.id as string,
      taskId: run.taskId as string,
      taskTitle: run.taskTitle as string,
      startedAt: run.startedAt as string,
      lastActivityAt: lastActivity,
      stale,
      staleSinceMs: lastActivityMs != null ? Math.max(0, now - lastActivityMs) : undefined,
    });
  }

  jsonResponse(res, 200, {
    activeRuns: runningRuns.length,
    staleRuns: runningRuns.filter((r) => r.stale).length,
    runs: runningRuns,
  });
  return true;
}

/** POST /api/hench/runs/:id/mark-stuck — mark a stuck run as failed. */
function handleMarkStuck(
  runId: string,
  res: ServerResponse,
  runsDir: string,
  onStatusInvalidate?: () => void,
): boolean {
  const runPath = join(runsDir, `${runId}.json`);
  const run = loadRunFile(runsDir, runId);
  if (!run) {
    errorResponse(res, 404, `Run "${runId}" not found`);
    return true;
  }

  if (run.status !== "running") {
    errorResponse(res, 409, `Run is "${run.status}", not "running". Cannot mark as stuck.`);
    return true;
  }

  // Patch the run file on disk
  run.status = "failed";
  run.error = "Manually marked as stuck (no recent activity)";
  run.finishedAt = new Date().toISOString();

  try {
    writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to update run: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  // Invalidate status cache so sidebar shows updated active/stale counts
  onStatusInvalidate?.();

  jsonResponse(res, 200, { id: runId, status: "failed", markedStuckAt: run.finishedAt });
  return true;
}

// ── Heartbeat monitor ─────────────────────────────────────────────────

/**
 * Start a periodic heartbeat monitor that scans for unresponsive running tasks
 * and broadcasts alerts via WebSocket.
 *
 * The monitor runs every 30 seconds and broadcasts:
 * - `hench:heartbeat-alert` when a task transitions to "warning" or "unresponsive"
 * - `hench:heartbeat-status` with a summary of all running task heartbeats
 *
 * Call this once at server startup. The timer is unref'd so it won't prevent
 * process exit.
 */
export function startHeartbeatMonitor(
  runsDir: string,
  broadcast: WebSocketBroadcaster,
): void {
  // Track previously-alerted runs to only broadcast on transitions
  const alertedRuns = new Map<string, HeartbeatStatus>();

  const timer = setInterval(() => {
    let files: string[];
    try {
      files = readdirSync(runsDir);
    } catch {
      return; // runs dir may not exist yet
    }

    const now = Date.now();
    const alerts: Array<{
      runId: string;
      taskId: string;
      taskTitle: string;
      heartbeatStatus: HeartbeatStatus;
      missedHeartbeats: number;
      lastActivityAt?: string;
    }> = [];

    const activeRunIds = new Set<string>();

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/, "");
      const run = loadRunFile(runsDir, id);
      if (!run || run.status !== "running") continue;

      activeRunIds.add(id);

      const lastActivity = run.lastActivityAt as string | undefined;
      const lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : null;
      const hb = computeHeartbeatStatus(lastActivityMs, now);

      // Only alert on transitions to warning or unresponsive
      const previousStatus = alertedRuns.get(id);
      if (
        hb.status !== "healthy" &&
        hb.status !== "unknown" &&
        hb.status !== previousStatus
      ) {
        alerts.push({
          runId: run.id as string,
          taskId: run.taskId as string,
          taskTitle: run.taskTitle as string,
          heartbeatStatus: hb.status,
          missedHeartbeats: hb.missedHeartbeats,
          lastActivityAt: lastActivity,
        });
      }

      alertedRuns.set(id, hb.status);
    }

    // Clean up stale entries from alertedRuns
    for (const id of alertedRuns.keys()) {
      if (!activeRunIds.has(id)) {
        alertedRuns.delete(id);
      }
    }

    // Broadcast alerts for newly-unresponsive tasks
    for (const alert of alerts) {
      broadcast({
        type: "hench:heartbeat-alert",
        ...alert,
        timestamp: new Date().toISOString(),
      });
    }
  }, HEARTBEAT_INTERVAL_MS);

  // Don't prevent process exit
  if (timer.unref) {
    timer.unref();
  }
}

/**
 * Start a periodic concurrency status broadcaster.
 *
 * Broadcasts `hench:concurrency-status` via WebSocket every 10 seconds
 * with current process count, max limit, utilization level, and queue info.
 * This enables real-time updates of the concurrency panel in the dashboard.
 *
 * Call this once at server startup alongside startHeartbeatMonitor.
 * The timer is unref'd so it won't prevent process exit.
 */
export function startConcurrencyMonitor(
  ctx: ServerContext,
  broadcast: WebSocketBroadcaster,
): void {
  const CONCURRENCY_BROADCAST_MS = 10_000; // 10 seconds

  const timer = setInterval(() => {
    const henchDir = join(ctx.projectDir, ".hench");
    const locksDir = join(henchDir, "locks");
    const runsDir = join(henchDir, "runs");

    // Read max concurrent (respects runtime override from throttle controls)
    const maxConcurrent = getEffectiveMaxConcurrent(ctx.projectDir);

    // Read lock files
    let processCount = 0;
    try {
      const files = readdirSync(locksDir);
      for (const file of files) {
        if (!file.endsWith(".lock")) continue;
        try {
          const raw = readFileSync(join(locksDir, file), "utf-8");
          const lock = JSON.parse(raw) as ConcurrencyLockFile;
          if (isPidAlive(lock.pid)) processCount++;
        } catch {
          // skip corrupted lock files
        }
      }
    } catch {
      // locks dir doesn't exist yet
    }

    // Dashboard active
    const dashboardRunning = Array.from(activeExecutions.values()).filter(
      (e) => e.state.status === "running" || e.state.status === "starting",
    ).length;

    // Disk running
    const dashboardTaskIds = new Set(activeExecutions.keys());
    let diskRunning = 0;
    try {
      const runFiles = readdirSync(runsDir);
      for (const file of runFiles) {
        if (!file.endsWith(".json")) continue;
        const id = file.replace(/\.json$/, "");
        const run = loadRunFile(runsDir, id);
        if (run && run.status === "running" && !dashboardTaskIds.has(run.taskId as string)) {
          diskRunning++;
        }
      }
    } catch {
      // runs dir may not exist
    }

    const totalRunning = dashboardRunning + diskRunning;
    const utilization = maxConcurrent > 0 ? processCount / maxConcurrent : 0;
    let level: ConcurrencyLevel;
    if (processCount >= maxConcurrent) {
      level = "at_limit";
    } else if (utilization >= 0.67) {
      level = "high";
    } else if (utilization > 0) {
      level = "moderate";
    } else {
      level = "low";
    }

    broadcast({
      type: "hench:concurrency-status",
      processCount,
      maxConcurrent,
      slotsAvailable: Math.max(0, maxConcurrent - processCount),
      level,
      utilization: Math.min(1, utilization),
      totalRunning,
      dashboardActive: activeExecutions.size,
      diskRunning,
      timestamp: new Date().toISOString(),
    });
  }, CONCURRENCY_BROADCAST_MS);

  if (timer.unref) {
    timer.unref();
  }
}

// ── Memory / resource monitoring ──────────────────────────────────────

/** Memory health level for UI indicators. */
type MemoryHealthLevel = "healthy" | "warning" | "critical";

/** Per-process memory snapshot. */
interface ProcessMemoryEntry {
  taskId: string;
  taskTitle: string;
  pid: number;
  rssBytes: number;
  source: "dashboard" | "disk";
}

/** Full memory status response shape. */
interface MemoryStatus {
  system: {
    totalBytes: number;
    freeBytes: number;
    usedBytes: number;
    usedPercent: number;
  };
  server: {
    pid: number;
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
    externalBytes: number;
  };
  processes: ProcessMemoryEntry[];
  health: MemoryHealthLevel;
  loadAvg: [number, number, number];
  cpuCount: number;
  timestamp: string;
}

/**
 * Determine memory health level based on system memory usage percentage.
 *
 * - healthy: < 75% used (green)
 * - warning: 75–90% used (yellow/orange)
 * - critical: ≥ 90% used (red)
 */
function computeMemoryHealth(usedPercent: number): MemoryHealthLevel {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 75) return "warning";
  return "healthy";
}

/**
 * Attempt to read RSS (resident set size) for a given PID.
 *
 * Uses /proc/<pid>/statm on Linux and `ps` on macOS/other.
 * Returns null if the PID is unreachable or the read fails.
 */
function getProcessRss(pid: number): number | null {
  try {
    // Linux: read from /proc filesystem (no child process needed)
    try {
      const statm = readFileSync(`/proc/${pid}/statm`, "utf-8");
      const pages = parseInt(statm.split(" ")[1]!, 10);
      if (!isNaN(pages)) {
        // Page size is typically 4096 bytes
        return pages * 4096;
      }
    } catch {
      // Not Linux or PID gone — fall through to ps
    }

    // macOS / other: use ps command
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], {
      timeout: 2000,
      encoding: "utf-8",
    });
    const kb = parseInt(out.trim(), 10);
    if (!isNaN(kb)) return kb * 1024;
    return null;
  } catch {
    return null;
  }
}

/** Collect full memory status snapshot. */
function collectMemoryStatus(): MemoryStatus {
  const totalBytes = totalmem();
  const freeBytes = freemem();
  const usedBytes = totalBytes - freeBytes;
  const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 100) : 0;

  const mem = process.memoryUsage();
  const load = loadavg() as [number, number, number];
  const cpuCount = cpus().length;

  // Collect per-process memory for active executions
  const processes: ProcessMemoryEntry[] = [];
  for (const [taskId, entry] of activeExecutions.entries()) {
    const pid = entry.handle.pid;
    if (pid == null) continue;
    const rssBytes = getProcessRss(pid);
    if (rssBytes != null) {
      processes.push({
        taskId,
        taskTitle: entry.state.taskTitle,
        pid,
        rssBytes,
        source: "dashboard",
      });
    }
  }

  return {
    system: { totalBytes, freeBytes, usedBytes, usedPercent },
    server: {
      pid: process.pid,
      rssBytes: mem.rss,
      heapUsedBytes: mem.heapUsed,
      heapTotalBytes: mem.heapTotal,
      externalBytes: mem.external,
    },
    processes,
    health: computeMemoryHealth(usedPercent),
    loadAvg: load,
    cpuCount,
    timestamp: new Date().toISOString(),
  };
}

/** GET /api/hench/metrics — concurrent execution metrics and resource utilization. */
function handleMetrics(res: ServerResponse): boolean {
  const summary = executionMetrics.getSummary();
  jsonResponse(res, 200, summary);
  return true;
}

/** GET /api/hench/metrics/snapshots — time-series execution metrics snapshots. */
function handleMetricsSnapshots(res: ServerResponse): boolean {
  const snapshots = executionMetrics.getSnapshots();
  jsonResponse(res, 200, {
    snapshots,
    count: snapshots.length,
    maxSnapshots: executionMetrics.config.maxSnapshots,
    timestamp: new Date().toISOString(),
  });
  return true;
}

/** GET /api/hench/memory — system memory, per-process memory, and resource health. */
function handleMemory(res: ServerResponse): boolean {
  const status = collectMemoryStatus();
  jsonResponse(res, 200, status);
  return true;
}

/** GET /api/hench/memory/history — per-process memory history for all tracked processes. */
function handleMemoryHistory(res: ServerResponse): boolean {
  const histories = processMemoryTracker.getAllHistories();
  jsonResponse(res, 200, {
    histories,
    activeProcesses: processMemoryTracker.activeCount,
    completedProcesses: processMemoryTracker.completedCount,
    timestamp: new Date().toISOString(),
  });
  return true;
}

/** GET /api/hench/memory/history/:taskId — memory history for a specific task. */
function handleMemoryHistoryByTask(taskId: string, res: ServerResponse): boolean {
  const history = processMemoryTracker.getHistory(taskId);
  if (!history) {
    jsonResponse(res, 404, {
      error: "not_found",
      message: `No memory history for task ${taskId}`,
    });
    return true;
  }
  jsonResponse(res, 200, history);
  return true;
}

/** GET /api/hench/memory/leaks — leak detection summary for all active processes. */
function handleMemoryLeaks(res: ServerResponse): boolean {
  const summary = processMemoryTracker.detectLeaks();
  jsonResponse(res, 200, summary);
  return true;
}

/**
 * Periodically broadcast memory + resource health via WebSocket.
 * Runs every 10 seconds so the memory panel stays live.
 *
 * Also records per-process RSS samples into the process memory tracker
 * for historical analysis and leak detection.
 */
export function startMemoryMonitor(broadcast: WebSocketBroadcaster): void {
  const MEMORY_BROADCAST_MS = 10_000;

  const timer = setInterval(() => {
    const status = collectMemoryStatus();

    // Record per-process samples for historical tracking + leak detection
    for (const proc of status.processes) {
      processMemoryTracker.recordSample(
        proc.taskId,
        proc.taskTitle,
        proc.pid,
        proc.rssBytes,
      );
    }

    // Record execution metrics snapshot (concurrent count, total RSS, per-task)
    const totalRssBytes = status.processes.reduce((sum, p) => sum + p.rssBytes, 0);
    executionMetrics.recordSnapshot({
      concurrentCount: status.processes.length,
      totalRssBytes,
      systemMemoryPercent: status.system.usedPercent,
      loadAvg1m: status.loadAvg[0],
      perTaskRss: status.processes.map((p) => ({
        taskId: p.taskId,
        rssBytes: p.rssBytes,
      })),
    });

    // Prune tracker entries for processes that are no longer active
    // (the activeExecutions map is the source of truth)
    for (const history of processMemoryTracker.getActiveHistories()) {
      if (!activeExecutions.has(history.taskId)) {
        processMemoryTracker.markCompleted(history.taskId);
      }
    }

    // Include leak alerts in the broadcast when detected
    const leakAlerts = processMemoryTracker.getLeakAlerts();

    // Include execution metrics summary in the broadcast
    const metricsSummary = executionMetrics.getSummary();

    broadcast({
      type: "hench:memory-status",
      ...status,
      ...(leakAlerts.length > 0 ? { leakAlerts } : {}),
      executionMetrics: metricsSummary,
    });
  }, MEMORY_BROADCAST_MS);

  if (timer.unref) {
    timer.unref();
  }
}

// ── Concurrency status ────────────────────────────────────────────────

/**
 * Lock file shape — matches hench/src/process/limiter.ts LockFileData.
 * Duplicated here to avoid runtime coupling with the hench package.
 */
interface ConcurrencyLockFile {
  pid: number;
  startedAt: string;
  taskId?: string;
}

/** Default max concurrent processes (matches hench DEFAULT_HENCH_CONFIG). */
const DEFAULT_MAX_CONCURRENT_PROCESSES = 3;

/** Check whether a process with the given PID is still alive. */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Concurrency utilization level for UI indicators. */
type ConcurrencyLevel = "low" | "moderate" | "high" | "at_limit";

// ── Throttle state ────────────────────────────────────────────────────

/**
 * In-memory throttle state for manual execution controls.
 *
 * This is a runtime-only override — it does not persist to disk and resets
 * on server restart. The `concurrencyOverride` (when set) takes precedence
 * over the config-file value for all concurrency calculations. When
 * `paused` is true, new executions are rejected by the execute handler.
 */
interface ThrottleState {
  /** Whether new task executions are paused. */
  paused: boolean;
  /** Timestamp when pause was activated, or null if not paused. */
  pausedAt: string | null;
  /** Runtime concurrency limit override. null = use config value. */
  concurrencyOverride: number | null;
  /** Timestamp of last emergency stop, or null if never. */
  lastEmergencyStopAt: string | null;
  /** Count of executions terminated by last emergency stop. */
  lastEmergencyStopCount: number;
}

const throttleState: ThrottleState = {
  paused: false,
  pausedAt: null,
  concurrencyOverride: null,
  lastEmergencyStopAt: null,
  lastEmergencyStopCount: 0,
};

/**
 * Get the effective max concurrent processes, respecting the runtime
 * override when set.
 */
function getEffectiveMaxConcurrent(projectDir: string): number {
  if (throttleState.concurrencyOverride !== null) {
    return throttleState.concurrencyOverride;
  }
  const config = loadHenchConfig(projectDir);
  const guard = config?.guard as Record<string, unknown> | undefined;
  return typeof guard?.maxConcurrentProcesses === "number"
    ? guard.maxConcurrentProcesses
    : DEFAULT_MAX_CONCURRENT_PROCESSES;
}

/**
 * GET /api/hench/concurrency — returns concurrent execution status.
 *
 * Combines three data sources:
 * 1. PID lock files in .hench/locks/ (cross-process limiter)
 * 2. In-memory dashboard-triggered executions
 * 3. Disk-based running runs (.hench/runs/)
 *
 * Returns current/max counts, queue info, pending PRD tasks, and
 * a utilization level for visual indicators.
 */
function handleConcurrency(res: ServerResponse, ctx: ServerContext): boolean {
  const henchDir = join(ctx.projectDir, ".hench");
  const locksDir = join(henchDir, "locks");
  const runsDir = join(henchDir, "runs");

  // 1. Read max concurrent (respects runtime override from throttle controls)
  const maxConcurrent = getEffectiveMaxConcurrent(ctx.projectDir);

  // 2. Read lock files and check PID liveness
  const activeLocks: Array<{
    pid: number;
    startedAt: string;
    taskId?: string;
    alive: boolean;
  }> = [];

  try {
    const files = readdirSync(locksDir);
    for (const file of files) {
      if (!file.endsWith(".lock")) continue;
      try {
        const raw = readFileSync(join(locksDir, file), "utf-8");
        const lock = JSON.parse(raw) as ConcurrencyLockFile;
        const alive = isPidAlive(lock.pid);
        activeLocks.push({
          pid: lock.pid,
          startedAt: lock.startedAt,
          taskId: lock.taskId,
          alive,
        });
      } catch {
        // Corrupted lock file — skip
      }
    }
  } catch {
    // Locks dir doesn't exist yet — no active locks
  }

  const aliveLocks = activeLocks.filter((l) => l.alive);

  // 3. Count dashboard-triggered executions
  const dashboardActive = activeExecutions.size;
  const dashboardRunning = Array.from(activeExecutions.values()).filter(
    (e) => e.state.status === "running" || e.state.status === "starting",
  ).length;

  // 4. Count disk-based running runs (excludes dashboard-tracked ones)
  const dashboardTaskIds = new Set(activeExecutions.keys());
  let diskRunningCount = 0;
  try {
    const runFiles = readdirSync(runsDir);
    for (const file of runFiles) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/, "");
      const run = loadRunFile(runsDir, id);
      if (run && run.status === "running" && !dashboardTaskIds.has(run.taskId as string)) {
        diskRunningCount++;
      }
    }
  } catch {
    // runs dir may not exist
  }

  // 5. Count pending PRD tasks
  let pendingTaskCount = 0;
  try {
    const prd = loadPRDSync(ctx.rexDir);
    if (prd && Array.isArray(prd.items)) {
      pendingTaskCount = countPendingTasks(prd.items as Array<Record<string, unknown>>);
    }
  } catch {
    // PRD not available
  }

  // 6. Compute aggregate counts
  // The "active process count" is the number of live lock-holding processes,
  // which is the authoritative cross-process count.
  const processCount = aliveLocks.length;

  // Total running tasks combines dashboard + disk sources (deduplicated)
  const totalRunning = dashboardRunning + diskRunningCount;

  // Compute utilization level
  const utilization = maxConcurrent > 0 ? processCount / maxConcurrent : 0;
  let level: ConcurrencyLevel;
  if (processCount >= maxConcurrent) {
    level = "at_limit";
  } else if (utilization >= 0.67) {
    level = "high";
  } else if (utilization > 0) {
    level = "moderate";
  } else {
    level = "low";
  }

  // Slots remaining before limit is reached
  const slotsAvailable = Math.max(0, maxConcurrent - processCount);

  jsonResponse(res, 200, {
    processCount,
    maxConcurrent,
    slotsAvailable,
    level,
    utilization: Math.min(1, utilization),
    totalRunning,
    dashboardActive,
    diskRunning: diskRunningCount,
    pendingTasks: pendingTaskCount,
    locks: aliveLocks.map((l) => ({
      pid: l.pid,
      startedAt: l.startedAt,
      taskId: l.taskId,
    })),
    timestamp: new Date().toISOString(),
  });
  return true;
}

/** Recursively count pending/blocked tasks (leaf tasks only). */
function countPendingTasks(items: Array<Record<string, unknown>>): number {
  let count = 0;
  for (const item of items) {
    const children = item.children as Array<Record<string, unknown>> | undefined;
    if (children && children.length > 0) {
      count += countPendingTasks(children);
    } else {
      const status = item.status as string;
      if (status === "pending" || status === "blocked") {
        count++;
      }
    }
  }
  return count;
}

// ── Audit interface ───────────────────────────────────────────────────

/** Audit info for a single active task. */
interface AuditEntry {
  taskId: string;
  taskTitle: string;
  runId: string;
  pid: number | null;
  status: string;
  startedAt: string;
  lastActivityAt?: string;
  elapsedMs: number;
  stale: boolean;
  /** Source: "dashboard" (in-memory execution) or "disk" (run file with status=running). */
  source: "dashboard" | "disk";
  lastOutput?: string;
  turns?: number;
  model?: string;
  tokenUsage?: { input: number; output: number };
  /** Heartbeat health status: healthy, warning, unresponsive, or unknown. */
  heartbeatStatus: HeartbeatStatus;
  /** Number of missed heartbeat intervals since last activity. */
  missedHeartbeats: number;
}

/** GET /api/hench/audit — aggregate audit info for all active tasks. */
function handleAudit(res: ServerResponse, runsDir: string): boolean {
  const now = Date.now();
  const entries: AuditEntry[] = [];

  // 1. Dashboard-triggered executions (have PID from the managed child handle)
  for (const [taskId, entry] of activeExecutions.entries()) {
    const startMs = new Date(entry.state.startedAt).getTime();
    entries.push({
      taskId,
      taskTitle: entry.state.taskTitle,
      runId: entry.state.runId,
      pid: entry.handle.pid ?? null,
      status: entry.state.status,
      startedAt: entry.state.startedAt,
      elapsedMs: now - startMs,
      stale: false, // dashboard executions are tracked in real-time
      source: "dashboard",
      lastOutput: entry.state.lastOutput,
      heartbeatStatus: "healthy", // dashboard executions are tracked in real-time
      missedHeartbeats: 0,
    });
  }

  // 2. Disk-based running runs (from .hench/runs/*.json)
  const dashboardTaskIds = new Set(activeExecutions.keys());
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    files = [];
  }

  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const id = file.replace(/\.json$/, "");
    const run = loadRunFile(runsDir, id);
    if (!run || run.status !== "running") continue;

    const runTaskId = run.taskId as string;
    // Skip if already tracked by a dashboard execution
    if (dashboardTaskIds.has(runTaskId)) continue;

    const lastActivity = run.lastActivityAt as string | undefined;
    const lastActivityMs = lastActivity ? new Date(lastActivity).getTime() : null;
    const stale = lastActivityMs != null
      ? (now - lastActivityMs) > STALE_THRESHOLD_MS
      : true;
    const startMs = new Date(run.startedAt as string).getTime();
    const hb = computeHeartbeatStatus(lastActivityMs, now);

    entries.push({
      taskId: runTaskId,
      taskTitle: run.taskTitle as string,
      runId: run.id as string,
      pid: null, // PIDs are not tracked in run files
      status: "running",
      startedAt: run.startedAt as string,
      lastActivityAt: lastActivity,
      elapsedMs: now - startMs,
      stale,
      source: "disk",
      turns: run.turns as number | undefined,
      model: run.model as string | undefined,
      tokenUsage: run.tokenUsage as { input: number; output: number } | undefined,
      heartbeatStatus: hb.status,
      missedHeartbeats: hb.missedHeartbeats,
    });
  }

  // System resource snapshot (process-level, not per-child)
  const mem = process.memoryUsage();
  const systemInfo = {
    serverPid: process.pid,
    serverUptime: Math.floor(process.uptime()),
    memoryUsage: {
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      rss: mem.rss,
      external: mem.external,
    },
    activeExecutions: activeExecutions.size,
  };

  jsonResponse(res, 200, { entries, systemInfo, timestamp: new Date().toISOString() });
  return true;
}

/** POST /api/hench/execute/:taskId/terminate — terminate a running task. */
function handleTerminate(
  taskId: string,
  res: ServerResponse,
  runsDir: string,
  broadcast?: WebSocketBroadcaster,
  onStatusInvalidate?: () => void,
): boolean {
  const entry = activeExecutions.get(taskId);

  if (!entry) {
    // Check if there's a disk-based running run we can at least mark as failed
    let files: string[];
    try {
      files = readdirSync(runsDir);
    } catch {
      errorResponse(res, 404, `No active execution found for task "${taskId}"`);
      return true;
    }

    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(/\.json$/, "");
      const run = loadRunFile(runsDir, id);
      if (run && run.status === "running" && run.taskId === taskId) {
        // Mark as terminated on disk
        run.status = "failed";
        run.error = "Terminated via audit interface";
        run.finishedAt = new Date().toISOString();
        const runPath = join(runsDir, `${id}.json`);
        try {
          writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n", "utf-8");
        } catch (err) {
          errorResponse(res, 500, `Failed to update run: ${err instanceof Error ? err.message : String(err)}`);
          return true;
        }
        onStatusInvalidate?.();
        jsonResponse(res, 200, {
          taskId,
          runId: id,
          terminated: true,
          method: "disk-mark",
          message: "Run marked as terminated (process not managed by dashboard)",
        });
        return true;
      }
    }

    errorResponse(res, 404, `No active execution found for task "${taskId}"`);
    return true;
  }

  // Kill the managed process
  const pid = entry.handle.pid;
  const killed = entry.handle.kill("SIGTERM");

  // Update state
  entry.state.status = "failed";
  entry.state.finishedAt = new Date().toISOString();
  entry.state.error = "Terminated via audit interface";

  broadcastExecState(broadcast, { ...entry.state });
  processMemoryTracker.markCompleted(taskId);
  executionMetrics.taskCompleted(taskId);
  activeExecutions.delete(taskId);
  onStatusInvalidate?.();

  jsonResponse(res, 200, {
    taskId,
    runId: entry.state.runId,
    pid,
    terminated: true,
    signalSent: killed,
    method: "sigterm",
    message: "Process terminated",
  });
  return true;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────

/**
 * Result returned by {@link shutdownActiveExecutions}.
 *
 * Callers (e.g. `gracefulShutdown` in start.ts) use these counts to
 * build a final verification summary and to decide whether to exit clean.
 */
export interface ShutdownExecutionsResult {
  /** Number of executions that were cleanly terminated. */
  terminated: number;
  /** Number of executions that failed to terminate (kill errored or timed out). */
  failed: number;
}

/**
 * Gracefully terminate all active hench executions on server shutdown.
 *
 * Iterates over all entries in `activeExecutions`, sends SIGTERM to each
 * managed child, and waits up to `gracePeriodMs` for them to exit.  Any
 * process that does not exit within the grace period receives SIGKILL.
 *
 * This must be called before the HTTP server closes so that child processes
 * are not orphaned.  The function resolves only after all processes have
 * been signalled and (best-effort) waited for.
 *
 * @param gracePeriodMs  How long to wait for each process to exit gracefully
 *                       before force-killing it.  Defaults to 5 000 ms.
 *                       Can be overridden via the `HENCH_SHUTDOWN_TIMEOUT_MS`
 *                       environment variable.
 * @returns Counts of terminated and failed executions for verification.
 */
export async function shutdownActiveExecutions(
  gracePeriodMs: number = Number(process.env["HENCH_SHUTDOWN_TIMEOUT_MS"] ?? 5_000),
): Promise<ShutdownExecutionsResult> {
  if (activeExecutions.size === 0) return { terminated: 0, failed: 0 };

  const count = activeExecutions.size;
  console.log(`[shutdown] terminating ${count} active execution(s)`);

  let terminated = 0;
  let failed = 0;

  const terminations = Array.from(activeExecutions.entries()).map(
    async ([taskId, entry]) => {
      const pid = entry.handle.pid;
      const pidInfo = pid != null ? ` (pid ${pid})` : "";
      try {
        await killWithFallback(entry.handle, gracePeriodMs);
        console.log(`[shutdown] execution ${taskId}${pidInfo} terminated`);
        terminated++;
      } catch (err) {
        const error = err as Error;
        console.error(`[shutdown] execution ${taskId}${pidInfo} failed to terminate: ${error.message}`);
        failed++;
      } finally {
        processMemoryTracker.markCompleted(taskId);
        executionMetrics.taskCompleted(taskId);
        activeExecutions.delete(taskId);
      }
    },
  );

  await Promise.all(terminations);

  if (failed === 0) {
    console.log(`[shutdown] all ${count} execution(s) terminated`);
  } else {
    console.error(`[shutdown] ${terminated}/${count} execution(s) terminated — ${failed} failed to exit`);
  }

  return { terminated, failed };
}

// ── Throttle controls ─────────────────────────────────────────────────

/**
 * GET /api/hench/throttle — return current throttle state.
 *
 * Includes the effective concurrency limit, pause state, and info
 * about the config-file default for UI comparison.
 */
function handleThrottleGet(res: ServerResponse, ctx: ServerContext): boolean {
  const config = loadHenchConfig(ctx.projectDir);
  const guard = config?.guard as Record<string, unknown> | undefined;
  const configMax = typeof guard?.maxConcurrentProcesses === "number"
    ? guard.maxConcurrentProcesses
    : DEFAULT_MAX_CONCURRENT_PROCESSES;

  const effective = throttleState.concurrencyOverride ?? configMax;

  jsonResponse(res, 200, {
    paused: throttleState.paused,
    pausedAt: throttleState.pausedAt,
    concurrencyOverride: throttleState.concurrencyOverride,
    effectiveMaxConcurrent: effective,
    configMaxConcurrent: configMax,
    lastEmergencyStopAt: throttleState.lastEmergencyStopAt,
    lastEmergencyStopCount: throttleState.lastEmergencyStopCount,
    activeExecutions: activeExecutions.size,
    timestamp: new Date().toISOString(),
  });
  return true;
}

/**
 * PUT /api/hench/throttle — adjust the runtime concurrency override.
 *
 * Body: { maxConcurrent: number | null }
 * Pass null to clear the override and revert to the config-file value.
 */
async function handleThrottleUpdate(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  broadcast?: WebSocketBroadcaster,
): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const value = body.maxConcurrent;
  if (value === null || value === undefined) {
    // Clear override — revert to config value
    throttleState.concurrencyOverride = null;
  } else if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20) {
    throttleState.concurrencyOverride = value;
  } else {
    errorResponse(res, 400, "maxConcurrent must be an integer between 1 and 20, or null to clear");
    return true;
  }

  // Broadcast updated concurrency status so the concurrency panel refreshes
  if (broadcast) {
    broadcastThrottleState(broadcast, ctx);
  }

  const effective = getEffectiveMaxConcurrent(ctx.projectDir);
  jsonResponse(res, 200, {
    ok: true,
    concurrencyOverride: throttleState.concurrencyOverride,
    effectiveMaxConcurrent: effective,
  });
  return true;
}

/**
 * POST /api/hench/throttle/pause — pause new task executions.
 *
 * Running executions continue but no new ones can be started.
 */
function handleThrottlePause(
  res: ServerResponse,
  broadcast?: WebSocketBroadcaster,
  ctx?: ServerContext,
): boolean {
  if (throttleState.paused) {
    errorResponse(res, 409, "Executions are already paused");
    return true;
  }

  throttleState.paused = true;
  throttleState.pausedAt = new Date().toISOString();

  if (broadcast && ctx) broadcastThrottleState(broadcast, ctx);

  jsonResponse(res, 200, {
    ok: true,
    paused: true,
    pausedAt: throttleState.pausedAt,
  });
  return true;
}

/**
 * POST /api/hench/throttle/resume — resume new task executions.
 */
function handleThrottleResume(
  res: ServerResponse,
  broadcast?: WebSocketBroadcaster,
  ctx?: ServerContext,
): boolean {
  if (!throttleState.paused) {
    errorResponse(res, 409, "Executions are not paused");
    return true;
  }

  throttleState.paused = false;
  throttleState.pausedAt = null;

  if (broadcast && ctx) broadcastThrottleState(broadcast, ctx);

  jsonResponse(res, 200, {
    ok: true,
    paused: false,
  });
  return true;
}

/**
 * POST /api/hench/throttle/emergency-stop — terminate all running executions.
 *
 * Sends SIGTERM to every active dashboard-managed execution and pauses new
 * ones. Body must include `{ confirm: true }` to prevent accidental use.
 */
async function handleEmergencyStop(
  req: IncomingMessage,
  res: ServerResponse,
  broadcast?: WebSocketBroadcaster,
  ctx?: ServerContext,
  onStatusInvalidate?: () => void,
): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  if (body.confirm !== true) {
    errorResponse(res, 400, "Emergency stop requires { confirm: true } in request body");
    return true;
  }

  const count = activeExecutions.size;

  if (count === 0) {
    jsonResponse(res, 200, {
      ok: true,
      terminated: 0,
      failed: 0,
      message: "No active executions to stop",
    });
    return true;
  }

  // Pause new executions automatically
  throttleState.paused = true;
  throttleState.pausedAt = new Date().toISOString();

  // Terminate all active executions
  console.log(`[emergency-stop] terminating ${count} active execution(s)`);

  let terminated = 0;
  let failed = 0;

  const terminations = Array.from(activeExecutions.entries()).map(
    async ([taskId, entry]) => {
      const pid = entry.handle.pid;
      const pidInfo = pid != null ? ` (pid ${pid})` : "";
      try {
        await killWithFallback(entry.handle, 3000);
        console.log(`[emergency-stop] execution ${taskId}${pidInfo} terminated`);
        terminated++;
      } catch (err) {
        const error = err as Error;
        console.error(`[emergency-stop] execution ${taskId}${pidInfo} failed: ${error.message}`);
        failed++;
      } finally {
        // Update state before removing
        entry.state.status = "failed";
        entry.state.finishedAt = new Date().toISOString();
        entry.state.error = "Terminated via emergency stop";
        broadcastExecState(broadcast, { ...entry.state });
        processMemoryTracker.markCompleted(taskId);
        executionMetrics.taskCompleted(taskId);
        activeExecutions.delete(taskId);
      }
    },
  );

  await Promise.all(terminations);

  throttleState.lastEmergencyStopAt = new Date().toISOString();
  throttleState.lastEmergencyStopCount = terminated + failed;

  if (broadcast && ctx) broadcastThrottleState(broadcast, ctx);
  onStatusInvalidate?.();

  jsonResponse(res, 200, {
    ok: true,
    terminated,
    failed,
    paused: true,
    message: `Emergency stop complete: ${terminated} terminated, ${failed} failed. New executions paused.`,
  });
  return true;
}

/**
 * Broadcast updated throttle state over WebSocket for real-time UI updates.
 */
function broadcastThrottleState(
  broadcast: WebSocketBroadcaster,
  ctx: ServerContext,
): void {
  const config = loadHenchConfig(ctx.projectDir);
  const guard = config?.guard as Record<string, unknown> | undefined;
  const configMax = typeof guard?.maxConcurrentProcesses === "number"
    ? guard.maxConcurrentProcesses
    : DEFAULT_MAX_CONCURRENT_PROCESSES;

  broadcast({
    type: "hench:throttle-state",
    paused: throttleState.paused,
    pausedAt: throttleState.pausedAt,
    concurrencyOverride: throttleState.concurrencyOverride,
    effectiveMaxConcurrent: throttleState.concurrencyOverride ?? configMax,
    configMaxConcurrent: configMax,
    lastEmergencyStopAt: throttleState.lastEmergencyStopAt,
    lastEmergencyStopCount: throttleState.lastEmergencyStopCount,
    activeExecutions: activeExecutions.size,
    timestamp: new Date().toISOString(),
  });
}
