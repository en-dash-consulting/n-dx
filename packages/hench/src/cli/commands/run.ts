import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveStore, findNextTask, findActionableTasks as findActionable, findItem, collectCompletedIds, isRootLevel, isWorkItem, SCHEMA_VERSION } from "../../prd/rex-gateway.js";
import type { PRDItem, PRDStore } from "../../prd/rex-gateway.js";
import type { RunRecord, ToolCallRecord } from "../../schema/index.js";
import { loadConfig, listRuns } from "../../store/index.js";
import { agentLoop } from "../../agent/lifecycle/loop.js";
import { cliLoop } from "../../agent/lifecycle/cli-loop.js";
import { getActionableTasks, collectEpicTaskIds } from "../../agent/planning/brief.js";
import { getStuckTaskIds } from "../../agent/analysis/stuck.js";
import { HENCH_DIR, safeParseInt, safeParseNonNegInt } from "./constants.js";
import { CLIError, EpicNotFoundError, requireLLMCLI } from "../errors.js";
import { info, result as output } from "../output.js";
import { loadLLMConfig, resolveLLMVendor, resolveVendorCliPath } from "../../store/project-config.js";
import { ExecutionQueue, formatQueueStatus, resolveSchedulingPriority } from "../../queue/index.js";
import type { TaskPriority } from "../../queue/index.js";
import { ProcessLimiter } from "../../process/limiter.js";
import { MemoryThrottle } from "../../process/memory-throttle.js";

// ---------------------------------------------------------------------------
// Schema compatibility
// ---------------------------------------------------------------------------

/**
 * Verify the loaded PRD document uses a schema version compatible with this
 * build of hench. Catches mismatches early (at startup) rather than letting
 * them surface as mysterious runtime failures deep in the agent loop.
 */
async function assertSchemaCompatibility(store: PRDStore): Promise<void> {
  const doc = await store.loadDocument();
  if (doc.schema !== SCHEMA_VERSION) {
    throw new CLIError(
      `PRD schema mismatch: document uses "${doc.schema}" but this version ` +
      `of hench expects "${SCHEMA_VERSION}". Rebuild packages or run ` +
      `"ndx init" to upgrade.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

// ---------------------------------------------------------------------------
// Epic resolution helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface ResolvedEpic {
  id: string;
  title: string;
}

/**
 * List all epics in the PRD (root-level container items).
 */
export function listEpics(items: PRDItem[]): ResolvedEpic[] {
  const epics: ResolvedEpic[] = [];
  for (const item of items) {
    if (isRootLevel(item.level)) {
      epics.push({ id: item.id, title: item.title });
    }
  }
  return epics;
}

/**
 * Find an epic by ID or title (case-insensitive title match).
 * Returns the matched epic or null if not found.
 */
export function findEpicByIdOrTitle(
  items: PRDItem[],
  search: string,
): ResolvedEpic | null {
  const searchLower = search.toLowerCase();
  for (const item of items) {
    if (isRootLevel(item.level)) {
      if (item.id === search || item.title.toLowerCase() === searchLower) {
        return { id: item.id, title: item.title };
      }
    }
  }
  return null;
}

/**
 * Validate and resolve the --epic flag value.
 * Throws EpicNotFoundError with available epics if not found.
 */
export async function resolveEpicFlag(
  store: PRDStore,
  epicFlag: string,
): Promise<ResolvedEpic> {
  const doc = await store.loadDocument();
  const epic = findEpicByIdOrTitle(doc.items, epicFlag);
  if (!epic) {
    const available = listEpics(doc.items);
    throw new EpicNotFoundError(epicFlag, available);
  }
  return epic;
}

// Re-export collectEpicTaskIds from brief.ts for backward compatibility with tests
export { collectEpicTaskIds } from "../../agent/planning/brief.js";

// ---------------------------------------------------------------------------
// Epic scope info
// ---------------------------------------------------------------------------

export interface EpicScopeInfo {
  id: string;
  title: string;
  /** Total number of tasks/subtasks in the epic. */
  totalTasks: number;
  /** Number of completed tasks/subtasks. */
  completedTasks: number;
  /** Number of actionable tasks (pending or in_progress). */
  actionableTasks: number;
  /** True if all tasks are completed (or epic has no tasks). */
  isComplete: boolean;
  /** True if there are actionable tasks to work on. */
  hasActionableTasks: boolean;
}

/**
 * Get detailed scope information about an epic.
 * Counts tasks/subtasks and their completion status.
 */
export async function getEpicScopeInfo(
  store: PRDStore,
  epicId: string,
): Promise<EpicScopeInfo> {
  const doc = await store.loadDocument();
  const epic = findEpicByIdOrTitle(doc.items, epicId);
  if (!epic) {
    throw new EpicNotFoundError(epicId, listEpics(doc.items));
  }
  const resolvedEpicId = epic.id;

  // Walk the tree and count tasks belonging to this epic
  const { walkTree } = await import("../../prd/rex-gateway.js");

  let totalTasks = 0;
  let completedTasks = 0;
  let actionableTasks = 0;

  for (const { item, parents } of walkTree(doc.items)) {
    // Check if this item is inside the target epic
    const isInEpic =
      item.id === resolvedEpicId ||
      parents.some((p) => p.id === resolvedEpicId);

    if (isInEpic && isWorkItem(item.level)) {
      // Deleted items are excluded from all counts
      if (item.status === "deleted") continue;
      totalTasks++;
      if (item.status === "completed") {
        completedTasks++;
      } else if (item.status === "pending" || item.status === "in_progress") {
        actionableTasks++;
      }
      // deferred and blocked are neither completed nor actionable
    }
  }

  const isComplete = totalTasks === 0 || completedTasks === totalTasks;
  const hasActionableTasks = actionableTasks > 0;

  return {
    id: epic.id,
    title: epic.title,
    totalTasks,
    completedTasks,
    actionableTasks,
    isComplete,
    hasActionableTasks,
  };
}

// ---------------------------------------------------------------------------
// Loop helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Determine whether the loop should continue after a task run.
 * Continues on success and transient errors; stops on hard failures
 * only when stuck detection is disabled (threshold 0).
 *
 * With stuck detection enabled, the loop always continues — stuck tasks
 * are simply skipped on the next iteration.
 */
export function shouldContinueLoop(status: string): boolean {
  return status !== "failed" && status !== "timeout" && status !== "budget_exceeded";
}

/**
 * Pause between loop iterations. Respects an optional AbortSignal so
 * that a Ctrl-C handler can interrupt the wait immediately.
 */
export function loopPause(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (signal.aborted) {
        clearTimeout(timer);
        resolve();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

// ---------------------------------------------------------------------------
// Stuck task helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Load recent runs and compute which tasks are stuck (≥ threshold
 * consecutive hard failures).  Returns an empty set when threshold
 * is 0 (disabled).
 */
export async function loadStuckTaskIds(
  henchDir: string,
  threshold: number,
): Promise<Set<string>> {
  if (threshold <= 0) return new Set();
  const runs = await listRuns(henchDir);
  const stuck = getStuckTaskIds(runs, threshold);
  if (stuck.size > 0) {
    info(`Stuck tasks detected (${stuck.size}): ${[...stuck].join(", ")}`);
  }
  return stuck;
}

// ---------------------------------------------------------------------------
// Execution queue factory (exported for testing and external consumers)
// ---------------------------------------------------------------------------

/**
 * Create an ExecutionQueue sized from the hench guard config.
 *
 * The queue limits concurrent task executions to
 * `guard.maxConcurrentProcesses` (default 3). This is the same
 * limit used for cross-process concurrency, applied here at the
 * in-process task-run level.
 */
export function createExecutionQueue(maxConcurrent: number): ExecutionQueue {
  return new ExecutionQueue(maxConcurrent);
}

// ---------------------------------------------------------------------------
// Priority resolution helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Peek at the next task's scheduling priority without consuming it.
 *
 * Looks up the task (by explicit ID or auto-selection) and resolves
 * its effective scheduling priority from PRD metadata and optional
 * CLI override. This priority is used for {@link ExecutionQueue}
 * insertion ordering so that high-priority tasks bypass normal queue
 * position under resource constraints.
 *
 * @param store PRD store
 * @param taskId Explicit task ID (from --task flag), or undefined for auto-select
 * @param cliOverride Priority override from --priority flag
 * @param excludeTaskIds Task IDs to skip during auto-selection
 * @param epicId Restrict selection to this epic
 */
export async function peekNextTaskPriority(
  store: PRDStore,
  taskId?: string,
  cliOverride?: string,
  excludeTaskIds?: Set<string>,
  epicId?: string,
): Promise<TaskPriority> {
  const doc = await store.loadDocument();

  // If explicit task ID, look it up directly
  if (taskId) {
    const entry = findItem(doc.items, taskId);
    if (entry) {
      return resolveSchedulingPriority({
        taskPriority: entry.item.priority,
        tags: entry.item.tags,
        cliOverride,
      });
    }
    // Task not found — defer to default; runOne will throw later
    return resolveSchedulingPriority({ cliOverride });
  }

  // Auto-select: peek at what findNextTask would pick
  const completedIds = collectCompletedIds(doc.items);
  const skipIds = excludeTaskIds
    ? new Set([...completedIds, ...excludeTaskIds])
    : completedIds;

  if (epicId) {
    // Use the same logic as assembleTaskBrief for epic-scoped selection
    const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
    const allActionable = findActionable(doc.items, skipIds, Infinity);
    const epicActionable = allActionable.filter(
      (e) => epicTaskIds.has(e.item.id) && !excludeTaskIds?.has(e.item.id),
    );
    if (epicActionable.length > 0) {
      const next = epicActionable[0];
      return resolveSchedulingPriority({
        taskPriority: next.item.priority,
        tags: next.item.tags,
        cliOverride,
      });
    }
  } else {
    const next = findNextTask(doc.items, skipIds);
    if (next) {
      return resolveSchedulingPriority({
        taskPriority: next.item.priority,
        tags: next.item.tags,
        cliOverride,
      });
    }
  }

  // No actionable tasks — default priority (runOne will handle the error)
  return resolveSchedulingPriority({ cliOverride });
}

/**
 * Log queue status if there are any queued tasks.
 * Suppressed when the queue is idle.
 */
function logQueueStatus(queue: ExecutionQueue): void {
  const lines = formatQueueStatus(queue.status());
  for (const line of lines) {
    info(line);
  }
}

// ---------------------------------------------------------------------------
// Interactive task selection
// ---------------------------------------------------------------------------

function promptUser(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function selectTask(
  dir: string,
  rexDir: string,
  epicId?: string,
): Promise<string> {
  const store = await resolveStore(rexDir);
  let tasks = await getActionableTasks(store);

  // Filter to tasks within the specified epic if provided
  if (epicId) {
    const doc = await store.loadDocument();
    const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
    tasks = tasks.filter((t) => epicTaskIds.has(t.id));
  }

  if (tasks.length === 0) {
    const scope = epicId ? "within the specified epic" : "in PRD";
    output(`No actionable tasks found ${scope}.`);
    process.exit(0);
  }

  info("\nActionable tasks (by priority):\n");
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    const pri = `[${t.priority}]`.padEnd(10);
    const chain = t.parentChain ? ` (${t.parentChain})` : "";
    info(`  ${String(i + 1).padStart(2)}. ${pri} ${t.title}${chain}`);
  }
  info("");

  const answer = await promptUser(`Select task [1]: `);
  const idx = answer === "" ? 0 : parseInt(answer, 10) - 1;

  if (isNaN(idx) || idx < 0 || idx >= tasks.length) {
    throw new CLIError(
      "Invalid selection.",
      `Enter a number between 1 and ${tasks.length}.`,
    );
  }

  return tasks[idx].id;
}

// ---------------------------------------------------------------------------
// Change classification
// ---------------------------------------------------------------------------

type FileCategory = "code" | "test" | "docs" | "config" | "metadata";

/**
 * Classify a file path into a category based on its extension and name.
 */
function classifyFile(filePath: string): FileCategory {
  // PRD metadata files
  if (filePath.endsWith("prd.json") || filePath.includes(".rex/")) return "metadata";

  // Test files
  if (/\.test\.[jt]sx?$/.test(filePath) || /\.spec\.[jt]sx?$/.test(filePath) ||
      filePath.includes("__tests__/") || filePath.includes("/tests/")) return "test";

  // Docs
  if (/\.md$/i.test(filePath) || /\.mdx$/i.test(filePath) ||
      /\.txt$/i.test(filePath) || /\.rst$/i.test(filePath)) return "docs";

  // Config files
  if (/\.json$/i.test(filePath) || /\.ya?ml$/i.test(filePath) ||
      /\.toml$/i.test(filePath) || /\.ini$/i.test(filePath) ||
      /\.env/i.test(filePath) || /\.config\.[jt]s$/i.test(filePath)) return "config";

  // Code (everything else — .ts, .js, .tsx, .jsx, .py, .go, etc.)
  return "code";
}

/**
 * Extract modified file paths from tool call records and classify them.
 */
function classifyChangedFiles(toolCalls: ToolCallRecord[]): Map<FileCategory, string[]> {
  const changedFiles = new Set<string>();

  for (const call of toolCalls) {
    if (call.tool === "write_file") {
      const path = call.input.path as string | undefined;
      if (path) changedFiles.add(path);
    }
    // Also detect rex status updates as metadata changes
    if (call.tool === "rex_update" || call.tool === "rex_add") {
      changedFiles.add("prd.json");
    }
  }

  const classified = new Map<FileCategory, string[]>();
  for (const file of changedFiles) {
    const category = classifyFile(file);
    const existing = classified.get(category) ?? [];
    existing.push(file);
    classified.set(category, existing);
  }

  return classified;
}

/**
 * Detect whether any tool calls include PRD status updates (rex_update).
 */
function hasPrdStatusUpdate(toolCalls: ToolCallRecord[]): boolean {
  return toolCalls.some((c) => c.tool === "rex_update" || c.tool === "rex_add");
}

/**
 * Format a change classification summary for the run output.
 *
 * Examples:
 *   "Changes: 3 files (2 code, 1 test) + PRD status update"
 *   "Changes: PRD status update only (no code changes)"
 *   "Changes: 1 file (1 docs)"
 */
function formatChangeClassification(toolCalls: ToolCallRecord[]): string {
  const classified = classifyChangedFiles(toolCalls);
  const prdUpdate = hasPrdStatusUpdate(toolCalls);

  // Remove metadata from the classified map for display purposes
  // (metadata = prd.json, shown separately as "PRD status update")
  classified.delete("metadata");

  const totalFiles = [...classified.values()].reduce((sum, files) => sum + files.length, 0);

  if (totalFiles === 0 && prdUpdate) {
    return "Changes: PRD status update only (no code changes)";
  }

  if (totalFiles === 0 && !prdUpdate) {
    return "Changes: none";
  }

  // Build category breakdown
  const categoryLabels: string[] = [];
  const ORDER: FileCategory[] = ["code", "test", "docs", "config"];
  for (const cat of ORDER) {
    const files = classified.get(cat);
    if (files && files.length > 0) {
      categoryLabels.push(`${files.length} ${cat}`);
    }
  }

  const fileLabel = totalFiles === 1 ? "file" : "files";
  const breakdown = categoryLabels.join(", ");
  const prdSuffix = prdUpdate ? " + PRD status update" : "";

  return `Changes: ${totalFiles} ${fileLabel} (${breakdown})${prdSuffix}`;
}

// ---------------------------------------------------------------------------
// Single task execution
// ---------------------------------------------------------------------------

async function runOne(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  review: boolean,
  excludeTaskIds?: Set<string>,
  epicId?: string,
  runHistory?: RunRecord[],
): Promise<{ status: string }> {
  const config = await loadConfig(henchDir);
  const store = await resolveStore(rexDir);
  await assertSchemaCompatibility(store);

  // Load run history for prior attempt display if not provided
  const runs = runHistory ?? await listRuns(henchDir);

  // Apply CLI token budget override to config for CLI provider
  const effectiveConfig = tokenBudget != null
    ? { ...config, provider, tokenBudget }
    : { ...config, provider };

  const result = provider === "cli"
    ? await cliLoop({
        config: effectiveConfig as typeof config & { provider: "cli" },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        model,
        review,
        excludeTaskIds,
        epicId,
        runHistory: runs,
      })
    : await agentLoop({
        config: effectiveConfig as typeof config & { provider: "api" },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        maxTurns,
        tokenBudget,
        model,
        review,
        excludeTaskIds,
        epicId,
        runHistory: runs,
      });

  const { run } = result;

  info("\n=== Run Complete ===");
  output(`Run ID: ${run.id}`);
  output(`Task: ${run.taskTitle}`);
  output(`Status: ${run.status}`);

  // Duration
  if (run.startedAt && run.finishedAt) {
    const durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    info(`Duration: ${formatDuration(durationMs)}`);
  }

  info(`Turns: ${run.turns}`);
  info(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);
  info(`Tool calls: ${run.toolCalls.length}`);

  // Memory stats
  if (run.memoryStats) {
    const peakMB = Math.round(run.memoryStats.peakRssBytes / 1024 / 1024);
    const availGB = run.memoryStats.systemAvailableAtEndBytes >= 0
      ? (run.memoryStats.systemAvailableAtEndBytes / 1024 / 1024 / 1024).toFixed(1)
      : "?";
    const totalGB = run.memoryStats.systemTotalBytes >= 0
      ? (run.memoryStats.systemTotalBytes / 1024 / 1024 / 1024).toFixed(1)
      : "?";
    info(`Memory: ${peakMB} MB peak RSS (system: ${availGB} / ${totalGB} GB available)`);
  }

  // Post-task test results
  const postTests = run.structuredSummary?.postRunTests;
  if (postTests?.ran) {
    const scope = postTests.targetedFiles.length > 0
      ? `${postTests.targetedFiles.length} targeted file(s)`
      : "full suite";
    info(`Post-task tests: ${postTests.passed ? "passed" : "FAILED"} (${scope}, ${postTests.durationMs ?? 0}ms)`);
  }

  // Change classification
  info(formatChangeClassification(run.toolCalls));

  if (run.summary) {
    info(`\nSummary: ${run.summary}`);
  }
  if (run.error) {
    output(`\nError: ${run.error}`);
  }

  return { status: run.status };
}

// ---------------------------------------------------------------------------
// No-more-tasks sentinel
// ---------------------------------------------------------------------------

const NO_TASKS_MSG = "No actionable tasks found in PRD";

function isNoTasksError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(NO_TASKS_MSG);
}

// ---------------------------------------------------------------------------
// cmdRun — main entry point
// ---------------------------------------------------------------------------

export async function cmdRun(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = join(dir, HENCH_DIR);
  const config = await loadConfig(henchDir);
  const rexDir = join(dir, config.rexDir);
  const llmConfig = await loadLLMConfig(henchDir);
  const llmVendor = resolveLLMVendor(llmConfig);

  const provider = (flags.provider as "cli" | "api") ?? config.provider;
  const dryRun = flags["dry-run"] === "true";
  const review = flags.review === "true";
  const model = flags.model;
  const auto = flags.auto === "true";
  const loop = flags.loop === "true";
  const selfHeal = flags["self-heal"] === "true";

  // Apply self-heal mode to config so it flows through to prompt building
  if (selfHeal) {
    config.selfHeal = true;
  }

  if (llmVendor === "codex" && provider === "api" && !dryRun) {
    throw new CLIError(
      "Hench API provider is only supported for vendor=claude.",
      "Set 'n-dx config hench.provider cli' or switch vendor: 'n-dx config llm.vendor claude'.",
    );
  }

  // Fail fast if CLI provider selected but vendor CLI binary not available
  if (provider === "cli" && !dryRun) {
    const customPath = resolveVendorCliPath(llmConfig);
    requireLLMCLI(llmVendor, customPath);
  }

  const iterations = flags.iterations ? safeParseInt(flags.iterations, "iterations") : 1;
  const maxTurns = flags["max-turns"] ? safeParseInt(flags["max-turns"], "max-turns") : undefined;
  const tokenBudget = flags["token-budget"] != null ? safeParseNonNegInt(flags["token-budget"], "token-budget") : undefined;
  const pauseMs = flags["loop-pause"]
    ? safeParseInt(flags["loop-pause"], "loop-pause")
    : config.loopPauseMs;

  // Validate epic flag if provided (validates existence before starting work)
  let epicId: string | undefined;
  if (flags.epic) {
    const store = await resolveStore(rexDir);
    const scopeInfo = await getEpicScopeInfo(store, flags.epic);
    epicId = scopeInfo.id;

    // Show epic scope with completion status
    const progress = scopeInfo.totalTasks > 0
      ? `${scopeInfo.completedTasks}/${scopeInfo.totalTasks} tasks complete`
      : "no tasks";
    info(`Epic scope: ${scopeInfo.title} (${scopeInfo.id}) — ${progress}`);

    // Check for completion or no actionable tasks
    if (scopeInfo.isComplete) {
      output(`\n✓ All tasks in epic "${scopeInfo.title}" are complete.`);
      process.exit(0);
    }
    if (!scopeInfo.hasActionableTasks) {
      output(`\n⚠ Epic "${scopeInfo.title}" has no actionable tasks.`);
      output(`  ${scopeInfo.totalTasks - scopeInfo.completedTasks} task(s) are blocked or deferred.`);
      output(`  Use 'rex status' to see task statuses, or update tasks with 'rex update <id> --status=pending'.`);
      process.exit(0);
    }
  }

  const epicByEpic = flags["epic-by-epic"] === "true";

  // --priority flag: override task scheduling priority.
  // Valid values: critical, high, medium, low.
  const priorityOverride = flags.priority;

  // --epic-by-epic and --epic are mutually exclusive
  if (epicByEpic && flags.epic) {
    throw new CLIError(
      "Cannot use --epic-by-epic with --epic.",
      "Use --epic to scope to a single epic, or --epic-by-epic to process all epics sequentially.",
    );
  }

  // Memory-based execution throttling.
  // Delays or rejects runs when system memory is under pressure.
  const throttle = new MemoryThrottle(config.guard.memoryThrottle);
  await throttle.gate(({ decision, memoryUsagePercent, delayMs, attempt, maxRetries }) => {
    if (decision === "delay") {
      info(
        `⏳ Memory usage high (${memoryUsagePercent.toFixed(1)}%) — ` +
        `delaying execution ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
    } else if (decision === "reject") {
      info(`🚫 Memory usage critical (${memoryUsagePercent.toFixed(1)}%) — rejecting execution`);
    } else if (attempt > 0) {
      info(`✓ Memory usage recovered (${memoryUsagePercent.toFixed(1)}%) — proceeding`);
    }
  });

  // Enforce cross-process concurrency limit.
  // Prevents multiple `hench run` invocations from exhausting memory.
  const limiter = new ProcessLimiter(henchDir, config.guard.maxConcurrentProcesses);
  await limiter.acquire(flags.task);

  try {
    // Create execution queue for in-process concurrency control.
    // The queue limits concurrent task runs within this process
    // (loop mode, epic-by-epic).
    const queue = createExecutionQueue(config.guard.maxConcurrentProcesses);

    if (epicByEpic) {
      await runEpicByEpic(dir, henchDir, rexDir, provider, dryRun, model, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, review, queue, priorityOverride);
      return;
    }

    let taskId = flags.task;

    // Task selection: --task > interactive (TTY) > autoselect
    // In loop mode, always autoselect (skip interactive)
    if (!taskId && !auto && !loop && process.stdin.isTTY && !dryRun) {
      taskId = await selectTask(dir, rexDir, epicId);
    }
    // If --auto, --loop, or non-TTY, taskId stays undefined → assembleTaskBrief autoselects

    if (loop) {
      await runLoop(dir, henchDir, rexDir, provider, taskId, dryRun, model, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, review, epicId, queue, priorityOverride);
    } else {
      await runIterations(dir, henchDir, rexDir, provider, taskId, dryRun, model, maxTurns, tokenBudget, iterations, config.maxFailedAttempts, review, epicId);
    }
  } finally {
    await limiter.release();
  }
}

// ---------------------------------------------------------------------------
// Fixed iteration mode (existing behaviour)
// ---------------------------------------------------------------------------

async function runIterations(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  iterations: number,
  maxFailedAttempts: number,
  review: boolean,
  epicId?: string,
): Promise<void> {
  for (let i = 0; i < iterations; i++) {
    if (iterations > 1) {
      info(`\n=== Iteration ${i + 1}/${iterations} ===`);
    }

    // For autoselected iterations, skip stuck tasks
    const isAutoselect = i > 0 || !taskId;
    const stuckIds = isAutoselect
      ? await loadStuckTaskIds(henchDir, maxFailedAttempts)
      : undefined;

    const { status } = await runOne(
      dir, henchDir, rexDir, provider,
      // Only use the explicit taskId for the first iteration;
      // subsequent iterations autoselect the next task
      i === 0 ? taskId : undefined,
      dryRun, model, maxTurns, tokenBudget,
      review,
      stuckIds,
      epicId,
    );

    if (status === "error_transient") {
      info(`\nTransient error on iteration ${i + 1}, continuing to next task...`);
      continue;
    }

    if (status === "failed" || status === "timeout" || status === "budget_exceeded") {
      info(`\nStopping after ${i + 1} iteration(s) due to ${status} status.`);
      break;
    }

    if (dryRun) break;
  }
}

// ---------------------------------------------------------------------------
// Continuous loop mode (--loop)
// ---------------------------------------------------------------------------

async function runLoop(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  pauseMs: number,
  maxFailedAttempts: number,
  review: boolean,
  epicId?: string,
  queue?: ExecutionQueue,
  priorityOverride?: string,
): Promise<void> {
  // Graceful shutdown via SIGINT (Ctrl-C)
  const ac = new AbortController();
  let stopping = false;

  const onSignal = () => {
    if (stopping) {
      // Second Ctrl-C: force exit
      process.exit(1);
    }
    stopping = true;
    ac.abort();
    if (queue) queue.drain();
    info("\nReceived interrupt — finishing current task then stopping…");
  };

  process.on("SIGINT", onSignal);

  let completed = 0;

  try {
    const scope = epicId ? "epic tasks" : "all tasks";
    info(`Loop mode: running continuously until ${scope} complete or interrupted (Ctrl+C to stop)`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (stopping) {
        info(`\nLoop stopped by user after ${completed} task(s).`);
        break;
      }

      completed++;
      info(`\n=== Loop iteration ${completed} ===`);

      // Show queue status if there are pending tasks
      if (queue) logQueueStatus(queue);

      // Compute stuck tasks before each iteration so that
      // recently-stuck tasks are automatically skipped
      const isAutoselect = completed > 1 || !taskId;
      const stuckIds = isAutoselect
        ? await loadStuckTaskIds(henchDir, maxFailedAttempts)
        : undefined;

      let status: string;
      try {
        // Resolve scheduling priority from task metadata before enqueuing.
        // This lets high-priority tasks bypass normal queue position.
        const effectiveTaskId = completed === 1 ? taskId : undefined;
        let schedulingPriority: TaskPriority = "medium";
        if (queue) {
          const store = await resolveStore(rexDir);
          schedulingPriority = await peekNextTaskPriority(
            store, effectiveTaskId, priorityOverride, stuckIds, epicId,
          );
          await queue.acquire(effectiveTaskId ?? "auto", schedulingPriority);
        }

        try {
          const result = await runOne(
            dir, henchDir, rexDir, provider,
            // Only use explicit taskId on the very first iteration
            effectiveTaskId,
            dryRun, model, maxTurns, tokenBudget,
            review,
            stuckIds,
            epicId,
          );
          status = result.status;
        } finally {
          // Release the queue slot after the task completes
          if (queue) queue.release();
        }
      } catch (err) {
        if (isNoTasksError(err)) {
          const scope = epicId ? " in epic" : "";
          info(`\nAll tasks${scope} complete — loop finished after ${completed - 1} task(s).`);
          break;
        }
        throw err;
      }

      if (!shouldContinueLoop(status)) {
        // In loop mode, hard failures don't stop the loop — the stuck
        // task will be detected and skipped on the next iteration.
        info(`\nTask failed (${status}), will skip if stuck on next iteration...`);
      }

      if (dryRun) {
        info("\nDry run — stopping after one iteration.");
        break;
      }

      if (status === "error_transient") {
        info("\nTransient error, continuing to next task...");
      }

      // Pause between tasks (interruptible)
      if (!stopping && pauseMs > 0) {
        info(`\nPausing ${pauseMs}ms before next task...`);
        await loopPause(pauseMs, ac.signal);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
}

// ---------------------------------------------------------------------------
// Epic-by-epic execution mode (--epic-by-epic)
// ---------------------------------------------------------------------------

/**
 * Per-epic summary collected during epic-by-epic execution.
 */
export interface EpicRunSummary {
  id: string;
  title: string;
  tasksCompleted: number;
  tasksFailed: number;
  /** "completed" | "no_actionable_tasks" | "skipped" | "interrupted" */
  outcome: string;
}

/**
 * Collect ordered list of epics that have actionable tasks.
 * Returns all epics in PRD order, including those that are fully complete
 * (so the caller can decide what to process).
 */
export async function getOrderedEpics(
  store: PRDStore,
): Promise<EpicScopeInfo[]> {
  const doc = await store.loadDocument();
  const epics = listEpics(doc.items);
  const result: EpicScopeInfo[] = [];
  for (const epic of epics) {
    const scopeInfo = await getEpicScopeInfo(store, epic.id);
    result.push(scopeInfo);
  }
  return result;
}

/**
 * Run tasks across all epics sequentially. For each epic that has
 * actionable tasks, runs tasks in a loop until the epic is complete,
 * blocked, or interrupted, then advances to the next epic.
 */
async function runEpicByEpic(
  dir: string,
  henchDir: string,
  rexDir: string,
  provider: "cli" | "api",
  dryRun: boolean,
  model: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  pauseMs: number,
  maxFailedAttempts: number,
  review: boolean,
  queue?: ExecutionQueue,
  priorityOverride?: string,
): Promise<void> {
  // Graceful shutdown via SIGINT (Ctrl-C)
  const ac = new AbortController();
  let stopping = false;

  const onSignal = () => {
    if (stopping) {
      process.exit(1);
    }
    stopping = true;
    ac.abort();
    if (queue) queue.drain();
    info("\nReceived interrupt — finishing current task then stopping…");
  };

  process.on("SIGINT", onSignal);

  const summaries: EpicRunSummary[] = [];

  try {
    const store = await resolveStore(rexDir);
    await assertSchemaCompatibility(store);
    const allEpics = await getOrderedEpics(store);

    if (allEpics.length === 0) {
      output("No epics found in PRD.");
      return;
    }

    // Filter to epics that need work
    const actionableEpics = allEpics.filter((e) => !e.isComplete);
    if (actionableEpics.length === 0) {
      output("✓ All epics are complete.");
      return;
    }

    info(`Epic-by-epic mode: ${actionableEpics.length} epic(s) to process\n`);
    for (const epic of actionableEpics) {
      const progress = `${epic.completedTasks}/${epic.totalTasks} tasks complete`;
      info(`  • ${epic.title} — ${progress}`);
    }

    for (let epicIdx = 0; epicIdx < actionableEpics.length; epicIdx++) {
      if (stopping) {
        // Mark remaining epics as interrupted
        for (let j = epicIdx; j < actionableEpics.length; j++) {
          summaries.push({
            id: actionableEpics[j].id,
            title: actionableEpics[j].title,
            tasksCompleted: 0,
            tasksFailed: 0,
            outcome: "interrupted",
          });
        }
        break;
      }

      const epic = actionableEpics[epicIdx];

      info(`\n${"═".repeat(60)}`);
      info(`Epic ${epicIdx + 1}/${actionableEpics.length}: ${epic.title}`);
      info(`${"═".repeat(60)}`);

      // Re-check epic scope (tasks may have changed from prior epic's work)
      const freshScope = await getEpicScopeInfo(store, epic.id);

      if (freshScope.isComplete) {
        info(`✓ Epic "${epic.title}" is already complete.`);
        summaries.push({
          id: epic.id,
          title: epic.title,
          tasksCompleted: 0,
          tasksFailed: 0,
          outcome: "completed",
        });
        continue;
      }

      if (!freshScope.hasActionableTasks) {
        info(`⚠ Epic "${epic.title}" has no actionable tasks (${freshScope.totalTasks - freshScope.completedTasks} blocked/deferred).`);
        summaries.push({
          id: epic.id,
          title: epic.title,
          tasksCompleted: 0,
          tasksFailed: 0,
          outcome: "no_actionable_tasks",
        });
        continue;
      }

      const progress = `${freshScope.completedTasks}/${freshScope.totalTasks} tasks complete`;
      info(`Starting: ${freshScope.actionableTasks} actionable task(s), ${progress}`);

      let tasksCompleted = 0;
      let tasksFailed = 0;

      // Inner loop: run tasks within this epic
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (stopping) break;

        // Show queue status if there are pending tasks
        if (queue) logQueueStatus(queue);

        const stuckIds = await loadStuckTaskIds(henchDir, maxFailedAttempts);

        let status: string;
        try {
          // Resolve scheduling priority from task metadata before enqueuing.
          // This lets high-priority tasks bypass normal queue position.
          if (queue) {
            const schedulingPriority = await peekNextTaskPriority(
              store, undefined, priorityOverride, stuckIds, epic.id,
            );
            await queue.acquire(epic.id, schedulingPriority);
          }

          try {
            const result = await runOne(
              dir, henchDir, rexDir, provider,
              undefined, // autoselect within epic
              dryRun, model, maxTurns, tokenBudget,
              review,
              stuckIds,
              epic.id,
            );
            status = result.status;
          } finally {
            // Release the queue slot after the task completes
            if (queue) queue.release();
          }
        } catch (err) {
          if (isNoTasksError(err)) {
            // All tasks in this epic are done
            break;
          }
          throw err;
        }

        if (status === "completed") {
          tasksCompleted++;
        } else if (status === "failed" || status === "timeout" || status === "budget_exceeded") {
          tasksFailed++;
        }

        if (dryRun) {
          info("\nDry run — stopping after one task.");
          break;
        }

        // Re-check epic scope after each task
        const updated = await getEpicScopeInfo(store, epic.id);
        if (updated.isComplete) {
          info(`\n✓ Epic "${epic.title}" is now complete!`);
          break;
        }
        if (!updated.hasActionableTasks) {
          info(`\n⚠ Epic "${epic.title}" has no more actionable tasks.`);
          break;
        }

        // Pause between tasks (interruptible)
        if (!stopping && pauseMs > 0) {
          info(`\nPausing ${pauseMs}ms before next task...`);
          await loopPause(pauseMs, ac.signal);
        }
      }

      const epicOutcome = stopping ? "interrupted" : (
        (await getEpicScopeInfo(store, epic.id)).isComplete
          ? "completed"
          : "no_actionable_tasks"
      );

      summaries.push({
        id: epic.id,
        title: epic.title,
        tasksCompleted,
        tasksFailed,
        outcome: epicOutcome,
      });

      if (dryRun) break;

      // Pause between epics (interruptible)
      if (!stopping && epicIdx < actionableEpics.length - 1 && pauseMs > 0) {
        info(`\nPausing ${pauseMs}ms before next epic...`);
        await loopPause(pauseMs, ac.signal);
      }
    }

    // Print final summary
    printEpicByEpicSummary(summaries);
  } finally {
    process.removeListener("SIGINT", onSignal);
  }
}

/**
 * Print a summary table of epic-by-epic execution results.
 */
export function printEpicByEpicSummary(summaries: EpicRunSummary[]): void {
  info(`\n${"═".repeat(60)}`);
  info("Epic-by-Epic Execution Summary");
  info(`${"═".repeat(60)}`);

  let totalCompleted = 0;
  let totalFailed = 0;

  for (const s of summaries) {
    const icon =
      s.outcome === "completed" ? "✓" :
      s.outcome === "interrupted" ? "⊘" :
      s.outcome === "no_actionable_tasks" ? "⚠" :
      s.outcome === "skipped" ? "–" :
      "?";

    const stats = s.tasksCompleted > 0 || s.tasksFailed > 0
      ? ` (${s.tasksCompleted} done, ${s.tasksFailed} failed)`
      : "";

    output(`  ${icon} ${s.title} — ${s.outcome}${stats}`);
    totalCompleted += s.tasksCompleted;
    totalFailed += s.tasksFailed;
  }

  const epicsDone = summaries.filter((s) => s.outcome === "completed").length;
  output(`\nEpics: ${epicsDone}/${summaries.length} completed | Tasks: ${totalCompleted} done, ${totalFailed} failed`);
}
