/**
 * Adaptive workflow adjustment API routes — monitor project evolution
 * and automatically adjust workflow parameters.
 *
 * All endpoints are under /api/hench/adaptive/.
 *
 * GET    /api/hench/adaptive/analysis       — full adaptive analysis with metrics and adjustments
 * GET    /api/hench/adaptive/settings       — current adaptive settings
 * POST   /api/hench/adaptive/settings       — update adaptive settings (enable/disable, window, locks)
 * POST   /api/hench/adaptive/apply          — apply an adjustment (auto or manual)
 * POST   /api/hench/adaptive/dismiss/:id    — dismiss a recommended adjustment
 * POST   /api/hench/adaptive/lock/:key      — lock a config key from auto-adjustment
 * POST   /api/hench/adaptive/unlock/:key    — unlock a config key for auto-adjustment
 * POST   /api/hench/adaptive/override       — set a manual override for a config key
 * DELETE /api/hench/adaptive/override/:key   — remove a manual override
 * GET    /api/hench/adaptive/history        — adjustment history + stats
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

const ADAPTIVE_PREFIX = "/api/hench/adaptive/";

// ── Types (self-contained — no imports from hench) ───────────────────

type AdjustmentCategory =
  | "complexity-scaling"
  | "velocity-tracking"
  | "codebase-growth"
  | "efficiency-tuning"
  | "resource-scaling";

type AdjustmentPriority = "high" | "medium" | "low";

interface ProjectMetrics {
  timestamp: string;
  totalRuns: number;
  recentSuccessRate: number;
  recentAvgTurns: number;
  recentAvgTokens: number;
  recentAvgDurationMs: number;
  recentTaskCount: number;
  runsPerDay: number;
  successRateTrend: number;
  tokenUsageTrend: number;
}

interface WorkflowAdjustment {
  id: string;
  category: AdjustmentCategory;
  priority: AdjustmentPriority;
  title: string;
  description: string;
  rationale: string;
  configChanges: Record<string, unknown>;
  autoApplicable: boolean;
  currentValue: unknown;
  proposedValue: unknown;
  configKey: string;
}

interface AdjustmentNotification {
  id: string;
  timestamp: string;
  type: "auto-applied" | "recommended";
  adjustment: WorkflowAdjustment;
  reason: string;
}

interface AdaptiveSettings {
  enabled: boolean;
  windowSize: number;
  minRunsRequired: number;
  lockedKeys: string[];
}

interface AdjustmentRecord {
  adjustmentId: string;
  title: string;
  category: string;
  configKey: string;
  decision: "applied" | "dismissed" | "overridden";
  previousValue?: unknown;
  newValue?: unknown;
  automatic: boolean;
  timestamp: string;
}

interface AdaptiveState {
  settings: AdaptiveSettings;
  history: AdjustmentRecord[];
  overrides: Record<string, unknown>;
}

interface RunData {
  id: string;
  taskId: string;
  taskTitle: string;
  startedAt: string;
  finishedAt?: string;
  status: string;
  turns: number;
  error?: string;
  tokenUsage: { input: number; output: number; cacheCreationInput?: number; cacheReadInput?: number };
  toolCalls: unknown[];
  model: string;
  retryAttempts?: number;
}

interface HenchConfigData {
  maxTurns?: number;
  maxTokens?: number;
  tokenBudget?: number;
  maxFailedAttempts?: number;
  loopPauseMs?: number;
  retry?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number };
  guard?: { commandTimeout?: number; blockedPaths?: string[]; allowedCommands?: string[]; maxFileSize?: number };
}

// ── Data loading helpers ─────────────────────────────────────────────

function loadRuns(projectDir: string): RunData[] {
  const runsDir = join(projectDir, ".hench", "runs");
  let files: string[];
  try {
    files = readdirSync(runsDir);
  } catch {
    return [];
  }

  const runs: RunData[] = [];
  for (const file of files.filter((f) => f.endsWith(".json"))) {
    try {
      const raw = readFileSync(join(runsDir, file), "utf-8");
      const data = JSON.parse(raw) as RunData;
      if (data.id && data.startedAt) {
        runs.push(data);
      }
    } catch {
      // skip invalid files
    }
  }

  return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function loadConfig(projectDir: string): HenchConfigData | null {
  try {
    const raw = readFileSync(join(projectDir, ".hench", "config.json"), "utf-8");
    return JSON.parse(raw) as HenchConfigData;
  } catch {
    return null;
  }
}

function defaultSettings(): AdaptiveSettings {
  return {
    enabled: true,
    windowSize: 20,
    minRunsRequired: 5,
    lockedKeys: [],
  };
}

function loadAdaptiveState(projectDir: string): AdaptiveState {
  const path = join(projectDir, ".hench", "adaptive.json");
  try {
    if (!existsSync(path)) return { settings: defaultSettings(), history: [], overrides: {} };
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return {
        settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
        history: Array.isArray(parsed.history) ? parsed.history : [],
        overrides: (parsed.overrides && typeof parsed.overrides === "object") ? parsed.overrides : {},
      };
    }
    return { settings: defaultSettings(), history: [], overrides: {} };
  } catch {
    return { settings: defaultSettings(), history: [], overrides: {} };
  }
}

function saveAdaptiveState(projectDir: string, state: AdaptiveState): void {
  writeFileSync(
    join(projectDir, ".hench", "adaptive.json"),
    JSON.stringify(state, null, 2) + "\n",
    "utf-8",
  );
}

// ── Analysis engine (self-contained) ─────────────────────────────────

const FAILURE_STATUSES = new Set(["failed", "timeout", "budget_exceeded"]);

function totalTokens(run: RunData): number {
  return (run.tokenUsage.input ?? 0) + (run.tokenUsage.output ?? 0);
}

function runDurationMs(run: RunData): number {
  if (!run.finishedAt) return 0;
  return new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
}

function collectMetrics(runs: RunData[], windowSize: number = 20): ProjectMetrics {
  const now = new Date().toISOString();

  if (runs.length === 0) {
    return {
      timestamp: now, totalRuns: 0, recentSuccessRate: 0, recentAvgTurns: 0,
      recentAvgTokens: 0, recentAvgDurationMs: 0, recentTaskCount: 0,
      runsPerDay: 0, successRateTrend: 0, tokenUsageTrend: 0,
    };
  }

  const sorted = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  const recent = sorted.slice(0, windowSize);
  const finished = recent.filter((r) => r.status !== "running");
  const completed = finished.filter((r) => r.status === "completed");

  const recentSuccessRate = finished.length > 0 ? completed.length / finished.length : 0;
  const recentAvgTurns = recent.length > 0 ? recent.reduce((s, r) => s + r.turns, 0) / recent.length : 0;
  const recentAvgTokens = recent.length > 0 ? recent.map(totalTokens).reduce((a, b) => a + b, 0) / recent.length : 0;

  const durations = recent.map(runDurationMs).filter((d) => d > 0);
  const recentAvgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  const recentTaskCount = new Set(recent.map((r) => r.taskId)).size;

  let runsPerDay = 0;
  if (recent.length >= 2) {
    const oldest = new Date(recent[recent.length - 1].startedAt).getTime();
    const newest = new Date(recent[0].startedAt).getTime();
    const daySpan = (newest - oldest) / (1000 * 60 * 60 * 24);
    runsPerDay = daySpan > 0 ? recent.length / daySpan : 0;
  }

  const halfSize = Math.floor(recent.length / 2);
  let successRateTrend = 0;
  let tokenUsageTrend = 0;

  if (halfSize >= 2) {
    const newerHalf = recent.slice(0, halfSize);
    const olderHalf = recent.slice(halfSize);

    const newerFinished = newerHalf.filter((r) => r.status !== "running");
    const olderFinished = olderHalf.filter((r) => r.status !== "running");

    const newerRate = newerFinished.length > 0
      ? newerFinished.filter((r) => r.status === "completed").length / newerFinished.length : 0;
    const olderRate = olderFinished.length > 0
      ? olderFinished.filter((r) => r.status === "completed").length / olderFinished.length : 0;
    successRateTrend = newerRate - olderRate;

    const newerTokens = newerHalf.length > 0
      ? newerHalf.map(totalTokens).reduce((a, b) => a + b, 0) / newerHalf.length : 0;
    const olderTokens = olderHalf.length > 0
      ? olderHalf.map(totalTokens).reduce((a, b) => a + b, 0) / olderHalf.length : 0;
    tokenUsageTrend = olderTokens > 0 ? (newerTokens - olderTokens) / olderTokens : 0;
  }

  return {
    timestamp: now, totalRuns: runs.length, recentSuccessRate, recentAvgTurns,
    recentAvgTokens, recentAvgDurationMs, recentTaskCount, runsPerDay,
    successRateTrend, tokenUsageTrend,
  };
}

let idCounter = 0;
function nextId(category: string): string {
  return `adj-${category}-${++idCounter}`;
}

function generateAdjustments(
  metrics: ProjectMetrics,
  config: HenchConfigData,
  settings: AdaptiveSettings,
): WorkflowAdjustment[] {
  idCounter = 0;
  const adjustments: WorkflowAdjustment[] = [];
  const maxTurns = config.maxTurns ?? 50;
  const tokenBudget = config.tokenBudget ?? 0;
  const loopPauseMs = config.loopPauseMs ?? 2000;
  const maxFailedAttempts = config.maxFailedAttempts ?? 3;
  const maxRetries = config.retry?.maxRetries ?? 3;
  const commandTimeout = config.guard?.commandTimeout ?? 30000;

  // ── Complexity scaling ──
  if (
    metrics.recentAvgTurns > maxTurns * 0.7 &&
    metrics.recentSuccessRate < 0.7 &&
    !settings.lockedKeys.includes("maxTurns")
  ) {
    const proposed = Math.min(Math.round(metrics.recentAvgTurns * 1.5), 100);
    if (proposed > maxTurns) {
      adjustments.push({
        id: nextId("complexity-scaling"),
        category: "complexity-scaling",
        priority: "high",
        title: "Scale up turn limit for increasing task complexity",
        description: `Recent tasks average ${Math.round(metrics.recentAvgTurns)} turns (${Math.round((metrics.recentAvgTurns / maxTurns) * 100)}% of limit). Scaling up to accommodate growing complexity.`,
        rationale: `Average turn usage at ${Math.round((metrics.recentAvgTurns / maxTurns) * 100)}% of limit with ${Math.round(metrics.recentSuccessRate * 100)}% success rate.`,
        configChanges: { maxTurns: proposed },
        autoApplicable: true,
        currentValue: maxTurns,
        proposedValue: proposed,
        configKey: "maxTurns",
      });
    }
  }

  if (
    metrics.tokenUsageTrend > 0.2 &&
    metrics.successRateTrend < -0.1 &&
    tokenBudget > 0 &&
    !settings.lockedKeys.includes("tokenBudget")
  ) {
    const proposed = Math.round(tokenBudget * 1.3);
    adjustments.push({
      id: nextId("complexity-scaling"),
      category: "complexity-scaling",
      priority: "medium",
      title: "Increase token budget for growing task complexity",
      description: `Token usage trending up ${Math.round(metrics.tokenUsageTrend * 100)}% while success rate is declining.`,
      rationale: `Token consumption increasing ${Math.round(metrics.tokenUsageTrend * 100)}% with success rate dropping.`,
      configChanges: { tokenBudget: proposed },
      autoApplicable: true,
      currentValue: tokenBudget,
      proposedValue: proposed,
      configKey: "tokenBudget",
    });
  }

  // ── Velocity tracking ──
  if (
    metrics.runsPerDay > 5 &&
    metrics.recentSuccessRate > 0.85 &&
    metrics.recentAvgTurns < maxTurns * 0.4 &&
    maxTurns > 20 &&
    !settings.lockedKeys.includes("maxTurns")
  ) {
    const proposed = Math.max(Math.round(metrics.recentAvgTurns * 2), 20);
    if (proposed < maxTurns) {
      adjustments.push({
        id: nextId("velocity-tracking"),
        category: "velocity-tracking",
        priority: "low",
        title: "Optimize turn limit for high-velocity workflow",
        description: `Running ${metrics.runsPerDay.toFixed(1)} tasks/day with ${Math.round(metrics.recentSuccessRate * 100)}% success. Lowering the limit saves tokens on outliers.`,
        rationale: `High velocity with strong success allows tighter limits.`,
        configChanges: { maxTurns: proposed },
        autoApplicable: true,
        currentValue: maxTurns,
        proposedValue: proposed,
        configKey: "maxTurns",
      });
    }
  }

  if (
    metrics.runsPerDay < 1 &&
    metrics.recentSuccessRate < 0.5 &&
    metrics.totalRuns >= 5 &&
    maxFailedAttempts <= 3 &&
    !settings.lockedKeys.includes("maxFailedAttempts")
  ) {
    adjustments.push({
      id: nextId("velocity-tracking"),
      category: "velocity-tracking",
      priority: "medium",
      title: "Increase failure tolerance for low-velocity projects",
      description: `With only ${metrics.runsPerDay.toFixed(1)} runs/day, increasing the failure threshold gives tasks more chances.`,
      rationale: `Low velocity means each run is valuable. Current ${maxFailedAttempts} attempt limit may be too aggressive.`,
      configChanges: { maxFailedAttempts: 5 },
      autoApplicable: true,
      currentValue: maxFailedAttempts,
      proposedValue: 5,
      configKey: "maxFailedAttempts",
    });
  }

  // ── Efficiency tuning ──
  if (
    metrics.successRateTrend < -0.15 &&
    loopPauseMs > 1000 &&
    !settings.lockedKeys.includes("loopPauseMs")
  ) {
    const proposed = Math.max(Math.round(loopPauseMs * 0.5), 500);
    adjustments.push({
      id: nextId("efficiency-tuning"),
      category: "efficiency-tuning",
      priority: "low",
      title: "Reduce loop pause for faster iteration",
      description: `Success rate declining — faster iteration helps the agent recover more quickly.`,
      rationale: `Declining success trend (${Math.round(metrics.successRateTrend * 100)}%).`,
      configChanges: { loopPauseMs: proposed },
      autoApplicable: true,
      currentValue: loopPauseMs,
      proposedValue: proposed,
      configKey: "loopPauseMs",
    });
  }

  if (
    tokenBudget > 0 &&
    metrics.recentAvgTokens > 0 &&
    metrics.recentAvgTokens < tokenBudget * 0.3 &&
    metrics.recentSuccessRate > 0.7 &&
    !settings.lockedKeys.includes("tokenBudget")
  ) {
    const proposed = Math.round(metrics.recentAvgTokens * 2.5);
    if (proposed < tokenBudget) {
      adjustments.push({
        id: nextId("efficiency-tuning"),
        category: "efficiency-tuning",
        priority: "low",
        title: "Tighten token budget based on actual usage",
        description: `Runs average ${Math.round(metrics.recentAvgTokens).toLocaleString()} tokens, well below the ${tokenBudget.toLocaleString()} budget.`,
        rationale: `Average usage is ${Math.round((metrics.recentAvgTokens / tokenBudget) * 100)}% of budget with ${Math.round(metrics.recentSuccessRate * 100)}% success.`,
        configChanges: { tokenBudget: proposed },
        autoApplicable: true,
        currentValue: tokenBudget,
        proposedValue: proposed,
        configKey: "tokenBudget",
      });
    }
  }

  // ── Resource scaling ──
  if (
    metrics.runsPerDay > 10 &&
    maxRetries < 5 &&
    !settings.lockedKeys.includes("retry.maxRetries")
  ) {
    adjustments.push({
      id: nextId("resource-scaling"),
      category: "resource-scaling",
      priority: "medium",
      title: "Increase retries for high-volume workflow",
      description: `Running ${metrics.runsPerDay.toFixed(1)} tasks/day — more retries improves resilience.`,
      rationale: `High volume means transient errors are more likely.`,
      configChanges: { "retry.maxRetries": 5 },
      autoApplicable: true,
      currentValue: maxRetries,
      proposedValue: 5,
      configKey: "retry.maxRetries",
    });
  }

  if (
    metrics.recentAvgDurationMs > 5 * 60 * 1000 &&
    commandTimeout < 60000 &&
    !settings.lockedKeys.includes("guard.commandTimeout")
  ) {
    adjustments.push({
      id: nextId("resource-scaling"),
      category: "resource-scaling",
      priority: "medium",
      title: "Increase command timeout for long-running tasks",
      description: `Average task duration is ${Math.round(metrics.recentAvgDurationMs / 60000)} minutes — commands may need more time.`,
      rationale: `Tasks averaging ${Math.round(metrics.recentAvgDurationMs / 60000)}min may exceed the ${commandTimeout / 1000}s command timeout.`,
      configChanges: { "guard.commandTimeout": 60000 },
      autoApplicable: true,
      currentValue: commandTimeout,
      proposedValue: 60000,
      configKey: "guard.commandTimeout",
    });
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  adjustments.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return adjustments;
}

// ── Config mutation helpers ──────────────────────────────────────────

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

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

// ── Route handler ────────────────────────────────────────────────────

/** Handle adaptive workflow adjustment API requests. Returns true if handled. */
export function handleAdaptiveRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(ADAPTIVE_PREFIX)) return false;

  const fullPath = url.slice(ADAPTIVE_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  // GET /api/hench/adaptive/analysis — full adaptive analysis
  if (path === "analysis" && method === "GET") {
    const runs = loadRuns(ctx.projectDir);
    const config = loadConfig(ctx.projectDir);
    const state = loadAdaptiveState(ctx.projectDir);

    if (!config) {
      jsonResponse(res, 200, {
        metrics: collectMetrics([]),
        adjustments: [],
        notifications: [],
        settings: state.settings,
      });
      return true;
    }

    const metrics = collectMetrics(runs, state.settings.windowSize);

    let adjustments: WorkflowAdjustment[] = [];
    if (runs.length >= state.settings.minRunsRequired) {
      adjustments = generateAdjustments(metrics, config, state.settings);
    }

    const now = new Date().toISOString();
    const notifications: AdjustmentNotification[] = adjustments.map((adj) => ({
      id: `notif-${adj.id}`,
      timestamp: now,
      type: state.settings.enabled && adj.autoApplicable ? "auto-applied" as const : "recommended" as const,
      adjustment: adj,
      reason: adj.rationale,
    }));

    jsonResponse(res, 200, {
      metrics,
      adjustments,
      notifications,
      settings: state.settings,
    });
    return true;
  }

  // GET /api/hench/adaptive/settings — current settings
  if (path === "settings" && method === "GET") {
    const state = loadAdaptiveState(ctx.projectDir);
    jsonResponse(res, 200, {
      settings: state.settings,
      overrides: state.overrides,
    });
    return true;
  }

  // POST /api/hench/adaptive/settings — update settings
  if (path === "settings" && method === "POST") {
    return handleUpdateSettings(req, res, ctx);
  }

  // POST /api/hench/adaptive/apply — apply an adjustment
  if (path === "apply" && method === "POST") {
    return handleApplyAdjustment(req, res, ctx);
  }

  // POST /api/hench/adaptive/dismiss/:id — dismiss a recommended adjustment
  const dismissMatch = path.match(/^dismiss\/([a-z0-9-]+)$/);
  if (dismissMatch && method === "POST") {
    return handleDismissAdjustment(req, res, ctx, dismissMatch[1]);
  }

  // POST /api/hench/adaptive/lock/:key — lock a config key
  const lockMatch = path.match(/^lock\/(.+)$/);
  if (lockMatch && method === "POST") {
    const key = decodeURIComponent(lockMatch[1]);
    const state = loadAdaptiveState(ctx.projectDir);
    if (!state.settings.lockedKeys.includes(key)) {
      state.settings.lockedKeys.push(key);
    }
    saveAdaptiveState(ctx.projectDir, state);
    jsonResponse(res, 200, { ok: true, lockedKeys: state.settings.lockedKeys });
    return true;
  }

  // POST /api/hench/adaptive/unlock/:key — unlock a config key
  const unlockMatch = path.match(/^unlock\/(.+)$/);
  if (unlockMatch && method === "POST") {
    const key = decodeURIComponent(unlockMatch[1]);
    const state = loadAdaptiveState(ctx.projectDir);
    state.settings.lockedKeys = state.settings.lockedKeys.filter((k) => k !== key);
    saveAdaptiveState(ctx.projectDir, state);
    jsonResponse(res, 200, { ok: true, lockedKeys: state.settings.lockedKeys });
    return true;
  }

  // POST /api/hench/adaptive/override — set a manual override
  if (path === "override" && method === "POST") {
    return handleSetOverride(req, res, ctx);
  }

  // DELETE /api/hench/adaptive/override/:key — remove a manual override
  const overrideMatch = path.match(/^override\/(.+)$/);
  if (overrideMatch && method === "DELETE") {
    const key = decodeURIComponent(overrideMatch[1]);
    const state = loadAdaptiveState(ctx.projectDir);
    delete state.overrides[key];
    state.settings.lockedKeys = state.settings.lockedKeys.filter((k) => k !== key);
    saveAdaptiveState(ctx.projectDir, state);
    jsonResponse(res, 200, { ok: true, overrides: state.overrides });
    return true;
  }

  // GET /api/hench/adaptive/history — adjustment history and stats
  if (path === "history" && method === "GET") {
    const state = loadAdaptiveState(ctx.projectDir);
    const { history } = state;
    const total = history.length;
    const applied = history.filter((r) => r.decision === "applied").length;
    const dismissed = history.filter((r) => r.decision === "dismissed").length;
    const overridden = history.filter((r) => r.decision === "overridden").length;
    const automatic = history.filter((r) => r.automatic).length;

    const byCategory: Record<string, Record<string, number>> = {};
    for (const record of history) {
      const cat = byCategory[record.category] ?? { applied: 0, dismissed: 0, overridden: 0 };
      cat[record.decision] = (cat[record.decision] ?? 0) + 1;
      byCategory[record.category] = cat;
    }

    jsonResponse(res, 200, {
      records: history,
      stats: { total, applied, dismissed, overridden, automatic, manual: total - automatic, byCategory },
    });
    return true;
  }

  return false;
}

// ── Subroute handlers ────────────────────────────────────────────────

async function handleUpdateSettings(
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

  const state = loadAdaptiveState(ctx.projectDir);

  if (typeof body.enabled === "boolean") {
    state.settings.enabled = body.enabled;
  }
  if (typeof body.windowSize === "number" && body.windowSize >= 5 && body.windowSize <= 100) {
    state.settings.windowSize = body.windowSize;
  }
  if (typeof body.minRunsRequired === "number" && body.minRunsRequired >= 1 && body.minRunsRequired <= 50) {
    state.settings.minRunsRequired = body.minRunsRequired;
  }
  if (Array.isArray(body.lockedKeys)) {
    state.settings.lockedKeys = body.lockedKeys.filter((k): k is string => typeof k === "string");
  }

  try {
    saveAdaptiveState(ctx.projectDir, state);
  } catch (err) {
    errorResponse(res, 500, `Failed to save settings: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, { ok: true, settings: state.settings });
  return true;
}

async function handleApplyAdjustment(
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

  const adjustmentId = body.adjustmentId as string;
  const configKey = body.configKey as string;
  const newValue = body.newValue;
  const title = (body.title as string) || "Manual adjustment";
  const category = (body.category as string) || "unknown";
  const automatic = body.automatic === true;

  if (!configKey || newValue === undefined) {
    errorResponse(res, 400, "Request must include 'configKey' and 'newValue'");
    return true;
  }

  // Read and modify config
  const configPath = join(ctx.projectDir, ".hench", "config.json");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    errorResponse(res, 404, "Hench configuration not found. Run 'hench init' first.");
    return true;
  }

  const previousValue = getNestedValue(config, configKey);
  setNestedValue(config, configKey, newValue);

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  // Record the adjustment
  const state = loadAdaptiveState(ctx.projectDir);
  state.history.push({
    adjustmentId: adjustmentId || `manual-${Date.now()}`,
    title,
    category,
    configKey,
    decision: "applied",
    previousValue,
    newValue,
    automatic,
    timestamp: new Date().toISOString(),
  });

  try {
    saveAdaptiveState(ctx.projectDir, state);
  } catch {
    // Non-fatal — config was already written
  }

  jsonResponse(res, 200, {
    ok: true,
    configKey,
    previousValue,
    newValue,
  });
  return true;
}

async function handleDismissAdjustment(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  adjustmentId: string,
): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const title = (body.title as string) || adjustmentId;
  const category = (body.category as string) || "unknown";
  const configKey = (body.configKey as string) || "unknown";

  const state = loadAdaptiveState(ctx.projectDir);
  state.history.push({
    adjustmentId,
    title,
    category,
    configKey,
    decision: "dismissed",
    automatic: false,
    timestamp: new Date().toISOString(),
  });

  try {
    saveAdaptiveState(ctx.projectDir, state);
  } catch (err) {
    errorResponse(res, 500, `Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, { ok: true, adjustmentId });
  return true;
}

async function handleSetOverride(
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

  const key = body.key as string;
  const value = body.value;

  if (!key || value === undefined) {
    errorResponse(res, 400, "Request must include 'key' and 'value'");
    return true;
  }

  const state = loadAdaptiveState(ctx.projectDir);
  state.overrides[key] = value;
  if (!state.settings.lockedKeys.includes(key)) {
    state.settings.lockedKeys.push(key);
  }

  // Also apply the override to the actual config
  const configPath = join(ctx.projectDir, ".hench", "config.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    const previousValue = getNestedValue(config, key);
    setNestedValue(config, key, value);
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

    state.history.push({
      adjustmentId: `override-${Date.now()}`,
      title: `Manual override: ${key}`,
      category: "manual",
      configKey: key,
      decision: "overridden",
      previousValue,
      newValue: value,
      automatic: false,
      timestamp: new Date().toISOString(),
    });
  } catch {
    // Config write failed — still save override state
  }

  try {
    saveAdaptiveState(ctx.projectDir, state);
  } catch (err) {
    errorResponse(res, 500, `Failed to save: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, { ok: true, overrides: state.overrides, lockedKeys: state.settings.lockedKeys });
  return true;
}
