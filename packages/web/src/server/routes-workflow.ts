/**
 * Workflow optimization API routes — analyze run history to generate
 * optimization suggestions with impact previews and tracking.
 *
 * All endpoints are under /api/hench/workflow/.
 *
 * GET    /api/hench/workflow/analysis          — full workflow analysis with suggestions
 * POST   /api/hench/workflow/suggestions/:id   — record decision (accept/reject/defer)
 * POST   /api/hench/workflow/apply             — apply config changes from a suggestion
 * GET    /api/hench/workflow/history            — suggestion decision history + stats
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { ServerContext } from "./types.js";
import { jsonResponse, errorResponse, readBody } from "./response-utils.js";

const WORKFLOW_PREFIX = "/api/hench/workflow/";

// ── Types (duplicated from hench to avoid runtime coupling) ──────────

type SuggestionCategory =
  | "token-efficiency"
  | "failure-prevention"
  | "turn-optimization"
  | "config-tuning"
  | "task-health";

type SuggestionPriority = "high" | "medium" | "low";

interface WorkflowSuggestion {
  id: string;
  category: SuggestionCategory;
  priority: SuggestionPriority;
  title: string;
  description: string;
  rationale: string;
  impact: string;
  configChanges?: Record<string, unknown>;
  affectedTaskIds?: string[];
  autoApplicable: boolean;
}

interface WorkflowStats {
  successRate: number;
  avgTurns: number;
  avgTokensPerRun: number;
  avgDurationMs: number;
  failuresByStatus: Record<string, number>;
  troubleTaskIds: string[];
  turnLimitHits: number;
  budgetExceededCount: number;
}

interface WorkflowAnalysis {
  totalRuns: number;
  timeRange: { earliest: string; latest: string } | null;
  stats: WorkflowStats;
  suggestions: WorkflowSuggestion[];
}

type SuggestionDecision = "accepted" | "rejected" | "deferred";

interface SuggestionRecord {
  suggestionId: string;
  title: string;
  category: string;
  decision: SuggestionDecision;
  decidedAt: string;
  appliedChanges?: Record<string, unknown>;
}

interface SuggestionHistory {
  records: SuggestionRecord[];
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
  retry?: { maxRetries?: number; baseDelayMs?: number; maxDelayMs?: number };
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

function loadSuggestionHistory(projectDir: string): SuggestionHistory {
  const path = join(projectDir, ".hench", "suggestions.json");
  try {
    if (!existsSync(path)) return { records: [] };
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.records)) return parsed as SuggestionHistory;
    return { records: [] };
  } catch {
    return { records: [] };
  }
}

function saveSuggestionHistory(projectDir: string, history: SuggestionHistory): void {
  writeFileSync(
    join(projectDir, ".hench", "suggestions.json"),
    JSON.stringify(history, null, 2) + "\n",
    "utf-8",
  );
}

// ── Analysis engine (self-contained — no imports from hench) ─────────

const FAILURE_STATUSES = new Set(["failed", "timeout", "budget_exceeded"]);

function totalTokens(run: RunData): number {
  return (run.tokenUsage.input ?? 0) + (run.tokenUsage.output ?? 0);
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function computeStats(runs: RunData[], config?: HenchConfigData | null): WorkflowStats {
  if (runs.length === 0) {
    return {
      successRate: 0, avgTurns: 0, avgTokensPerRun: 0, avgDurationMs: 0,
      failuresByStatus: {}, troubleTaskIds: [], turnLimitHits: 0, budgetExceededCount: 0,
    };
  }

  const completedCount = runs.filter((r) => r.status === "completed").length;
  const finishedRuns = runs.filter((r) => r.status !== "running");
  const successRate = finishedRuns.length > 0 ? completedCount / finishedRuns.length : 0;
  const avgTurns = runs.reduce((sum, r) => sum + r.turns, 0) / runs.length;
  const avgTokensPerRun = runs.map(totalTokens).reduce((a, b) => a + b, 0) / runs.length;

  const durations = runs
    .filter((r) => r.finishedAt)
    .map((r) => new Date(r.finishedAt!).getTime() - new Date(r.startedAt).getTime())
    .filter((d) => d > 0);
  const avgDurationMs = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

  const failuresByStatus: Record<string, number> = {};
  const taskFailures = new Map<string, number>();
  for (const run of runs) {
    if (FAILURE_STATUSES.has(run.status)) {
      failuresByStatus[run.status] = (failuresByStatus[run.status] ?? 0) + 1;
      taskFailures.set(run.taskId, (taskFailures.get(run.taskId) ?? 0) + 1);
    }
  }

  const troubleTaskIds = [...taskFailures.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => id);

  const maxTurns = config?.maxTurns ?? 50;
  const turnLimitHits = runs.filter((r) => r.turns >= maxTurns).length;
  const budgetExceededCount = runs.filter((r) => r.status === "budget_exceeded").length;

  return {
    successRate, avgTurns, avgTokensPerRun, avgDurationMs,
    failuresByStatus, troubleTaskIds, turnLimitHits, budgetExceededCount,
  };
}

let idCounter = 0;
function nextId(category: string): string {
  return `${category}-${++idCounter}`;
}

function generateSuggestions(
  runs: RunData[],
  stats: WorkflowStats,
  config?: HenchConfigData | null,
): WorkflowSuggestion[] {
  idCounter = 0;
  const suggestions: WorkflowSuggestion[] = [];

  // ── Token efficiency ──
  if (stats.avgTokensPerRun > 100000 && stats.successRate < 0.5) {
    suggestions.push({
      id: nextId("token-efficiency"),
      category: "token-efficiency",
      priority: "high",
      title: "High token consumption with low success rate",
      description: "Runs are consuming significant tokens but failing frequently. Consider reducing token budget to fail faster on hard tasks.",
      rationale: `Average ${Math.round(stats.avgTokensPerRun).toLocaleString()} tokens/run with only ${Math.round(stats.successRate * 100)}% success rate.`,
      impact: "Reduces wasted tokens on tasks that are unlikely to succeed.",
      configChanges: (config?.tokenBudget ?? 0) === 0
        ? { tokenBudget: Math.round(stats.avgTokensPerRun * 0.7) }
        : undefined,
      autoApplicable: (config?.tokenBudget ?? 0) === 0,
    });
  }

  const completedRuns = runs.filter((r) => r.status === "completed");
  if (completedRuns.length >= 3 && (config?.tokenBudget ?? 0) === 0) {
    const completedTokens = completedRuns.map(totalTokens);
    const medianTokens = median(completedTokens);
    if (medianTokens > 0) {
      const suggestedBudget = Math.round(medianTokens * 2);
      suggestions.push({
        id: nextId("token-efficiency"),
        category: "token-efficiency",
        priority: "low",
        title: "Set a token budget based on historical usage",
        description: `Successful runs use a median of ${medianTokens.toLocaleString()} tokens. A budget would cap runaway costs.`,
        rationale: `${completedRuns.length} completed runs analyzed. Median: ${medianTokens.toLocaleString()} tokens.`,
        impact: `Budget of ${suggestedBudget.toLocaleString()} (2x median) protects against unbounded runs.`,
        configChanges: { tokenBudget: suggestedBudget },
        autoApplicable: true,
      });
    }
  }

  // ── Failure prevention ──
  if ((stats.failuresByStatus["timeout"] ?? 0) >= 2) {
    const cnt = stats.failuresByStatus["timeout"];
    suggestions.push({
      id: nextId("failure-prevention"),
      category: "failure-prevention",
      priority: "high",
      title: "Recurring timeout failures",
      description: `${cnt} runs have timed out. Tasks may be too large or the turn limit too low.`,
      rationale: `${cnt} timeout failures out of ${runs.length} total runs.`,
      impact: "Increasing max turns or splitting tasks may improve completion rate.",
      configChanges: { maxTurns: 80 },
      autoApplicable: true,
    });
  }

  if ((stats.failuresByStatus["failed"] ?? 0) >= 3) {
    const cnt = stats.failuresByStatus["failed"];
    suggestions.push({
      id: nextId("failure-prevention"),
      category: "failure-prevention",
      priority: "medium",
      title: "Frequent task failures",
      description: `${cnt} runs have failed. Reviewing error patterns may reveal systemic issues.`,
      rationale: `${cnt} failures across ${runs.length} runs (${Math.round((cnt / runs.length) * 100)}% failure rate).`,
      impact: "Identifying root causes can prevent repeated failed attempts.",
      affectedTaskIds: stats.troubleTaskIds.slice(0, 5),
      autoApplicable: false,
    });
  }

  for (const taskId of stats.troubleTaskIds.slice(0, 3)) {
    const taskRuns = runs.filter((r) => r.taskId === taskId);
    const taskFailures = taskRuns.filter((r) => FAILURE_STATUSES.has(r.status));
    const taskErrors = taskRuns.filter((r) => r.error).map((r) => r.error!).slice(0, 3);

    if (taskFailures.length >= 3) {
      suggestions.push({
        id: nextId("failure-prevention"),
        category: "failure-prevention",
        priority: "high",
        title: `Task "${taskRuns[0]?.taskTitle ?? taskId}" is stuck`,
        description: `This task has failed ${taskFailures.length} times out of ${taskRuns.length} attempts.${taskErrors.length > 0 ? ` Recent errors: ${taskErrors[0]?.slice(0, 100)}` : ""}`,
        rationale: `${taskFailures.length} failures suggest the task may need manual review or scope reduction.`,
        impact: "Prevents further wasted runs on a blocked task.",
        affectedTaskIds: [taskId],
        autoApplicable: false,
      });
    }
  }

  // ── Turn optimization ──
  const maxTurns = config?.maxTurns ?? 50;
  if (stats.turnLimitHits >= 2 && runs.length >= 3) {
    const hitRate = stats.turnLimitHits / runs.length;
    if (hitRate > 0.3) {
      suggestions.push({
        id: nextId("turn-optimization"),
        category: "turn-optimization",
        priority: "high",
        title: "Turn limit reached frequently",
        description: `${stats.turnLimitHits} of ${runs.length} runs (${Math.round(hitRate * 100)}%) hit the ${maxTurns}-turn limit.`,
        rationale: `Turn limit hit rate is ${Math.round(hitRate * 100)}%.`,
        impact: `Increasing maxTurns to ${Math.min(maxTurns * 2, 100)} gives tasks more room to finish.`,
        configChanges: { maxTurns: Math.min(maxTurns * 2, 100) },
        autoApplicable: true,
      });
    }
  }

  if (completedRuns.length >= 5) {
    const turnUsages = completedRuns.map((r) => r.turns);
    const medianTurns = median(turnUsages);
    const p90Turns = [...turnUsages].sort((a, b) => a - b)[Math.floor(turnUsages.length * 0.9)];
    if (p90Turns !== undefined && p90Turns < maxTurns * 0.5 && maxTurns > 20) {
      suggestions.push({
        id: nextId("turn-optimization"),
        category: "turn-optimization",
        priority: "low",
        title: "Turn limit is much higher than needed",
        description: `Successful runs use a median of ${medianTurns} turns, but the limit is ${maxTurns}.`,
        rationale: `P90 turn usage is ${p90Turns}, well below the ${maxTurns} limit.`,
        impact: `Setting maxTurns to ${Math.max(Math.round(p90Turns * 1.5), 20)} covers 90% of successful runs.`,
        configChanges: { maxTurns: Math.max(Math.round(p90Turns * 1.5), 20) },
        autoApplicable: true,
      });
    }
  }

  // ── Config tuning ──
  const transientErrors = runs.filter((r) => r.status === "error_transient");
  const maxRetries = config?.retry?.maxRetries ?? 3;
  if (transientErrors.length >= 3 && maxRetries < 5) {
    suggestions.push({
      id: nextId("config-tuning"),
      category: "config-tuning",
      priority: "medium",
      title: "Increase retry count for transient errors",
      description: `${transientErrors.length} runs ended with transient errors. Higher retry count may recover more.`,
      rationale: `Current max retries: ${maxRetries}. ${transientErrors.length} transient errors suggest API instability.`,
      impact: "More retries can recover from temporary API issues without manual intervention.",
      configChanges: { "retry.maxRetries": 5 },
      autoApplicable: true,
    });
  }

  // ── Task health ──
  const taskRunCounts = new Map<string, { count: number; title: string }>();
  for (const run of runs) {
    const entry = taskRunCounts.get(run.taskId) ?? { count: 0, title: run.taskTitle };
    entry.count++;
    taskRunCounts.set(run.taskId, entry);
  }

  for (const [taskId, info] of [...taskRunCounts.entries()]
    .filter(([, i]) => i.count >= 5)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)) {
    suggestions.push({
      id: nextId("task-health"),
      category: "task-health",
      priority: "medium",
      title: `Task "${info.title}" has been run ${info.count} times`,
      description: `This task has been attempted ${info.count} times. It may need to be broken into smaller subtasks.`,
      rationale: `${info.count} runs for a single task indicates scope or complexity issues.`,
      impact: "Splitting or clarifying the task will improve success rate.",
      affectedTaskIds: [taskId],
      autoApplicable: false,
    });
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  suggestions.sort((a, b) => (priorityOrder[a.priority] ?? 2) - (priorityOrder[b.priority] ?? 2));

  return suggestions;
}

function analyzeWorkflow(
  runs: RunData[],
  config?: HenchConfigData | null,
): WorkflowAnalysis {
  if (runs.length === 0) {
    return { totalRuns: 0, timeRange: null, stats: computeStats([]), suggestions: [] };
  }

  const stats = computeStats(runs, config);
  const sorted = [...runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const timeRange = {
    earliest: sorted[0].startedAt,
    latest: sorted[sorted.length - 1].startedAt,
  };

  return {
    totalRuns: runs.length,
    timeRange,
    stats,
    suggestions: generateSuggestions(runs, stats, config),
  };
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

/** Handle workflow optimization API requests. Returns true if handled. */
export function handleWorkflowRoute(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
): boolean | Promise<boolean> {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (!url.startsWith(WORKFLOW_PREFIX)) return false;

  const fullPath = url.slice(WORKFLOW_PREFIX.length);
  const qIdx = fullPath.indexOf("?");
  const path = qIdx === -1 ? fullPath : fullPath.slice(0, qIdx);

  // GET /api/hench/workflow/analysis — full analysis with suggestions
  if (path === "analysis" && method === "GET") {
    const runs = loadRuns(ctx.projectDir);
    const config = loadConfig(ctx.projectDir);
    const analysis = analyzeWorkflow(runs, config);
    const history = loadSuggestionHistory(ctx.projectDir);

    // Compute decision stats
    const historyStats = {
      total: history.records.length,
      accepted: history.records.filter((r) => r.decision === "accepted").length,
      rejected: history.records.filter((r) => r.decision === "rejected").length,
      deferred: history.records.filter((r) => r.decision === "deferred").length,
    };

    jsonResponse(res, 200, { ...analysis, decisionHistory: historyStats });
    return true;
  }

  // POST /api/hench/workflow/suggestions/:id — record decision on a suggestion
  const decisionMatch = path.match(/^suggestions\/([a-z0-9-]+)$/);
  if (decisionMatch && method === "POST") {
    return handleSuggestionDecision(req, res, ctx, decisionMatch[1]);
  }

  // POST /api/hench/workflow/apply — apply config changes from a suggestion
  if (path === "apply" && method === "POST") {
    return handleApplySuggestion(req, res, ctx);
  }

  // GET /api/hench/workflow/history — decision history and stats
  if (path === "history" && method === "GET") {
    const history = loadSuggestionHistory(ctx.projectDir);
    const total = history.records.length;
    const accepted = history.records.filter((r) => r.decision === "accepted").length;
    const rejected = history.records.filter((r) => r.decision === "rejected").length;
    const deferred = history.records.filter((r) => r.decision === "deferred").length;

    const byCategory: Record<string, Record<string, number>> = {};
    for (const record of history.records) {
      const cat = byCategory[record.category] ?? { accepted: 0, rejected: 0, deferred: 0 };
      cat[record.decision] = (cat[record.decision] ?? 0) + 1;
      byCategory[record.category] = cat;
    }

    jsonResponse(res, 200, {
      records: history.records,
      stats: {
        total,
        accepted,
        rejected,
        deferred,
        acceptanceRate: total > 0 ? accepted / total : 0,
        byCategory,
      },
    });
    return true;
  }

  return false;
}

async function handleSuggestionDecision(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: ServerContext,
  suggestionId: string,
): Promise<boolean> {
  let body: Record<string, unknown>;
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    errorResponse(res, 400, "Invalid JSON in request body");
    return true;
  }

  const decision = body.decision as string;
  if (!decision || !["accepted", "rejected", "deferred"].includes(decision)) {
    errorResponse(res, 400, "Decision must be 'accepted', 'rejected', or 'deferred'");
    return true;
  }

  const title = (body.title as string) || suggestionId;
  const category = (body.category as string) || "unknown";

  const record: SuggestionRecord = {
    suggestionId,
    title,
    category,
    decision: decision as SuggestionDecision,
    decidedAt: new Date().toISOString(),
    appliedChanges: body.appliedChanges as Record<string, unknown> | undefined,
  };

  const history = loadSuggestionHistory(ctx.projectDir);
  history.records.push(record);

  try {
    saveSuggestionHistory(ctx.projectDir, history);
  } catch (err) {
    errorResponse(res, 500, `Failed to save decision: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  jsonResponse(res, 200, { ok: true, record });
  return true;
}

async function handleApplySuggestion(
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

  const changes = body.changes as Record<string, unknown> | undefined;
  if (!changes || typeof changes !== "object" || Object.keys(changes).length === 0) {
    errorResponse(res, 400, "Request must include a 'changes' object with config path/value pairs");
    return true;
  }

  // Preview mode: show what would change without applying
  const preview = body.preview === true;

  const configPath = join(ctx.projectDir, ".hench", "config.json");
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
  } catch {
    errorResponse(res, 404, "Hench configuration not found. Run 'hench init' first.");
    return true;
  }

  // Build the preview diff
  const diff: Array<{ path: string; oldValue: unknown; newValue: unknown }> = [];
  for (const [key, newValue] of Object.entries(changes)) {
    const oldValue = getNestedValue(config, key);
    diff.push({ path: key, oldValue, newValue });
  }

  if (preview) {
    jsonResponse(res, 200, { preview: true, diff });
    return true;
  }

  // Apply changes
  for (const [key, value] of Object.entries(changes)) {
    setNestedValue(config, key, value);
  }

  try {
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (err) {
    errorResponse(res, 500, `Failed to write config: ${err instanceof Error ? err.message : String(err)}`);
    return true;
  }

  // Record the acceptance
  const suggestionId = body.suggestionId as string;
  const title = (body.title as string) || "Applied suggestion";
  const category = (body.category as string) || "unknown";

  if (suggestionId) {
    const history = loadSuggestionHistory(ctx.projectDir);
    history.records.push({
      suggestionId,
      title,
      category,
      decision: "accepted",
      decidedAt: new Date().toISOString(),
      appliedChanges: changes,
    });
    try {
      saveSuggestionHistory(ctx.projectDir, history);
    } catch {
      // Non-fatal — config was already written
    }
  }

  jsonResponse(res, 200, { ok: true, diff, config });
  return true;
}
