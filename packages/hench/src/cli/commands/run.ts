import { join } from "node:path";
import { createInterface } from "node:readline";
import { resolveStore } from "rex/dist/store/index.js";
import { loadConfig, listRuns } from "../../store/index.js";
import { agentLoop } from "../../agent/loop.js";
import { cliLoop } from "../../agent/cli-loop.js";
import { getActionableTasks } from "../../agent/brief.js";
import { getStuckTaskIds } from "../../agent/stuck.js";
import { HENCH_DIR, safeParseInt } from "./constants.js";
import { CLIError, requireClaudeCLI } from "../errors.js";
import { info, result as output } from "../output.js";

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
  return status !== "failed" && status !== "timeout";
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
): Promise<string> {
  const store = await resolveStore(rexDir);
  const tasks = await getActionableTasks(store);

  if (tasks.length === 0) {
    output("No actionable tasks found in PRD.");
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
  review: boolean,
  excludeTaskIds?: Set<string>,
): Promise<{ status: string }> {
  const config = await loadConfig(henchDir);
  const store = await resolveStore(rexDir);

  const result = provider === "cli"
    ? await cliLoop({
        config: { ...config, provider },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        model,
        review,
        excludeTaskIds,
      })
    : await agentLoop({
        config: { ...config, provider },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        maxTurns,
        model,
        review,
        excludeTaskIds,
      });

  const { run } = result;

  info("\n=== Run Complete ===");
  output(`Run ID: ${run.id}`);
  output(`Task: ${run.taskTitle}`);
  output(`Status: ${run.status}`);
  info(`Turns: ${run.turns}`);
  info(`Tokens: ${run.tokenUsage.input} in / ${run.tokenUsage.output} out`);
  info(`Tool calls: ${run.toolCalls.length}`);

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
    requireClaudeCLI();
  }

  const iterations = flags.iterations ? safeParseInt(flags.iterations, "iterations") : 1;
  const maxTurns = flags["max-turns"] ? safeParseInt(flags["max-turns"], "max-turns") : undefined;
  const pauseMs = flags["loop-pause"]
    ? safeParseInt(flags["loop-pause"], "loop-pause")
    : config.loopPauseMs;

  let taskId = flags.task;

  // Task selection: --task > interactive (TTY) > autoselect
  // In loop mode, always autoselect (skip interactive)
  if (!taskId && !auto && !loop && process.stdin.isTTY && !dryRun) {
    taskId = await selectTask(dir, rexDir);
  }
  // If --auto, --loop, or non-TTY, taskId stays undefined → assembleTaskBrief autoselects

  if (loop) {
    await runLoop(dir, henchDir, rexDir, provider, taskId, dryRun, model, maxTurns, pauseMs, config.maxFailedAttempts, review);
  } else {
    await runIterations(dir, henchDir, rexDir, provider, taskId, dryRun, model, maxTurns, iterations, config.maxFailedAttempts, review);
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
  iterations: number,
  maxFailedAttempts: number,
  review: boolean,
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
      dryRun, model, maxTurns,
      review,
      stuckIds,
    );

    if (status === "error_transient") {
      info(`\nTransient error on iteration ${i + 1}, continuing to next task...`);
      continue;
    }

    if (status === "failed" || status === "timeout") {
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
  pauseMs: number,
  maxFailedAttempts: number,
  review: boolean,
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
    info("Loop mode: running continuously until all tasks complete or interrupted (Ctrl+C to stop)");

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
          dryRun, model, maxTurns,
          review,
          stuckIds,
        );
        status = result.status;
      } catch (err) {
        if (isNoTasksError(err)) {
          info(`\nAll tasks complete — loop finished after ${completed - 1} task(s).`);
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
