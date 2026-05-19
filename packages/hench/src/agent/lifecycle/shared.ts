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
import { explainSelection, collectCompletedIds, findItem, PRD_TREE_DIRNAME } from "../../prd/rex-gateway.js";
import type { HenchConfig, RunRecord, RunMemoryStats, TaskBrief, TurnTokenUsage, TestGateResult } from "../../schema/index.js";
import { getCurrentHead, execShellCmd, execStdout } from "../../process/exec.js";
import { SystemMemoryMonitor } from "../../process/memory-monitor.js";
import { assembleTaskBrief, formatTaskBrief } from "../planning/brief.js";
import type { AssembleBriefOptions } from "../planning/brief.js";
import { buildSystemPrompt, buildPromptEnvelope } from "../planning/prompt.js";
import type { PromptEnvelope } from "../../prd/llm-gateway.js";
import { saveRun } from "../../store/runs.js";
import { persistRunLog } from "../../store/run-log.js";
import { buildRunSummary } from "../analysis/summary.js";
import { captureCommitChanges, extractPaths, formatChanges } from "../analysis/git-changed-files.js";
import { collectReviewDiff, promptReview, revertChanges } from "../analysis/review.js";
import { runPostTaskTests, runTestGate } from "../../tools/test-runner.js";
import { resolveTestCommand } from "../../tools/test-command-resolver.js";
import { toolRexUpdateStatus, toolRexAppendLog } from "../../tools/rex.js";
import { section, subsection, stream, detail, info, getCapturedLines, resetCapturedLines } from "../../types/output.js";
import { displayTaskInfo } from "./task-display.js";
import type { SelectionReason, PriorAttemptInfo } from "./task-display.js";
import type { Heartbeat } from "./heartbeat.js";
import { fetchCodexTokenUsage, validateRunTokensPostRun } from "../../quota/index.js";
import { loadLLMConfig } from "../../store/project-config.js";
import { validateTaskCompletion } from "./task-completion-gate.js";

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Shorten a model ID for stream-log labels by dropping numeric version
 * identifiers. Examples: "claude-sonnet-4-6" → "claude-sonnet",
 * "claude-haiku-4-20250414" → "claude-haiku", "gpt-5.4-mini" →
 * "gpt-mini". Falls back to the fallback label when model is empty.
 */
export function formatModelLabel(model?: string, fallback = "Agent"): string {
  if (!model) return fallback;
  const parts = model.split("-").filter((p) => !/^\d/.test(p));
  return parts.length > 0 ? parts.join("-") : model;
}

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
  /** Only select tasks with at least one of these tags (e.g. ["self-heal"]). */
  tags?: string[];
  /** Prior attempt history for the selected task (shown in task card). */
  priorAttempts?: PriorAttemptInfo;
  /** Run records for computing prior attempts when task is auto-selected. */
  runHistory?: RunRecord[];
  /**
   * Automatically revert uncommitted file changes on run failure.
   * Default: true. Pass false (via --no-rollback) to leave changes in place.
   */
  rollbackOnFailure?: boolean;
  /**
   * Skip the interactive rollback confirmation prompt and proceed automatically.
   * Set when --yes is passed or when the caller knows it is running non-interactively.
   */
  yes?: boolean;
  /**
   * True when the run is in a non-interactive autonomous mode (--auto or
   * --loop). Bypasses interactive prompts — including the commit-message
   * approval gate — so unattended runs do not stall waiting for input.
   */
  autonomous?: boolean;
  /**
   * Additional project context to append to the prompt (e.g. CONTEXT.md +
   * PRD status excerpt injected by the pair-programming command).
   */
  extraContext?: string;
  /**
   * 1-based ordinal of this run within the current `ndx work --loop`
   * invocation. When set, the Agent Run banner uses the
   * `#N … start` / `#N … end` format; when undefined (non-loop callers),
   * the original banner is preserved.
   */
  runNumber?: number;
}

// ---------------------------------------------------------------------------
// Brief preparation (identical in both loops)
// ---------------------------------------------------------------------------

export interface PreparedBrief {
  brief: TaskBrief;
  taskId: string;
  briefText: string;
  systemPrompt: string;
  /** Structured prompt envelope with tagged sections. */
  envelope: PromptEnvelope;
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
  extraContext?: string,
): Promise<PreparedBrief> {
  const { brief, taskId: resolvedTaskId } = await assembleTaskBrief(store, taskId, options);
  const briefText = formatTaskBrief(brief);
  const systemPrompt = buildSystemPrompt(brief.project, config);
  const envelope = buildPromptEnvelope(brief, config, extraContext);

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

  return { brief, taskId: resolvedTaskId, briefText, systemPrompt, envelope };
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
  /** Invocation context: "cli" for CLI invocation, "api" for HTTP/MCP. */
  invocationContext?: "cli" | "api";
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

  // Emit invocation context for dry runs as well
  if (opts.invocationContext) {
    const contextDisplay = opts.invocationContext === "cli"
      ? "CLI (ndx work command)"
      : "API (HTTP/MCP)";
    stream("Context", `Invoked via ${contextDisplay}`);
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
    invocationContext: opts.invocationContext,
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
  /** LLM vendor for this run (e.g. "claude", "codex"). Captured in diagnostics and run.vendor. */
  vendor?: string;
  /** Sandbox mode in effect (e.g. "workspace-write"). Captured in diagnostics. */
  sandbox?: string;
  /** Approval policy in effect (e.g. "never"). Captured in diagnostics. */
  approvals?: string;
  /** Output parse mode (e.g. "stream-json", "api-sdk"). Captured in diagnostics. */
  parseMode?: string;
  /** Invocation context: "cli" for CLI invocation, "api" for HTTP/MCP. */
  invocationContext?: "cli" | "api";
  /** Task weight / tier ("light" | "standard"). Used for task-weight-aware model selection. */
  weight?: string;
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
    invocationContext: opts.invocationContext,
    vendor: opts.vendor,
    weight: opts.weight ?? "standard",
  };

  // Emit invocation context to the output stream for CLI and dashboard visibility
  if (opts.invocationContext) {
    const contextDisplay = opts.invocationContext === "cli"
      ? "CLI (ndx work command)"
      : "API (HTTP/MCP)";
    stream("Context", `Invoked via ${contextDisplay}`);
  }

  // Capture initial runtime diagnostics snapshot when identity fields are provided.
  // tokenDiagnosticStatus starts as "unavailable" and is updated at run end.
  if (opts.vendor || opts.parseMode) {
    run.diagnostics = {
      tokenDiagnosticStatus: "unavailable",
      parseMode: opts.parseMode ?? "unknown",
      notes: [],
      vendor: opts.vendor,
      sandbox: opts.sandbox,
      approvals: opts.approvals,
    };
  }

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
// Test suite gate failure handler (mandatory full test validation)
// ---------------------------------------------------------------------------

export type TestGateFailureAction = "rerun" | "abort" | "skip";

/**
 * Handle test gate failure: display summary and prompt for user action.
 * Offers three options: rerun tests, abort (skip commit), or skip gate via flag.
 *
 * Returns the selected action. When called, the gate has already failed
 * (run.status was set to "failed" by the caller).
 *
 * Only prompts in interactive TTY mode; in CI/autonomous mode defaults to abort.
 */
async function promptTestGateFailure(
  testGate: TestGateResult,
  yes?: boolean,
  autonomous?: boolean,
): Promise<TestGateFailureAction> {
  // In non-interactive mode (CI, --yes, --auto), default to abort
  if (!process.stdin.isTTY || yes || autonomous) {
    return "abort";
  }

  const failedPackages = testGate.packages
    .filter((p) => !p.passed)
    .map((p) => p.name)
    .join(", ");
  const packageCount = testGate.packages.length;
  const failCount = packageCount - testGate.packages.filter((p) => p.passed).length;

  info(`\n${failCount}/${packageCount} package(s) failed testing`);
  detail(`Command: ${testGate.command}`);
  detail(`Failed packages: ${failedPackages}`);

  const question =
    "[r]erun tests, [a]bort (revert & skip commit), or [s]kip gate (continue to commit)? [a] ";

  try {
    const answer = await new Promise<string>((resolve) => {
      // Dynamically import readline at runtime
      const { createInterface } = require("node:readline");
      const rl = createInterface({ input: process.stdin, output: process.stdout });

      // Suspend outer SIGINT handlers while the prompt is open
      const savedListeners = process.listeners("SIGINT") as Array<(...args: unknown[]) => void>;
      for (const listener of savedListeners) {
        process.removeListener("SIGINT", listener);
      }

      let settled = false;
      const onInterrupt = (): void => {
        finish("a"); // Default to abort on Ctrl-C
      };

      const finish = (value: string): void => {
        if (settled) return;
        settled = true;
        process.removeListener("SIGINT", onInterrupt);
        rl.removeListener("SIGINT", onInterrupt);
        rl.close();
        // Restore outer SIGINT listeners
        for (const listener of savedListeners) {
          process.on("SIGINT", listener);
        }
        resolve(value);
      };

      process.on("SIGINT", onInterrupt);
      rl.on("SIGINT", onInterrupt);

      rl.question(`\n${question}`, (input: string) => {
        finish(input.trim().toLowerCase() || "a");
      });
    });

    switch (answer) {
      case "r":
        return "rerun";
      case "s":
        return "skip";
      default:
        return "abort";
    }
  } catch {
    // On any error, default to abort
    return "abort";
  }
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
// Codex token retrieval (post-run operation)
// ---------------------------------------------------------------------------

/**
 * Attempt to retrieve actual Codex token usage from the OpenAI API after run completion.
 *
 * This is a best-effort, asynchronous operation: failures are logged but never
 * propagate. If tokens are retrieved and are higher than the current run's recorded
 * tokens (which may be zero-valued), they are merged into the run record.
 *
 * Only runs when this was a Codex run (detected by checking turnTokenUsage
 * entries for vendor="codex").
 */
async function retrieveCodexTokensIfNeeded(run: RunRecord, projectDir: string): Promise<void> {
  // Check if any turn used Codex as the vendor
  const isCodexRun = run.turnTokenUsage?.some((t) => t.vendor === "codex") ?? false;
  if (!isCodexRun) {
    return;
  }

  try {
    const llmConfig = await loadLLMConfig(projectDir);
    const codexApiKey = llmConfig.codex?.api_key ?? process.env["OPENAI_API_KEY"];

    if (!codexApiKey || !run.model) {
      // Silent skip: no API key available or model not set
      return;
    }

    const result = await fetchCodexTokenUsage({
      apiKey: codexApiKey,
      model: run.model,
      apiEndpoint: llmConfig.codex?.api_endpoint,
      timeoutMs: 500,
      runId: run.id,
    });

    if (!result.ok) {
      // Log diagnostic on certain error kinds
      if (result.error.kind !== "not-found" && result.error.kind !== "rate-limit") {
        detail(`Codex token retrieval: ${result.error.message}`);
      }
      return;
    }

    // Merge retrieved tokens if they are higher than the current values.
    // This handles the case where Codex CLI output had zero-valued tokens.
    const retrieved = result.tokens;
    const current = run.tokenUsage;

    // Only update if retrieved tokens are strictly higher
    if (retrieved.input > current.input || retrieved.output > current.output) {
      const oldTotal = current.input + current.output;
      const newTotal = retrieved.input + retrieved.output;
      run.tokenUsage.input = Math.max(current.input, retrieved.input);
      run.tokenUsage.output = Math.max(current.output, retrieved.output);
      detail(
        `Updated Codex tokens from API: ${oldTotal} → ${newTotal} ` +
          `(input: ${current.input} → ${retrieved.input}, output: ${current.output} → ${retrieved.output})`,
      );
    }

    if (result.diagnostic) {
      detail(`Codex token diagnostic: ${result.diagnostic}`);
    }
  } catch {
    // Swallow any unexpected errors — this is a post-run operation and must never
    // fail the run itself. The run tokens already captured during execution stand.
  }
}

// ---------------------------------------------------------------------------
// Run finalization (identical in both loops)
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds as a human-readable string.
 * e.g., 5000 → "5s", 65000 → "1m 5s"
 */
function formatDurationMs(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remaining = seconds % 60;
  return `${minutes}m ${remaining}s`;
}

export interface FinalizeRunOptions {
  run: RunRecord;
  henchDir: string;
  projectDir: string;
  config: HenchConfig;
  testCommand?: string;
  heartbeat?: Heartbeat;
  memoryCtx?: MemoryContext;
  /** Whether in self-heal mode (triggers mandatory test gate). */
  selfHeal?: boolean;
  /**
   * Automatically revert uncommitted file changes on run failure.
   * Default: true. Pass false (via --no-rollback) to leave changes in place.
   */
  rollbackOnFailure?: boolean;
  /**
   * Skip the interactive rollback confirmation prompt and proceed automatically.
   * Set when --yes is passed or when the caller knows it is running non-interactively.
   */
  yes?: boolean;
  /**
   * True when the run is in a non-interactive autonomous mode (--auto or
   * --loop). Bypasses the interactive commit-message approval prompt so
   * unattended runs do not stall waiting for input.
   */
  autonomous?: boolean;
  /**
   * PRD store used to reset task status to pending on failure.
   * When provided, if the run fails and the task is still in_progress,
   * it is reset to pending so it reappears as actionable. This occurs
   * independently of rollbackOnFailure.
   */
  store?: PRDStore;
  /**
   * When true, the agent committed its own changes (legacy behavior) and
   * n-dx should not prompt. When false (default), n-dx checks for a pending
   * commit message written by the agent and prompts the user to commit.
   */
  autoCommit?: boolean;
  /**
   * Skip the mandatory full test suite gate before commit.
   * Default: false (gate is mandatory). Set via --skip-test-gate flag.
   */
  skipFullTestGate?: boolean;
}

// ---------------------------------------------------------------------------
// Git rollback helpers
// ---------------------------------------------------------------------------

/** Run statuses that indicate the run ended in failure. */
const FAILURE_STATUSES = new Set(["failed", "timeout", "budget_exceeded", "error_transient", "cancelled"]);

/**
 * Return the list of entries reported by `git status --porcelain`.
 * Each non-blank line represents a modified, staged, or untracked path.
 * Returns an empty array when the working tree is clean or git is unavailable.
 */
async function listDirtyPaths(projectDir: string): Promise<string[]> {
  try {
    const output = await execStdout("git", ["status", "--porcelain"], {
      cwd: projectDir,
      timeout: 15_000,
    });
    return output.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Run an interactive y/n readline prompt with the outer SIGINT handlers
 * temporarily suspended for the duration of the question.
 *
 * The run-loop in `run.ts` registers a SIGINT handler that calls
 * `process.exit(1)` on a second Ctrl-C. Without suspension that handler
 * would kill the process while the user is answering a rollback or
 * commit prompt. This helper snapshots the existing SIGINT listeners,
 * removes them while the readline is open, and restores them on exit.
 *
 * By default, a Ctrl-C received during the prompt is treated as "cancel
 * cleanly — decline": the readline closes and the promise resolves with
 * `false`. Rollback confirmation uses a stricter policy: the first
 * Ctrl-C is absorbed with a visible hint, and a second Ctrl-C exits.
 *
 * @param question  The question to display (with trailing space).
 * @returns         true on accept (empty input, 'y', 'yes');
 *                  false on explicit decline or Ctrl-C cancellation.
 */
interface AskYesNoOptions {
  interruptMode?: "decline" | "hold-then-exit";
}

const ROLLBACK_INTERRUPT_HINT = "Press Ctrl+C again to abort the rollback prompt and exit.";

async function askYesNoWithSuspendedSigint(
  question: string,
  options: AskYesNoOptions = {},
): Promise<boolean> {
  const { createInterface } = await import("node:readline");
  const interruptMode = options.interruptMode ?? "decline";

  // Snapshot any existing SIGINT listeners — typically the run-loop's
  // force-exit handler from run.ts — and remove them before opening the
  // prompt so Ctrl-C does not bypass the question.
  const savedListeners = process.listeners("SIGINT") as Array<(...args: unknown[]) => void>;
  for (const listener of savedListeners) {
    process.removeListener("SIGINT", listener);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return new Promise<boolean>((resolve) => {
    let settled = false;
    let interruptCount = 0;
    let secondInterruptArmed = false;
    const onInterrupt = (): void => {
      if (interruptMode === "hold-then-exit") {
        interruptCount++;
        if (interruptCount === 1) {
          info(`\n${ROLLBACK_INTERRUPT_HINT}`);
          queueMicrotask(() => {
            secondInterruptArmed = true;
          });
          return;
        }
        if (!secondInterruptArmed) {
          return;
        }

        info("\nAborting rollback prompt.");
        const exitProcess = process.exit as (code?: number) => void;
        exitProcess(1);
      }

      finish(false);
    };

    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      process.removeListener("SIGINT", onInterrupt);
      rl.removeListener("SIGINT", onInterrupt);
      rl.close();
      // Restore the outer SIGINT listeners exactly as they were so the
      // run-loop reclaims ownership of Ctrl-C after the prompt closes.
      for (const listener of savedListeners) {
        process.on("SIGINT", listener);
      }
      resolve(value);
    };

    process.on("SIGINT", onInterrupt);
    // Some terminals surface Ctrl-C via readline's own SIGINT event in
    // TTY raw mode — listen on both surfaces so any delivery channel
    // unblocks the prompt cleanly.
    rl.on("SIGINT", onInterrupt);

    rl.question(question, (answer) => {
      const trimmed = answer.trim().toLowerCase();
      finish(trimmed === "" || trimmed === "y" || trimmed === "yes");
    });
  });
}

/**
 * Ask the user to confirm rollback via stdin (TTY only).
 * Returns true when the user accepts (empty input or 'y'/'yes').
 * The first Ctrl-C prints a hint and keeps the prompt open; a second
 * Ctrl-C aborts the prompt and exits.
 */
async function promptRollbackConfirm(count: number): Promise<boolean> {
  return askYesNoWithSuspendedSigint(
    `\nRoll back ${count} uncommitted file(s)? [Y/n] `,
    { interruptMode: "hold-then-exit" },
  );
}

/**
 * Revert all uncommitted changes introduced during the run.
 * Skips silently when the working tree is already clean.
 *
 * In interactive TTY mode (stdin is a terminal and --yes was not passed),
 * prompts the user to confirm before reverting.
 * In non-interactive mode (CI, pipe, or --yes) proceeds without a prompt.
 *
 * Prints the number of reverted paths on completion.
 */
async function performRollbackIfNeeded(projectDir: string, yes?: boolean): Promise<void> {
  const dirtyPaths = await listDirtyPaths(projectDir);
  if (dirtyPaths.length === 0) {
    return;
  }

  // Prompt only in interactive TTY sessions where --yes was not supplied.
  const isInteractive = Boolean(process.stdin.isTTY) && !yes;
  if (isInteractive) {
    const confirmed = await promptRollbackConfirm(dirtyPaths.length);
    if (!confirmed) {
      info(`Rollback skipped — ${dirtyPaths.length} file(s) left unchanged.`);
      return;
    }
  }

  info(`\nRolling back ${dirtyPaths.length} uncommitted file(s) after failed run…`);
  await revertChanges(projectDir);
  info(`Rollback complete — ${dirtyPaths.length} file(s) reverted.`);
}

// ---------------------------------------------------------------------------
// Pending-commit prompt helpers
// ---------------------------------------------------------------------------

/** Project-root sentinel where the agent writes its proposed commit message. */
const PENDING_COMMIT_FILE = ".hench-commit-msg.txt";

async function promptCommitConfirm(fileCount: number): Promise<boolean> {
  // Uses the same SIGINT-suspension shim as the rollback prompt so a
  // Ctrl-C while the user is answering does not trigger the outer
  // run-loop's force-exit handler.
  return askYesNoWithSuspendedSigint(
    `\nCommit ${fileCount} staged file(s) with the above message? [Y/n] `,
  );
}

async function countStagedFiles(projectDir: string): Promise<number> {
  try {
    const output = await execStdout("git", ["diff", "--cached", "--name-only"], {
      cwd: projectDir,
      timeout: 15_000,
    });
    return output.trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

/**
 * Update the PRD task status to "completed" immediately after success is
 * determined (after test gate passes). This ensures the status is persisted
 * to disk before the next iteration begins task selection.
 *
 * Returns true if the status was updated, false if already completed.
 * Idempotent: calling multiple times is safe.
 *
 * Exported for testing and for use by finalizeRun (before commit).
 */
export async function updateCompletedTaskStatus(
  store: PRDStore,
  taskId: string,
  run: RunRecord,
): Promise<boolean> {
  if (!taskId) return false;
  if (run.status !== "completed") return false;

  try {
    // Check current status to avoid redundant updates
    const existingItem = await store.getItem(taskId);
    if (existingItem?.status === "completed") {
      // Already completed — no-op
      return false;
    }

    // Update PRD status to "completed"
    await toolRexUpdateStatus(store, taskId, { status: "completed" });

    // Log the completion event
    await toolRexAppendLog(store, taskId, {
      event: "task_completed",
      detail: run.summary,
    });

    return true;
  } catch (err) {
    // Best-effort: log failure but don't fail the run
    detail(`Warning: early PRD status update failed: ${(err as Error).message}`);
    return false;
  }
}

/**
 * When the agent wrote a pending commit message, show it to the user and
 * prompt them to approve the commit. Runs `git commit -F <file>` on accept,
 * deletes the sentinel on both accept and decline.
 *
 * Skipped when:
 * - autoCommit is enabled (agent commits itself; no sentinel to process)
 * - the run did not complete successfully
 * - no sentinel file is present (agent skipped writing it)
 *
 * The approval prompt is bypassed (commit proceeds using the proposed
 * message) when `yes` is true (--yes) or `autonomous` is true (--auto or
 * --loop) so unattended runs do not stall waiting for input.
 *
 * Exported for direct unit-testing of the approval gate; callers in the
 * lifecycle pipeline reach it via `finalizeRun`.
 */
export async function performCommitPromptIfNeeded(
  run: RunRecord,
  projectDir: string,
  autoCommit: boolean,
  yes?: boolean,
  autonomous?: boolean,
  store?: PRDStore,
  taskId?: string,
): Promise<void> {
  if (autoCommit || run.status !== "completed") return;

  const { join } = await import("node:path");
  const { readFileSync, existsSync, unlinkSync } = await import("node:fs");
  const msgPath = join(projectDir, PENDING_COMMIT_FILE);

  if (!existsSync(msgPath)) return;

  let message = "";
  try {
    message = readFileSync(msgPath, "utf-8").trim();
  } catch {
    return;
  }
  if (!message) {
    try { unlinkSync(msgPath); } catch { /* ignore */ }
    return;
  }

  const stagedCount = await countStagedFiles(projectDir);
  if (stagedCount === 0) {
    info("\nPending commit message found but no staged changes — skipping commit.");
    try { unlinkSync(msgPath); } catch { /* ignore */ }
    return;
  }

  subsection("Proposed Commit");
  info(message);

  // Skip the approval prompt whenever the caller signalled non-interactive
  // operation — --yes or any autonomous mode (--auto, --loop). The same flag
  // state governs other autonomous behaviors (task autoselect, rollback), so
  // the commit gate stays consistent with the rest of the unattended run.
  const isInteractive = Boolean(process.stdin.isTTY) && !yes && !autonomous;
  let confirmed = true;
  if (isInteractive) {
    info("Tip: pass --yes to auto-confirm, or run 'ndx config hench.autoCommit true' to let the agent commit itself.");
    confirmed = await promptCommitConfirm(stagedCount);
  }

  if (!confirmed) {
    info(`Commit declined — ${stagedCount} file(s) left staged.`);
    try { unlinkSync(msgPath); } catch { /* ignore */ }
    return;
  }

  // Task completion criteria gate: verify code-classified tasks have code file changes.
  // This prevents false completions where the agent claims code work but only
  // produced documentation or configuration changes.
  if (run.status === "completed") {
    const gateResult = validateTaskCompletion(run);
    if (!gateResult.valid) {
      // Reject completion: code-modifying tool calls made but no code file changes
      run.status = "failed";
      run.error = gateResult.reason;
      info(`\n${gateResult.reason}`);
      try { unlinkSync(msgPath); } catch { /* ignore */ }
      return;
    }
  }

  // Update PRD status and stage the change before committing.
  // This ensures the status transition and code changes are in the same commit.
  // Skip if the status was already updated early (by updateCompletedTaskStatus).
  let oldStatus: string | undefined;
  let newStatus: string | undefined;
  if (store && taskId && run.status === "completed") {
    try {
      // Capture old status before updating
      const existingItem = await store.getItem(taskId);
      oldStatus = existingItem?.status;

      // Skip the status update if already completed (idempotent)
      if (oldStatus !== "completed") {
        // Update PRD status to "completed"
        await toolRexUpdateStatus(store, taskId, { status: "completed" });
        newStatus = "completed";

        // Log the completion event
        await toolRexAppendLog(store, taskId, {
          event: "task_completed",
          detail: run.summary,
        });
      } else {
        newStatus = "completed"; // For trailer logic below
      }

      // Stage the PRD store after the status update so code and task state
      // land in the same commit. Prefer the current folder-tree store, with a
      // legacy markdown fallback for older projects.
      try {
        const rexDir = join(projectDir, ".rex");
        const prdMarkdownFilename = "prd.md";
        const prdPaths = [
          existsSync(join(rexDir, PRD_TREE_DIRNAME)) ? join(".rex", PRD_TREE_DIRNAME) : undefined,
          existsSync(join(rexDir, prdMarkdownFilename)) ? join(".rex", prdMarkdownFilename) : undefined,
        ].filter((p): p is string => Boolean(p));

        for (const prdPath of prdPaths) {
          await execStdout("git", ["add", prdPath], {
            cwd: projectDir,
            timeout: 10_000,
          });
        }
        if (prdPaths.length > 0) {
          detail(`Staged ${prdPaths.length} PRD path(s)`);
        }
      } catch (err) {
        // Best-effort: if staging fails, proceed with commit anyway
        // The status update has already been persisted to disk
        detail(`Warning: could not stage PRD files: ${(err as Error).message}`);
      }
    } catch (err) {
      // Best-effort: if PRD update fails, proceed with commit anyway
      // This prevents a failed PRD update from blocking the entire commit flow
      detail(`Warning: PRD status update failed: ${(err as Error).message}`);
    }
  }

  // Append N-DX-Status trailer if status changed
  if (oldStatus && newStatus && oldStatus !== newStatus && taskId) {
    try {
      const { writeFileSync } = await import("node:fs");
      const currentMessage = readFileSync(msgPath, "utf-8");
      // Git trailers are separated from the body by a blank line
      const separator = currentMessage.endsWith("\n\n") || currentMessage.endsWith("\n") ? "\n" : "\n\n";
      const trailer = `${separator}N-DX-Status: ${taskId} ${oldStatus} → ${newStatus}`;
      writeFileSync(msgPath, currentMessage + trailer, "utf-8");
    } catch (err) {
      // Best-effort: if trailer append fails, proceed with commit anyway
      detail(`Warning: could not add status trailer: ${(err as Error).message}`);
    }
  }

  // Append N-DX authorship trailer with vendor, model, and run ID
  try {
    const { writeFileSync } = await import("node:fs");
    const vendor = run.vendor ?? run.diagnostics?.vendor ?? "unknown";
    const model = run.model ?? "unknown";
    const runId = run.id;
    const weight = run.weight && run.weight !== "standard" ? ` (${run.weight})` : "";

    const currentMessage = readFileSync(msgPath, "utf-8");
    // Git trailers are separated from the body by a blank line
    const separator = currentMessage.endsWith("\n\n") || currentMessage.endsWith("\n") ? "\n" : "\n\n";
    const authTrailer = `${separator}N-DX: ${vendor}/${model}${weight} · run ${runId}`;
    writeFileSync(msgPath, currentMessage + authTrailer, "utf-8");
  } catch (err) {
    // Best-effort: if trailer append fails, proceed with commit anyway
    detail(`Warning: could not add authorship trailer: ${(err as Error).message}`);
  }

  // Append N-DX-Item trailer with dashboard permalink
  if (taskId) {
    try {
      const { writeFileSync } = await import("node:fs");
      const { readFileSync: readConfigFile, existsSync: pathExists } = await import("node:fs");
      const { join } = await import("node:path");

      // Load project config to get public URL
      let publicUrl = "http://localhost:3117"; // default fallback
      try {
        const configPath = join(projectDir, ".n-dx.json");
        if (pathExists(configPath)) {
          const configContent = readConfigFile(configPath, "utf-8");
          const config = JSON.parse(configContent) as Record<string, unknown>;
          const web = config["web"] as Record<string, unknown> | undefined;
          if (web && typeof web.publicUrl === "string" && web.publicUrl) {
            publicUrl = web.publicUrl;
          }
        }
      } catch {
        // Use default fallback if config read fails
        detail("Warning: could not read project config for public URL, using default");
      }

      // Build the N-DX-Item trailer URL
      const itemUrl = `${publicUrl.replace(/\/$/, "")}/#/rex/item/${taskId}`;
      const currentMessage = readFileSync(msgPath, "utf-8");
      // Git trailers are separated from the body by a blank line
      const separator = currentMessage.endsWith("\n\n") || currentMessage.endsWith("\n") ? "\n" : "\n\n";
      const itemTrailer = `${separator}N-DX-Item: ${itemUrl}`;
      writeFileSync(msgPath, currentMessage + itemTrailer, "utf-8");
    } catch (err) {
      // Best-effort: if trailer append fails, proceed with commit anyway
      detail(`Warning: could not add item permalink trailer: ${(err as Error).message}`);
    }
  }

  try {
    await execStdout("git", ["commit", "-F", PENDING_COMMIT_FILE], {
      cwd: projectDir,
      timeout: 30_000,
    });
    info(`Commit created — ${stagedCount} file(s).`);

    // Capture commit attribution and changed files after successful commit
    if (store && taskId && run.status === "completed") {
      try {
        // Get the commit SHA
        const shaOutput = await execStdout("git", ["rev-parse", "HEAD"], {
          cwd: projectDir,
          timeout: 10_000,
        });
        const sha = shaOutput.trim();

        // Capture changed files from this commit using git diff-tree
        // This provides the authoritative, deterministic list of what was actually committed
        try {
          const changes = await captureCommitChanges(sha, projectDir);
          if (run.structuredSummary && changes.length > 0) {
            // Update filesChanged with the paths
            run.structuredSummary.filesChanged = extractPaths(changes);
            run.structuredSummary.counts.filesChanged = changes.length;
            // Store the detailed status information
            run.structuredSummary.fileChangesWithStatus = formatChanges(changes);
            detail(`Captured ${changes.length} file change(s) from commit ${sha.slice(0, 7)}`);
          }
        } catch (err) {
          // Best-effort: if git diff-tree fails, proceed with attribution
          detail(`Warning: could not capture changed files: ${(err as Error).message}`);
        }

        // Get commit metadata: hash, timestamp, author, email
        const format = "%H%n%cI%n%an%n%ae";
        const metaOutput = await execStdout("git", ["log", "-1", `--format=${format}`, sha], {
          cwd: projectDir,
          timeout: 10_000,
        });
        const lines = metaOutput.trim().split("\n");
        if (lines.length >= 4) {
          const hash = lines[0];
          const timestamp = lines[1];
          const author = lines[2];
          const authorEmail = lines[3];

          // Update PRD item with commit attribution (append to commits array)
          const item = await store.getItem(taskId);
          if (item) {
            const existing = item.commits ?? [];
            // Check if this commit is already recorded (idempotent)
            if (!existing.some((c) => c.hash === hash)) {
              const updatedCommits = [
                ...existing,
                { hash, author, authorEmail, timestamp },
              ];
              await store.updateItem(taskId, { commits: updatedCommits });
              detail(`Attribution: recorded commit ${hash.slice(0, 7)}`);
            }
          }
        }
      } catch (err) {
        // Best-effort: commit attribution failure doesn't block commit flow
        detail(`Warning: could not record commit attribution: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    info(`Commit failed: ${(err as Error).message}`);
  } finally {
    try { unlinkSync(msgPath); } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// PRD task reset helper
// ---------------------------------------------------------------------------

/**
 * After a failed run, reset the active task from in_progress back to pending
 * so it reappears as actionable without manual PRD editing.
 *
 * Only resets when the task is still in_progress — specific failure handlers
 * (e.g. handleRunFailure) may have already moved it to pending or deferred,
 * in which case this is a no-op.
 *
 * Runs independently of rollbackOnFailure so the PRD is always cleaned up
 * even when git rollback is suppressed with --no-rollback.
 */
async function resetInProgressTaskIfFailed(
  store: PRDStore,
  run: RunRecord,
): Promise<void> {
  if (!FAILURE_STATUSES.has(run.status) || !run.taskId) {
    return;
  }

  const item = await store.getItem(run.taskId);
  if (!item || item.status !== "in_progress") {
    return;
  }

  await toolRexUpdateStatus(store, run.taskId, { status: "pending" });
  info(`\nTask reset to pending: [${run.taskId}] ${run.taskTitle ?? "unknown"}`);
}

// ---------------------------------------------------------------------------
// Token diagnostic helpers
// ---------------------------------------------------------------------------

/**
 * Derive the diagnostic status from per-turn token usage data.
 * Priority: unavailable > partial > complete.
 * Returns "complete" if no diagnostic statuses are set.
 */
export function deriveTokenDiagnosticStatus(turns: TurnTokenUsage[]): "complete" | "partial" | "unavailable" {
  // unavailable takes precedence
  if (turns.some((t) => t.diagnosticStatus === "unavailable")) {
    return "unavailable";
  }
  // partial takes precedence over complete
  if (turns.some((t) => t.diagnosticStatus === "partial")) {
    return "partial";
  }
  // All others (including undefined) default to complete
  return "complete";
}

/**
 * Finalize a run: build structured summary, capture memory stats,
 * run post-task tests, retrieve Codex tokens if applicable, set timestamps,
 * and persist. Called at the end of both loops.
 */
export async function finalizeRun(opts: FinalizeRunOptions): Promise<void> {
  const { run, henchDir, projectDir, config, testCommand, heartbeat, memoryCtx, selfHeal, yes, autonomous, skipFullTestGate } = opts;

  run.structuredSummary = buildRunSummary(run.toolCalls);

  // Update token diagnostic status from per-turn data
  if (run.diagnostics && run.turnTokenUsage) {
    run.diagnostics.tokenDiagnosticStatus =
      deriveTokenDiagnosticStatus(run.turnTokenUsage);
  }

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

  // Load pending dependency audit result if it exists (pre-loop audit from run.ts)
  if (selfHeal && run.structuredSummary) {
    let auditResult = undefined;
    try {
      const { readFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const auditFile = join(henchDir, ".pending-audit.json");
      const content = readFileSync(auditFile, "utf-8");
      auditResult = JSON.parse(content);
      // Delete after reading so subsequent runs don't use it
      try {
        const { unlinkSync } = await import("node:fs");
        unlinkSync(auditFile);
      } catch {
        // Ignore if we can't delete
      }
    } catch {
      // Audit file doesn't exist or can't be read
    }

    if (auditResult) {
      run.dependencyAudit = auditResult;
    }
  }

  // Discover changed files for the test gate.
  // When the agent loop produced no tool call records (e.g. Codex CLI, which
  // emits verbose text rather than structured tool events), fall back to
  // `git diff --name-only HEAD` to discover which files were actually changed.
  // This ensures the test gate runs even for vendors that do not emit
  // structured tool events. The check is vendor-agnostic and runs for all modes.
  if (run.structuredSummary && run.toolCalls.length === 0) {
    try {
      const { stdout } = await execShellCmd("git diff --name-only HEAD", {
        cwd: projectDir,
        timeout: 10_000,
      });
      const gitChangedFiles = stdout.trim().split("\n").filter(Boolean);
      if (gitChangedFiles.length > 0) {
        run.structuredSummary.filesChanged = gitChangedFiles;
        run.structuredSummary.counts = {
          ...run.structuredSummary.counts,
          filesChanged: gitChangedFiles.length,
        };
      }
    } catch {
      // Best-effort: if git is unavailable, the test gate falls back to
      // the existing filesChanged (empty), which causes it to skip.
    }
  }

  // Full test suite gate (mandatory before commit, unless skipped via flag).
  // Runs whenever the run completed successfully and gate is not explicitly skipped.
  // On failure, prompts for rerun/abort/skip actions with interactive feedback.
  let testGateSkipped = false;
  let resolvedTestCommand: string | undefined;

  if (run.status === "completed" && !skipFullTestGate && run.structuredSummary) {
    // Resolve test command first (before attempting gate)
    // This will prompt the user if no command is configured
    try {
      const resolution = await resolveTestCommand(
        {
          projectDir,
          henchDir,
          config,
        },
        autonomous,
      );
      resolvedTestCommand = resolution.command;

      if (resolution.persisted) {
        detail(`Test command persisted to config: ${resolution.command}`);
      } else if (resolution.source !== "config") {
        detail(`Using test command from ${resolution.source}: ${resolution.command}`);
      }
    } catch (err) {
      // Test command resolution failed — mark run as failed and skip gate
      run.status = "failed";
      run.error = `Test command resolution failed: ${(err as Error).message}`;
      info(`\n${run.error}`);
    }

    // Rerun loop: gate can fail and be retried multiple times
    let testGateAttempt = 0;
    let gateComplete = false;

    while (!gateComplete && testGateAttempt < 5 && run.status === "completed") {
      testGateAttempt++;
      subsection(`Full Test Suite Gate${testGateAttempt > 1 ? ` (attempt ${testGateAttempt})` : ""}`);

      const testGate = await runTestGate({
        projectDir,
        filesChanged: run.structuredSummary.filesChanged,
        testCommand: resolvedTestCommand,
      });

      run.testGate = testGate;

      if (testGate.ran) {
        const packageCount = testGate.packages.length;
        const passCount = testGate.packages.filter((p) => p.passed).length;

        if (testGate.passed) {
          stream("Test Gate", `✓ All ${packageCount} package(s) passed`);
          if (testGate.totalDurationMs != null) {
            detail(`Elapsed: ${formatDurationMs(testGate.totalDurationMs)}`);
          }
          gateComplete = true;
        } else {
          // Gate failed — prompt for action
          const failedPackages = testGate.packages.filter((p) => !p.passed).map((p) => p.name);
          stream("Test Gate", `✗ ${packageCount - passCount}/${packageCount} package(s) failed`);

          // Show failure details from first failed package
          const firstFailure = testGate.packages.find((p) => p.failureOutput);
          if (firstFailure?.failureOutput) {
            detail(firstFailure.failureOutput);
          }

          // Prompt for action
          const action = await promptTestGateFailure(testGate, yes, autonomous);

          if (action === "rerun") {
            // Loop will retry
            detail("Retrying test gate...");
          } else if (action === "skip") {
            // User chose to skip gate and continue to commit
            testGateSkipped = true;
            stream("Test Gate", "Skipped by user");
            gateComplete = true;
          } else {
            // "abort" — mark run as failed and proceed to rollback
            run.status = "failed";
            run.error = `Test gate failed: ${failedPackages.join(", ")}`;
            gateComplete = true;
          }
        }
      } else if (testGate.skipReason) {
        detail(`Skipped: ${testGate.skipReason}`);
        gateComplete = true;
      }
    }

    if (testGateAttempt >= 5) {
      info("\nTest gate max attempts reached");
      run.status = "failed";
      run.error = "Test gate max retry attempts exceeded";
    }
  }

  // Update PRD status to "completed" immediately after test gate passes.
  // This ensures status is persisted to disk before the next iteration's
  // task selection, preventing re-selection of just-completed tasks.
  if (opts.store && run.taskId && run.status === "completed") {
    const updated = await updateCompletedTaskStatus(opts.store, run.taskId, run);
    if (updated) {
      detail("Marked task as completed in PRD (before commit)");
    }
  }

  await runPostTaskTestsIfNeeded(run, projectDir, testCommand);

  // Attempt to retrieve Codex token usage from the OpenAI API after run completion.
  // This is a best-effort operation: if the API is unavailable or returns zero data,
  // we silently skip and use the tokens already captured during the run.
  // Only attempt if this was a Codex run (vendor is "codex" in turnTokenUsage).
  await retrieveCodexTokensIfNeeded(run, projectDir);

  // Validate token reporting for Codex runs.
  // This is a non-blocking post-run check that logs warnings but never fails the run.
  validateRunTokensPostRun(run, true);

  // Prompt the user to commit staged changes using the agent's proposed message.
  // No-op when autoCommit is true (agent committed itself) or on failure paths.
  // The approval prompt is bypassed in autonomous mode (--auto, --loop) so
  // unattended runs do not stall waiting for user input.
  // The store and taskId are passed so that the PRD status transition can be
  // staged alongside code changes and included in the same commit.
  await performCommitPromptIfNeeded(
    run,
    projectDir,
    opts.autoCommit === true,
    opts.yes,
    opts.autonomous,
    opts.store,
    run.taskId,
  );

  // Rollback uncommitted changes when the run failed (unless suppressed).
  // Runs after test gates so the working tree reflects the agent's final state.
  // Skips silently when nothing is dirty (no-op for already-clean trees).
  if (opts.rollbackOnFailure !== false && FAILURE_STATUSES.has(run.status)) {
    await performRollbackIfNeeded(projectDir, opts.yes);
  }

  // Reset task to pending when run failed and task is still in_progress.
  // Runs independently of rollbackOnFailure — PRD cleanup always occurs.
  // A no-op when a specific failure handler already moved the task to
  // pending or deferred.
  if (opts.store) {
    await resetInProgressTaskIfFailed(opts.store, run);
  }

  run.finishedAt = new Date().toISOString();
  run.lastActivityAt = run.finishedAt;
  await saveRun(henchDir, run);

  // Persist full run output to .run-logs/ at the project root.
  // Best-effort: a log write failure must not crash the run.
  const logLines = getCapturedLines();
  try {
    const logPath = await persistRunLog(projectDir, run.id, run.startedAt, logLines);
    info(`\nRun log: ${logPath}`);
  } catch {
    // Swallow — log persistence is optional; the run result stands.
  }
  resetCapturedLines();
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
