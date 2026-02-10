import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveStore } from "rex";
import type { PRDItem, PRDStore } from "rex";
import { loadConfig, listRuns } from "../../store/index.js";
import { agentLoop } from "../../agent/lifecycle/loop.js";
import { cliLoop } from "../../agent/lifecycle/cli-loop.js";
import { getActionableTasks, collectEpicTaskIds } from "../../agent/planning/brief.js";
import { getStuckTaskIds } from "../../agent/analysis/stuck.js";
import { HENCH_DIR, safeParseInt, safeParseNonNegInt } from "./constants.js";
import { CLIError, EpicNotFoundError, requireClaudeCLI } from "../errors.js";
import { info, result as output } from "../output.js";
import { loadClaudeConfig, resolveCliPath } from "../../store/project-config.js";

// ---------------------------------------------------------------------------
// Epic resolution helpers (exported for testing)
// ---------------------------------------------------------------------------

export interface ResolvedEpic {
  id: string;
  title: string;
}

/**
 * List all epics in the PRD (root-level items with level === "epic").
 */
export function listEpics(items: PRDItem[]): ResolvedEpic[] {
  const epics: ResolvedEpic[] = [];
  for (const item of items) {
    if (item.level === "epic") {
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
    if (item.level === "epic") {
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

  // Walk the tree and count tasks belonging to this epic
  const { walkTree } = await import("rex/dist/core/tree.js");

  let totalTasks = 0;
  let completedTasks = 0;
  let actionableTasks = 0;

  for (const { item, parents } of walkTree(doc.items)) {
    // Check if this item is inside the target epic
    const isInEpic =
      item.id === epicId ||
      parents.some((p) => p.id === epicId);

    if (isInEpic && (item.level === "task" || item.level === "subtask")) {
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
): Promise<{ status: string }> {
  const config = await loadConfig(henchDir);
  const store = await resolveStore(rexDir);

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
      });

  const { run } = result;

  info("\n=== Run Complete ===");
  output(`Run ID: ${run.id}`);
  output(`Task: ${run.taskTitle}`);
  output(`Status: ${run.status}`);
  info(`Turns: ${run.turns}`);
  info(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);
  info(`Tool calls: ${run.toolCalls.length}`);

  // Post-task test results
  const postTests = run.structuredSummary?.postRunTests;
  if (postTests?.ran) {
    const scope = postTests.targetedFiles.length > 0
      ? `${postTests.targetedFiles.length} targeted file(s)`
      : "full suite";
    info(`Post-task tests: ${postTests.passed ? "passed" : "FAILED"} (${scope}, ${postTests.durationMs ?? 0}ms)`);
  }

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

  const provider = (flags.provider as "cli" | "api") ?? config.provider;
  const dryRun = flags["dry-run"] === "true";
  const review = flags.review === "true";
  const model = flags.model;
  const auto = flags.auto === "true";
  const loop = flags.loop === "true";

  // Fail fast if CLI provider selected but claude binary not available
  if (provider === "cli" && !dryRun) {
    const claudeConfig = await loadClaudeConfig(henchDir);
    const customPath = claudeConfig.cli_path;
    requireClaudeCLI(customPath);
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

  let taskId = flags.task;

  // Task selection: --task > interactive (TTY) > autoselect
  // In loop mode, always autoselect (skip interactive)
  if (!taskId && !auto && !loop && process.stdin.isTTY && !dryRun) {
    taskId = await selectTask(dir, rexDir, epicId);
  }
  // If --auto, --loop, or non-TTY, taskId stays undefined → assembleTaskBrief autoselects

  if (loop) {
    await runLoop(dir, henchDir, rexDir, provider, taskId, dryRun, model, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, review, epicId);
  } else {
    await runIterations(dir, henchDir, rexDir, provider, taskId, dryRun, model, maxTurns, tokenBudget, iterations, config.maxFailedAttempts, review, epicId);
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

      // Compute stuck tasks before each iteration so that
      // recently-stuck tasks are automatically skipped
      const isAutoselect = completed > 1 || !taskId;
      const stuckIds = isAutoselect
        ? await loadStuckTaskIds(henchDir, maxFailedAttempts)
        : undefined;

      let status: string;
      try {
        const result = await runOne(
          dir, henchDir, rexDir, provider,
          // Only use explicit taskId on the very first iteration
          completed === 1 ? taskId : undefined,
          dryRun, model, maxTurns, tokenBudget,
          review,
          stuckIds,
          epicId,
        );
        status = result.status;
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
