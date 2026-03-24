/**
 * Shared lifecycle operations — common validation and orchestration logic
 * used by both the API and CLI agent loops.
 *
 * Both `loop.ts` (API provider) and `cli-loop.ts` (CLI provider) share
 * identical logic for brief assembly, dry run handling, task status
 * transitions, run record initialization, review gating, post-task
 * testing, and run finalization. This module extracts that shared logic
 * to prevent behavioral divergence between the two execution paths.
 *
 * Provider-specific code (API calls vs CLI subprocess management) stays
 * in the respective loop modules.
 *
 * @module
 */

import { randomUUID } from "node:crypto";
import type { PRDStore, SelectionExplanation } from "../../prd/rex-gateway.js";
import { explainSelection, collectCompletedIds, findItem } from "../../prd/rex-gateway.js";
import type { HenchConfig, RunRecord, RunMemoryStats, TaskBrief } from "../../schema/index.js";
import { getCurrentHead } from "../../process/index.js";
import { SystemMemoryMonitor } from "../../process/memory-monitor.js";
import { assembleTaskBrief, formatTaskBrief } from "../planning/brief.js";
import type { AssembleBriefOptions } from "../planning/brief.js";
import { buildSystemPrompt } from "../planning/prompt.js";
import { saveRun } from "../../store/index.js";
import { buildRunSummary } from "../analysis/summary.js";
import { collectReviewDiff, promptReview, revertChanges } from "../analysis/review.js";
import { runPostTaskTests } from "../../tools/index.js";
import { toolRexUpdateStatus, toolRexAppendLog } from "../../tools/rex.js";
import { section, subsection, stream, detail, info } from "../../types/output.js";
import { displayTaskInfo } from "./task-display.js";
import type { SelectionReason, PriorAttemptInfo } from "./task-display.js";
import type { Heartbeat } from "./heartbeat.js";

// ---------------------------------------------------------------------------
// Shared option types
// ---------------------------------------------------------------------------

/** Options common to both API and CLI loops. */
export interface SharedLoopOptions {
  config: HenchConfig;
  store: PRDStore;
  projectDir: string;
  henchDir: string;
  taskId?: string;
  dryRun?: boolean;
  model?: string;
  /** Show diff and prompt for approval before finalizing. */
  review?: boolean;
  /** Task IDs to skip during autoselection (e.g. stuck tasks). */
  excludeTaskIds?: Set<string>;
  /** Restrict task selection to this epic (ID). */
  epicId?: string;
  /** Prior attempt history for the selected task (shown in task card). */
  priorAttempts?: PriorAttemptInfo;
  /** Run records for computing prior attempts when task is auto-selected. */
  runHistory?: RunRecord[];
}

// ---------------------------------------------------------------------------
// Brief preparation (identical in both loops)
// ---------------------------------------------------------------------------

export interface PreparedBrief {
  brief: TaskBrief;
  taskId: string;
  briefText: string;
  systemPrompt: string;
}

/** Additional display options for brief preparation. */
export interface PrepareBriefDisplayOptions {
  /** Prior attempt history for the selected task. */
  priorAttempts?: PriorAttemptInfo;
  /** Run records for computing prior attempts when task is auto-selected. */
  runHistory?: RunRecord[];
}

/**
 * Assemble the task brief, format it, build the system prompt, and display
 * task info. This sequence is identical in both API and CLI loops.
 *
 * When the task is auto-selected (no explicit taskId), computes a
 * SelectionExplanation from rex to show rich reasoning in the task card.
 */
export async function prepareBrief(
  store: PRDStore,
  config: HenchConfig,
  taskId?: string,
  options?: AssembleBriefOptions,
  displayOptions?: PrepareBriefDisplayOptions,
): Promise<PreparedBrief> {
  const { brief, taskId: resolvedTaskId } = await assembleTaskBrief(store, taskId, options);
  const briefText = formatTaskBrief(brief);
  const systemPrompt = buildSystemPrompt(brief.project, config);

  const reason: SelectionReason = taskId ? "explicit" : "auto";

  // Compute selection explanation for auto-selected tasks
  let explanation: SelectionExplanation | undefined;
  if (!taskId) {
    try {
      const doc = await store.loadDocument();
      const completedIds = collectCompletedIds(doc.items);
      // Get the full tree entry (not the brief version) for explainSelection
      const treeEntry = findItem(doc.items, resolvedTaskId);
      if (treeEntry) {
        explanation = explainSelection(doc.items, treeEntry, completedIds);
      }
    } catch {
      // Best-effort — fall back to simple display
    }
  }

  // Resolve prior attempts: use explicit value if provided, otherwise compute from run history
  let priorAttempts = displayOptions?.priorAttempts;
  if (!priorAttempts && displayOptions?.runHistory) {
    priorAttempts = computePriorAttempts(resolvedTaskId, displayOptions.runHistory);
  }

  displayTaskInfo(brief, reason, explanation, priorAttempts);

  return { brief, taskId: resolvedTaskId, briefText, systemPrompt };
}

// ---------------------------------------------------------------------------
// Prior attempt computation
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds as a human-readable "X ago" string.
 */
function formatTimeAgo(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Compute prior attempt info for a task from run history.
 * Returns undefined if there are no prior attempts.
 */
function computePriorAttempts(taskId: string, runs: RunRecord[]): PriorAttemptInfo | undefined {
  const taskRuns = runs.filter((r) => r.taskId === taskId && r.status !== "running");
  if (taskRuns.length === 0) return undefined;

  // runs are sorted by startedAt descending
  const mostRecent = taskRuns[0];
  const finishedAt = mostRecent.finishedAt ?? mostRecent.startedAt;
  const agoMs = Date.now() - new Date(finishedAt).getTime();

  return {
    count: taskRuns.length,
    lastAttemptAgo: formatTimeAgo(agoMs),
    lastStatus: mostRecent.status,
  };
}

// ---------------------------------------------------------------------------
// Dry run (nearly identical, just different label)
// ---------------------------------------------------------------------------

export interface DryRunOptions {
  label: string;
  briefText: string;
  systemPrompt: string;
  taskId: string;
  taskTitle: string;
  model: string;
  /** Extra lines to show after the system prompt + brief. */
  extraInfo?: Array<{ heading: string; content: string }>;
}

/**
 * Execute a dry run — display the system prompt, brief, and optional
 * extra info, then return a synthetic completed RunRecord with zero
 * tokens and zero turns.
 */
export function executeDryRun(opts: DryRunOptions): RunRecord {
  section(`Dry Run${opts.label ? ` (${opts.label})` : ""}`);
  subsection("System Prompt");
  info(opts.systemPrompt);
  subsection("Task Brief");
  info(opts.briefText);

  if (opts.extraInfo) {
    for (const { heading, content } of opts.extraInfo) {
      subsection(heading);
      info(content);
    }
  }

  return {
    id: randomUUID(),
    taskId: opts.taskId,
    taskTitle: opts.taskTitle,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    status: "completed",
    turns: 0,
    summary: "Dry run — no execution performed",
    tokenUsage: { input: 0, output: 0 },
    toolCalls: [],
    model: opts.model,
  };
}

// ---------------------------------------------------------------------------
// Task status transition (identical in both loops)
// ---------------------------------------------------------------------------

/**
 * Atomically transition a task to in_progress before any work begins.
 * Idempotent: skips if the task is already in_progress (e.g. resumed).
 */
export async function transitionToInProgress(
  store: PRDStore,
  taskId: string,
  currentStatus: string,
): Promise<void> {
  if (currentStatus !== "in_progress") {
    await toolRexUpdateStatus(store, taskId, { status: "in_progress" });
  }
}

// ---------------------------------------------------------------------------
// Run record initialization (identical in both loops)
// ---------------------------------------------------------------------------

export interface InitRunOptions {
  taskId: string;
  taskTitle: string;
  model: string;
  henchDir: string;
}

/**
 * System memory context captured at run start, passed through to
 * {@link finalizeRun} for assembling {@link RunMemoryStats}.
 */
export interface MemoryContext {
  systemAvailableAtStartBytes: number;
  systemTotalBytes: number;
}

/**
 * Create a new RunRecord in "running" status and persist it.
 * Also captures a system memory snapshot for later use in finalization.
 * Both loops create identical initial records.
 */
export async function initRunRecord(opts: InitRunOptions): Promise<{ run: RunRecord; memoryCtx: MemoryContext }> {
  const run: RunRecord = {
    id: randomUUID(),
    taskId: opts.taskId,
    taskTitle: opts.taskTitle,
    startedAt: new Date().toISOString(),
    status: "running",
    turns: 0,
    tokenUsage: { input: 0, output: 0 },
    turnTokenUsage: [],
    toolCalls: [],
    model: opts.model,
  };

  run.lastActivityAt = new Date().toISOString();
  await saveRun(opts.henchDir, run);

  // Capture system memory at run start
  const monitor = new SystemMemoryMonitor();
  let memoryCtx: MemoryContext;
  try {
    const snap = await monitor.snapshot();
    memoryCtx = {
      systemAvailableAtStartBytes: snap.availableBytes,
      systemTotalBytes: snap.totalBytes,
    };
  } catch {
    memoryCtx = {
      systemAvailableAtStartBytes: -1,
      systemTotalBytes: -1,
    };
  }

  return { run, memoryCtx };
}

// ---------------------------------------------------------------------------
// Starting HEAD capture (identical in both loops)
// ---------------------------------------------------------------------------

/**
 * Capture the git HEAD before the agent starts, so completion validation
 * can diff against it even if the agent commits changes during the run.
 */
export function captureStartingHead(projectDir: string): string | undefined {
  return getCurrentHead(projectDir);
}

// ---------------------------------------------------------------------------
// Review gate (identical in both loops)
// ---------------------------------------------------------------------------

export interface ReviewGateResult {
  rejected: boolean;
  reason?: string;
}

/**
 * Run the review gate: show diff, prompt for approval, and revert if
 * rejected. Returns whether the review was rejected.
 *
 * Only called when `review` option is enabled and the run completed
 * successfully.
 */
export async function runReviewGate(
  projectDir: string,
  store: PRDStore,
  taskId: string,
  run: RunRecord,
): Promise<ReviewGateResult> {
  const reviewDiff = await collectReviewDiff(projectDir);
  const reviewResult = await promptReview(reviewDiff);

  if (!reviewResult.approved) {
    run.status = "failed";
    run.error = reviewResult.reason;

    info(`\nChanges rejected — reverting...`);
    await revertChanges(projectDir);

    await toolRexUpdateStatus(store, taskId, { status: "pending" });
    await toolRexAppendLog(store, taskId, {
      event: "review_rejected",
      detail: reviewResult.reason ?? "Changes rejected by reviewer",
    });

    return { rejected: true, reason: reviewResult.reason };
  }

  return { rejected: false };
}

// ---------------------------------------------------------------------------
// Post-task testing (identical in both loops)
// ---------------------------------------------------------------------------

/**
 * Run automatic post-task tests for completed runs.
 * Only runs when the run status is "completed" and a test command is configured.
 */
export async function runPostTaskTestsIfNeeded(
  run: RunRecord,
  projectDir: string,
  testCommand?: string,
): Promise<void> {
  if (run.status !== "completed" || !testCommand || !run.structuredSummary) {
    return;
  }

  subsection("Post-Task Tests");
  const testResult = await runPostTaskTests({
    projectDir,
    filesChanged: run.structuredSummary.filesChanged,
    testCommand,
  });
  run.structuredSummary.postRunTests = testResult;

  if (testResult.ran) {
    const scope = testResult.targetedFiles.length > 0
      ? ` (${testResult.targetedFiles.length} targeted file(s))`
      : " (full suite)";
    const status = testResult.passed ? "passed" : "FAILED";
    stream("Tests", `${status}${scope}`);
    if (testResult.durationMs != null) {
      detail(`${testResult.durationMs}ms`);
    }
    if (!testResult.passed && testResult.output) {
      info(testResult.output.slice(-500));
    }
  } else if (testResult.error) {
    detail(testResult.error);
  }
}

// ---------------------------------------------------------------------------
// Run finalization (identical in both loops)
// ---------------------------------------------------------------------------

export interface FinalizeRunOptions {
  run: RunRecord;
  henchDir: string;
  projectDir: string;
  testCommand?: string;
  heartbeat?: Heartbeat;
  memoryCtx?: MemoryContext;
}

/**
 * Finalize a run: build structured summary, capture memory stats,
 * run post-task tests, set timestamps, and persist.
 * Called at the end of both loops.
 */
export async function finalizeRun(opts: FinalizeRunOptions): Promise<void> {
  const { run, henchDir, projectDir, testCommand, heartbeat, memoryCtx } = opts;

  run.structuredSummary = buildRunSummary(run.toolCalls);

  // Assemble memory stats if context was captured at init
  if (memoryCtx) {
    const peakRssBytes = heartbeat?.peakRssBytes ?? process.memoryUsage().rss;

    let systemAvailableAtEndBytes = -1;
    try {
      const monitor = new SystemMemoryMonitor();
      const snap = await monitor.snapshot();
      systemAvailableAtEndBytes = snap.availableBytes;
    } catch {
      // Best-effort — leave as -1
    }

    run.memoryStats = {
      peakRssBytes,
      systemAvailableAtStartBytes: memoryCtx.systemAvailableAtStartBytes,
      systemAvailableAtEndBytes,
      systemTotalBytes: memoryCtx.systemTotalBytes,
    };
  }

  await runPostTaskTestsIfNeeded(run, projectDir, testCommand);

  run.finishedAt = new Date().toISOString();
  run.lastActivityAt = run.finishedAt;
  await saveRun(henchDir, run);
}

// ---------------------------------------------------------------------------
// Error handling helpers (shared patterns)
// ---------------------------------------------------------------------------

/**
 * Handle a failed or timed-out run by updating task status and logging.
 * Used by both loops for their error/timeout paths.
 */
export async function handleRunFailure(
  store: PRDStore,
  taskId: string,
  status: "deferred" | "pending",
  event: string,
  detail: string,
): Promise<void> {
  await toolRexUpdateStatus(store, taskId, { status });
  await toolRexAppendLog(store, taskId, { event, detail });
}

/**
 * Handle budget exceeded by updating task status and logging.
 */
export async function handleBudgetExceeded(
  store: PRDStore,
  taskId: string,
  run: RunRecord,
  totalUsed: number,
  budget: number | undefined,
): Promise<void> {
  run.status = "budget_exceeded";
  run.error = `Token budget exceeded: ${totalUsed} used of ${budget ?? 0} budget`;
  stream("Budget", run.error);

  await handleRunFailure(store, taskId, "pending", "budget_exceeded", run.error);
}
