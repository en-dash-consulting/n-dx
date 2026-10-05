import { join } from "node:path";
import { createInterface } from "node:readline";
import { readFileSync, existsSync } from "node:fs";
import { resolveStore, findNextTask, findActionableTasks as findActionable, findItem, collectCompletedIds, isRootLevel, isWorkItem, checkTreeConformance, takeSaveFileReport, matchesAssignee, PRD_TREE_DIRNAME, SCHEMA_VERSION, SELF_HEAL_TAG, resolveActor, traversalBlock } from "../../prd/rex-gateway.js";
import type { PRDItem, PRDStore, TraversalBlock } from "../../prd/rex-gateway.js";
import { collectEpicTaskIds as collectEpicTasks } from "../../agent/planning/brief.js";
import type { PermissionMode, RunRecord, ToolCallRecord } from "../../schema/index.js";
import { PERMISSION_MODES, isPermissionMode } from "../../schema/index.js";
import { classifyChangedFiles } from "../../store/file-classifier.js";
import type { FileCategory } from "../../store/file-classifier.js";
import { loadConfig } from "../../store/config.js";
import { listRuns } from "../../store/runs.js";
import { agentLoop } from "../../agent/lifecycle/loop.js";
import { cliLoop } from "../../agent/lifecycle/cli-loop.js";
import { performPreRunCommitGateIfNeeded, commitResetDeferredChanges } from "../../agent/lifecycle/shared.js";
import {
  PRD_COMMIT_PATHS,
  deletedAmong,
  findUncommittedWork,
  formatLoopRefusal,
  formatResetDeferredCommitSkipped,
  listUncommittedPrdPaths,
  prepareRecoveryPathspecs,
} from "../../agent/lifecycle/uncommitted-work-gate.js";
import { captureRunGitOrigin } from "../../process/git-origin.js";
import { TaskClaims } from "../../process/task-claims.js";
import {
  findShadowingRegistrations,
  formatShadowingWarning,
} from "../../process/claude-mcp-registration.js";
import { resolveLauncherCli } from "../../process/agent-mcp-config.js";
import { getActionableTasks, collectEpicTaskIds } from "../../agent/planning/brief.js";
import { getStuckTaskIds } from "../../agent/analysis/stuck.js";
import { formatRunReviewStatus } from "../../agent/analysis/adversarial-review.js";
import { safeParseInt, safeParseNonNegInt } from "./constants.js";
import { resolveHenchPaths } from "../../store/paths.js";
import { ConsecutiveFailureCounter, isFailureStatus } from "./consecutive-failures.js";
import { CLIError, EpicNotFoundError, requireLLMCLI } from "../errors.js";
import { offerSlugMigration } from "../slug-migration-offer.js";
import { info, result as output, setQuiet, warn } from "../output.js";
import { applyRepoTrust, formatTrustWarningForRun } from "../../store/trust.js";
import { evaluateRepoTrust } from "../../prd/llm-gateway.js";
import { section, detail } from "../../types/output.js";
import { clearSessionCache } from "../../agent/lifecycle/session-cache.js";
import {
  trimDocument,
  MAX_CONTEXT_FILE_CHARS,
} from "../../agent/planning/context-caps.js";
import { loadLLMConfig, resolveLLMVendor, resolveVendorCliPath } from "../../store/project-config.js";
import type { LLMVendor } from "../../prd/llm-gateway.js";
import { LLM_VENDOR, printVendorModelHeader, resolveModel, bold, green, red, colorStatus, colorSuccess, colorWarn, colorPink, isColorEnabled, createSpinner } from "../../prd/llm-gateway.js";
import { resolveAgentModel } from "./agent-model.js";
import { isProviderSupported } from "./provider-support.js";
import { ExecutionQueue } from "../../queue/execution-queue.js";
import { formatQueueStatus } from "../../queue/format.js";
import { resolveSchedulingPriority } from "../../queue/priority-scheduler.js";
import type { TaskPriority } from "../../queue/execution-queue.js";
import { ProcessLimiter } from "../../process/limiter.js";
import { MemoryThrottle } from "../../process/memory-throttle.js";
import { checkQuotaRemaining, formatQuotaLog } from "../../quota/index.js";
import { formatTokenReport } from "../token-logging.js";
import { formatSessionDecision } from "../session-report.js";

// ---------------------------------------------------------------------------
// Attempt tracking (per-task within a single run invocation)
// ---------------------------------------------------------------------------

/**
 * Tracks attempt count per task ID within a single run invocation.
 * After 3 attempts of the same task, the task is forced to be excluded
 * from subsequent selection in the same run.
 */
export interface AttemptTracker {
  /** Increment and return the new count for the given task ID. */
  incrementAndGetCount(taskId: string): number;
  /** Get the current count for a task ID (0 if never attempted). */
  getCount(taskId: string): number;
  /** Check if a task has reached the maximum of 3 attempts. */
  hasReachedMaxAttempts(taskId: string): boolean;
}

/**
 * The two independent review controls, bundled so the run functions keep a
 * single positional slot for them.
 *
 * They are genuinely independent and may both be on. The adversarial pass runs
 * first, so its must-fix repairs are already in the tree when the diff gate
 * shows a human what they are approving.
 */
export interface ReviewOptions {
  /** `--approve-diff` — show the diff and prompt before finalizing. */
  approveDiff: boolean;
  /** `--review` — run the adversarial review pass after validation. */
  reviewPass: boolean;
  /** `--review-model` — override the model the reviewer runs on. */
  reviewModel?: string;
  /**
   * `--review-optional` — downgrade the missing-review gate to a warning.
   *
   * Off by default: `--review` is an opt-in gate, and a gate that silently
   * no-ops when its reviewer cannot start is worse than no gate at all.
   */
  reviewOptional: boolean;
}

const MAX_TASK_ATTEMPTS = 3;

/**
 * Create an attempt tracker for a single run invocation.
 * Counter resets between separate `ndx run` invocations.
 */
export function createAttemptTracker(): AttemptTracker {
  const counts = new Map<string, number>();

  return {
    incrementAndGetCount(taskId: string): number {
      const current = counts.get(taskId) ?? 0;
      const newCount = current + 1;
      counts.set(taskId, newCount);
      return newCount;
    },
    getCount(taskId: string): number {
      return counts.get(taskId) ?? 0;
    },
    hasReachedMaxAttempts(taskId: string): boolean {
      return (counts.get(taskId) ?? 0) >= MAX_TASK_ATTEMPTS;
    },
  };
}

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

/**
 * Format an inter-task or inter-epic pause notification.
 * Rendered in yellow (colorWarn) to signal a transient wait state.
 * Exported for testing — verifies semantic color helpers are applied.
 */
export function formatPauseMessage(pauseMs: number, target: "task" | "epic"): string {
  return colorWarn(`Pausing ${pauseMs}ms before next ${target}...`);
}

/**
 * Format a run-loop completion message.
 * Rendered in green (colorSuccess) to confirm a clean exit.
 * Exported for testing — verifies semantic color helpers are applied.
 */
export function formatRunSuccessMessage(text: string): string {
  return colorSuccess(text);
}

/**
 * Format a loop-iteration boundary separator line.
 *
 * Rendered in yellow (colorWarn) to visually distinguish loop-iteration
 * boundaries from the carolinaBlue ═══ agent-turn section separators.  Width matches
 * SECTION_WIDTH (60 chars) for visual consistency with the rest of the
 * transcript.
 *
 * Fully suppressed (returns plain text that callers skip via NO_COLOR / !isTTY
 * checks in colorWarn) when color is disabled.
 * Exported for testing — verifies colorWarn is applied and suppression works.
 */
export function formatLoopIterationSeparator(): string {
  return colorWarn("─".repeat(60));
}

/**
 * Format the iteration boundary banner emitted between loop iterations.
 *
 * - Fixed mode (--iterations=N): `=== Iteration n/total ===`
 * - Unbounded mode (--loop):     `=== Iteration n ===`
 *
 * Uses bold() so it stands out against surrounding transcript lines and
 * respects NO_COLOR (bold() degrades to plain text when color is disabled).
 * Exported for testing.
 */
export function formatIterationBanner(n: number, total?: number): string {
  const label = total !== undefined ? `${n}/${total}` : `${n}`;
  return bold(`=== Iteration ${label} ===`);
}

/**
 * Format a "no actionable tasks" advisory block for epic scope mode.
 * All three lines are rendered in yellow (colorWarn) to signal an advisory
 * state without alarming the user.
 * Exported for testing — verifies semantic color helpers are applied.
 */
export function formatNoActionableTasksWarning(epicTitle: string, blockedCount: number): [string, string, string] {
  return [
    colorWarn(`\n⚠ Epic "${epicTitle}" has no actionable tasks.`),
    colorWarn(`  ${blockedCount} task(s) are blocked or deferred.`),
    colorWarn(`  Use 'rex status' to see task statuses, or update tasks with 'rex update <id> --status=pending'.`),
  ];
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
  /**
   * How many tasks in this epic the task selector would actually hand back.
   *
   * Counted with the selector itself rather than by re-reading each task's
   * status, because the two disagree. A task is unreachable when anything
   * above it is blocked, cancelled, deleted, or waiting on an unfinished
   * `blockedBy` — the selector prunes the whole subtree at that point, while a
   * per-item status count sees a tree full of pending work.
   *
   * That divergence is what made `--epic-by-epic` look like it only validated
   * epics: it announced "Starting: N actionable task(s)" from the status
   * count, the selector then found nothing, and the epic was recorded
   * `no_actionable_tasks` without a single task running. Every epic in the
   * PRD did this in turn, so the whole invocation printed headers and a
   * summary and ran no work at all.
   */
  actionableTasks: number;
  /** True if all tasks are completed (or epic has no tasks). */
  isComplete: boolean;
  /** True if there are actionable tasks to work on. */
  hasActionableTasks: boolean;
  /**
   * Why the epic as a whole is unreachable, when it is — the epic item's own
   * {@link traversalBlock}. Set even if tasks beneath it are pending, which is
   * exactly the case the operator cannot otherwise explain: every task says
   * "pending" and nothing runs.
   */
  scopeBlock?: TraversalBlock;
}

/**
 * Why an epic is being skipped, as the epic-by-epic run says it.
 *
 * The old line was `has no actionable tasks (N blocked/deferred)`, derived
 * from the status counts. When the gate is the epic *itself* — it is blocked,
 * or waiting on another epic — that sentence is unanswerable: every task under
 * it reads `pending` in `rex status`, so the operator is told there is no work
 * in a place that visibly has some, with nothing naming the thing in the way.
 *
 * Exported for testing: the explanation is the whole point of the change, and
 * the loop that prints it needs a live PRD to reach.
 */
export function formatEpicSkipLines(scope: EpicScopeInfo): string[] {
  const remaining = scope.totalTasks - scope.completedTasks;
  const block = scope.scopeBlock;

  if (block?.cause === "status") {
    return [
      `⚠ Epic "${scope.title}" is ${block.status}, so none of its ${remaining} remaining task(s) can be selected.`,
      `  Set it to pending with 'rex update ${scope.id} --status=pending' to work it.`,
    ];
  }
  if (block?.cause === "blockedBy") {
    return [
      `⚠ Epic "${scope.title}" is waiting on ${block.openBlockerIds.join(", ")}, ` +
        `so none of its ${remaining} remaining task(s) can be selected.`,
      `  It becomes workable once those complete.`,
    ];
  }
  return [`⚠ Epic "${scope.title}" has no actionable tasks (${remaining} blocked/deferred).`];
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
  // The epic's own node, for the scope-level block below. `findEpicByIdOrTitle`
  // answers identity (it accepts a title), not the item.
  const epicItem = findItem(doc.items, resolvedEpicId)?.item;
  if (!epicItem) {
    throw new EpicNotFoundError(epicId, listEpics(doc.items));
  }

  // Walk the tree and count tasks belonging to this epic
  const { walkTree } = await import("../../prd/rex-gateway.js");

  let totalTasks = 0;
  let completedTasks = 0;

  for (const { item, parents } of walkTree(doc.items)) {
    // Check if this item is inside the target epic
    const isInEpic =
      item.id === resolvedEpicId ||
      parents.some((p) => p.id === resolvedEpicId);

    if (isInEpic && isWorkItem(item.level)) {
      // Deleted items are excluded from all counts
      if (item.status === "deleted") continue;
      totalTasks++;
      if (item.status === "completed") completedTasks++;
    }
  }

  // The actionable count comes from the selector, not from a second reading of
  // each task's status — see the field's doc comment. This is the same
  // intersection the autonomous epic path computes in `prepareBrief`, so the
  // number announced before an epic starts is the number the loop will find.
  // Run-specific exclusions (stuck tasks, tasks another worktree holds) are
  // deliberately left out: "there is work here, but this run is skipping it"
  // is a different statement, and the loop reports it separately.
  const completedIds = collectCompletedIds(doc.items);
  const epicTaskIds = collectEpicTasks(doc.items, resolvedEpicId);
  const actionableTasks = findActionable(doc.items, completedIds, Infinity, {})
    .filter((entry) => epicTaskIds.has(entry.item.id)).length;

  const isComplete = totalTasks === 0 || completedTasks === totalTasks;
  const hasActionableTasks = actionableTasks > 0;
  const scopeBlock = traversalBlock(epicItem, completedIds);

  return {
    id: epic.id,
    title: epic.title,
    totalTasks,
    completedTasks,
    actionableTasks,
    isComplete,
    hasActionableTasks,
    ...(scopeBlock ? { scopeBlock } : {}),
  };
}

// ---------------------------------------------------------------------------
// Deferred/failing task reset (--reset-deferred)
// ---------------------------------------------------------------------------

/**
 * Count tasks with a given set of statuses (across the full tree).
 *
 * `assignee` is the `--mine` identity. When set, only items that identity owns
 * — by their own `assignee` or an ancestor's, per {@link matchesAssignee} — are
 * counted. The count is what the reset offer quotes and what it then resets, so
 * an unscoped count under `--mine` offered to reset the whole PRD.
 *
 * Exported for testing: the number shown in that offer is half of what makes it
 * safe, and it is not otherwise reachable.
 */
export function countTasksByStatus(items: PRDItem[], statuses: string[], assignee?: string): number {
  const statusSet = new Set(statuses);
  let count = 0;
  const walk = (list: PRDItem[], parents: PRDItem[]) => {
    for (const item of list) {
      if (
        statusSet.has(item.status) &&
        (!assignee || matchesAssignee(item, parents, assignee))
      ) {
        count++;
      }
      if (item.children) walk(item.children, [...parents, item]);
    }
  };
  walk(items, []);
  return count;
}

/**
 * Refuse the run when this build's first PRD write would re-slug the tree.
 *
 * An autonomous run is a PRD writer: it records the status transition when it
 * finishes the task. So a run started with a build whose slug rule disagrees
 * with the tree does not merely fail — it succeeds, and ships a whole-tree
 * rewrite inside a feature branch under a "task completed" message. That is
 * the 2026-09-17 incident (1,570 renamed files) with the agent as the sweeper.
 *
 * The store's write guard would refuse that write, but only after the run had
 * claimed the task, spent its tokens and edited the code. This gate asks the
 * same question first, and answers it by not starting.
 *
 * There is deliberately **no override flag**. A sweep is never an acceptable
 * thing to do from inside a run, so an escape hatch would only ever be used to
 * cause the damage the gate exists to prevent; the fix is always
 * `rex migrate-slugs` on the default branch, run on its own.
 *
 * Applies to `--dry-run` too: a preview whose refusal is hidden is a preview
 * that tells you the run would have worked.
 *
 * @throws {CLIError} When the tree does not match this build's slug rule.
 */
export async function assertPrdTreeConformant(rexDir: string): Promise<void> {
  const refusal = await readTreeConformanceRefusal(rexDir);
  if (refusal) throw treeConformanceError(refusal);
}

/**
 * The gate's refusal, named structurally from the gateway function that
 * produces it.
 *
 * Derived rather than re-exported as a nominal type through
 * `prd/rex-gateway.ts`, which keeps the gateway's surface — and its export cap
 * — for symbols that are actually called. It cannot drift from rex's
 * definition, because it *is* rex's definition.
 */
type TreeRefusal = NonNullable<Awaited<ReturnType<typeof checkTreeConformance>>>;

/**
 * The read half of {@link assertPrdTreeConformant}: why this build must not
 * write the tree, or `null` when it may.
 *
 * Split out because the refusal object carries more than its message — the
 * offending paths a migration would rename, and whether a migration is the
 * command that fixes it at all. The interactive gate in `cmdRun` offers to run
 * that migration and needs both; `assertPrdTreeConformant` still exists for the
 * callers that only need the throw.
 */
export async function readTreeConformanceRefusal(
  rexDir: string,
): Promise<TreeRefusal | null> {
  const treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  // No folder tree, nothing to be non-conformant. Checked before the load
  // because loading a project that has no PRD at all throws, and reporting
  // that is the job of the task selection this gate runs ahead of.
  if (!existsSync(treeRoot)) return null;

  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  return await checkTreeConformance(rexDir, treeRoot, doc.items);
}

/**
 * The refusal the gate throws, optionally saying why a migration offer was
 * withheld.
 *
 * `withheldNote` is appended rather than replacing the standing advice: the
 * operator still has to be told what the tree's problem is and that nothing was
 * claimed, and "you were not offered the fix" is an extra fact about *this*
 * run, not a different diagnosis of the repository.
 */
export function treeConformanceError(
  refusal: TreeRefusal,
  withheldNote?: string,
): CLIError {
  return new CLIError(
    refusal.message,
    "This run would write the PRD when it completed the task, carrying the rewrite " +
      "into your branch under a 'task completed' commit. Nothing has been claimed or " +
      "written. Migrate the tree on the default branch, then start the run again." +
      (withheldNote ? `\n\n${withheldNote}` : ""),
  );
}

/** Re-checks the PRD tree before a task starts. @see createPerTaskTreeGate */
export type PerTaskTreeGate = () => Promise<void>;

/**
 * The per-task form of {@link assertPrdTreeConformant}, run at the top of
 * `runOne` so every task in an invocation is gated, not only the first.
 *
 * The pre-flight check answers the question once, before the run begins. A
 * `--loop` or `--epic-by-epic` invocation outlives that answer: another
 * worktree writes the tree, an operator pulls, a migration lands, and from the
 * second task onward the run is working against a tree nobody asked about
 * again. Its own completion write then re-slugs whatever drifted — the run
 * becomes the sweeper, which is the thing the gate exists to prevent.
 *
 * Placed inside `runOne` rather than in the three loop bodies deliberately.
 * `runOne` is the single funnel — `runIterations`, `runLoop` and
 * `runEpicByEpic` each call it, and a fix applied at the loops would cover
 * some call sites and leave others unguarded while still passing a test
 * written against the covered one.
 *
 * `alreadyChecked` is consumed once: `cmdRun` runs the pre-flight check before
 * the commit gate and before `--reset-deferred` (both of which must not happen
 * ahead of a refusal), so the first task is already covered and re-parsing the
 * tree for it would double a single-task run's cost for nothing. Every task
 * after the first re-checks.
 *
 * @param rexDir The `.rex` directory to re-check.
 * @param alreadyChecked True when the caller already ran the pre-flight check.
 */
export function createPerTaskTreeGate(
  rexDir: string,
  alreadyChecked = false,
): PerTaskTreeGate {
  let satisfiedByPreflight = alreadyChecked;
  return async () => {
    if (satisfiedByPreflight) {
      satisfiedByPreflight = false;
      return;
    }
    await assertPrdTreeConformant(rexDir);
  };
}

/**
 * Warn when a local-scope Claude MCP registration pins this repository's rex or
 * sourcevision server to a different checkout than the run will execute in.
 *
 * A warning, not a refusal: the registration is the operator's machine-local
 * configuration, it may be deliberate, and a run that cannot start because of a
 * file outside the repository would be worse than one that says what it found.
 *
 * Silent only when the run will actually override the entry: a Claude run that
 * could resolve the CLI which launched it passes its own `--mcp-config` with
 * `--strict-mcp-config` and does not inherit the registration at all. Warning
 * there would describe a hazard the run has already closed.
 *
 * Everything else still inherits and still has to be told — Codex, whose
 * adapter has no equivalent flag; a standalone `hench run`, which has no
 * launcher CLI to build the config from; and the operator's own interactive
 * sessions, which no run controls.
 *
 * Never throws: a detector that failed a run would be a worse defect than the
 * one it reports.
 *
 * @param projectDir The directory the run will execute in.
 * @param vendor The resolved LLM vendor for this run.
 */
export async function warnOnShadowingMcpRegistration(
  projectDir: string,
  vendor: LLMVendor,
): Promise<void> {
  if (vendor === LLM_VENDOR.CLAUDE && resolveLauncherCli().usable) return;

  let lines: string[];
  try {
    lines = formatShadowingWarning(projectDir, await findShadowingRegistrations(projectDir));
  } catch {
    return;
  }
  for (const line of lines) info(colorWarn(line));
}

export interface ResetDeferredOptions {
  /**
   * List what would be reset and write nothing.
   *
   * A dry run must leave the working tree exactly as it found it. The commit
   * that normally lands the reset is skipped on a dry run, so a reset that
   * still wrote would leave `.rex/prd_tree/` dirty — and the next *real*
   * autonomous run would then refuse to start against dirt that a
   * `--dry-run` produced.
   */
  dryRun?: boolean;
  /**
   * Restrict the reset to items this identity owns (`--mine`), by their own
   * `assignee` or an ancestor's.
   *
   * Without it, the reset offered when a `--mine` menu comes back empty reset
   * every deferred and failing task in the PRD — other people's included, and
   * committed under this operator's name. A filter that narrows what you are
   * shown must narrow what you act on.
   */
  assignee?: string;
}

/**
 * Reset deferred and failing tasks to pending so they can be retried.
 *
 * Used by --reset-deferred to let the user restart a run where all tasks
 * failed (e.g. after fixing LM Studio context window size). Returns the
 * number of tasks that were reset (or, on a dry run, would be reset).
 * Scoped to {@link ResetDeferredOptions.assignee} when one is given.
 */
export async function resetDeferredTasks(
  store: PRDStore,
  opts: ResetDeferredOptions = {},
): Promise<number> {
  const doc = await store.loadDocument();
  const toReset: Array<{ id: string; title: string }> = [];
  const assignee = opts.assignee;

  const walk = (items: PRDItem[], parents: PRDItem[]) => {
    for (const item of items) {
      if (
        (item.status === "deferred" || item.status === "failing") &&
        (!assignee || matchesAssignee(item, parents, assignee))
      ) {
        toReset.push({ id: item.id, title: item.title });
      }
      if (item.children) walk(item.children, [...parents, item]);
    }
  };
  walk(doc.items, []);

  if (!opts.dryRun) {
    for (const t of toReset) {
      await store.updateItem(t.id, { status: "pending" });
    }
  }

  if (toReset.length > 0) {
    const verb = opts.dryRun ? "Would reset" : "Reset";
    info(`\n${verb} ${toReset.length} task(s) to pending:`);
    for (const t of toReset) info(`  ${colorStatus("pending", "○")} ${t.id}: ${t.title}`);
  }

  return toReset.length;
}

/**
 * `--reset-deferred` end to end: reset the deferred/failing tasks and land
 * that write, so the pre-run commit gate sees a tree this call left clean.
 *
 * The commit is conditional, and the condition is measured *before* the reset
 * writes anything. {@link commitResetDeferredChanges} stages `.rex/prd_tree`
 * wholesale — it cannot tell the reset's own write from an operator edit
 * already sitting there — so on a tree that was already dirty it would commit
 * the operator's half-finished work under "reset N deferred/failing task(s)",
 * with hench's Co-Authored-By trailer, before the gate ever saw it. In a TTY,
 * with no prompt.
 *
 * When that is the case the reset still happens (it is what the flag is for)
 * but nothing is committed: the pre-run gate then reports the whole dirty tree
 * and refuses, which is exactly what the operator got before #365.
 *
 * On a dry run nothing is written and nothing is committed.
 *
 * {@link ResetDeferredOptions.assignee} is forwarded whole. Rebuilding the
 * options here as `{ dryRun }` silently unscoped `ndx work --mine
 * --reset-deferred` back to the entire PRD — the very defect the option was
 * added to close, reintroduced one call below it. Pass `opts` through.
 *
 * @returns the number of tasks reset, or that would be reset on a dry run
 */
export async function resetDeferredAndCommit(
  store: PRDStore,
  projectDir: string,
  opts: ResetDeferredOptions = {},
): Promise<number> {
  const dryRun = Boolean(opts.dryRun);
  // Before the reset, deliberately: afterwards the reset's own write is
  // indistinguishable from anything that was already there.
  const prdDirtyBeforeReset = dryRun ? [] : await listUncommittedPrdPaths(projectDir);

  const resetCount = await resetDeferredTasks(store, opts);
  if (resetCount === 0) {
    info("\nNo deferred or failing tasks to reset.");
    return 0;
  }
  if (dryRun) return resetCount;

  if (prdDirtyBeforeReset.length > 0) {
    const deleted = deletedAmong(projectDir, prdDirtyBeforeReset);
    info(formatResetDeferredCommitSkipped(
      prdDirtyBeforeReset,
      deleted,
      await prepareRecoveryPathspecs(projectDir, prdDirtyBeforeReset, deleted),
    ));
    return resetCount;
  }

  // Commit the reset's own PRD-tree write immediately so the pre-run commit
  // gate sees a clean tree instead of refusing the very run --reset-deferred
  // exists to resume (GitHub #365). The save report is drained here so the
  // commit stages exactly the files the per-task resets wrote — the store
  // saves once per reset task, and the report accumulates across them.
  const commitResult = await commitResetDeferredChanges(
    projectDir,
    resetCount,
    takeSaveFileReport(store),
  );
  if (commitResult.error) {
    throw commitResult.error;
  }
  return resetCount;
}

// ---------------------------------------------------------------------------
// --mine: empty-result reporting
// ---------------------------------------------------------------------------

/**
 * How many tasks selection would offer with `--mine` dropped.
 *
 * "Nothing assigned to you" and "nothing left to do" are different situations
 * with the same empty list, and the operator cannot tell them apart. Neither
 * can they check the filter they never typed: `--mine` resolves an identity
 * through `resolveActor` (git `user.email`, else the OS username), and a run
 * that matches nothing is most often an identity that does not match how the
 * items were actually stamped.
 */
async function countActionableIgnoringAssignee(
  store: PRDStore,
  epicId?: string,
): Promise<number> {
  const doc = await store.loadDocument();
  const completedIds = collectCompletedIds(doc.items);
  const entries = findActionable(doc.items, completedIds, Infinity);
  if (!epicId) return entries.length;
  const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
  return entries.filter((e) => epicTaskIds.has(e.item.id)).length;
}

/**
 * The lines shown when `--mine` matches nothing. Exported for tests: the
 * identity and the unfiltered count are the whole content of the message, and
 * a reworded sentence that drops either one puts the operator back where they
 * started.
 *
 * @param scope trailing scope phrase, e.g. `" in epic"` — `""` for the whole PRD.
 */
export function formatNoAssignedTasksLines(
  assignee: string,
  unfilteredCount: number,
  scope = "",
): string[] {
  const lines = [`No actionable tasks assigned to ${assignee}${scope}.`];
  lines.push(
    unfilteredCount > 0
      ? `  ${unfilteredCount} actionable task(s) exist without --mine. ` +
        `Drop --mine to see them, or check that items are assigned to this exact identity.`
      : `  No actionable tasks exist without --mine either.`,
  );
  return lines;
}

/**
 * The lines `--loop` prints when it runs out of the identity's tasks.
 *
 * Separate from {@link formatNoAssignedTasksLines} because the loop has a
 * count of its own to report, and exported for the same reason: built inline
 * at the call site, the one thing this message must never say — "All tasks
 * complete", which is what it said when `--mine` matched nothing on the first
 * iteration — was asserted by no test at all, and deleting the branch left the
 * suite green.
 *
 * @param processedCount tasks this loop actually ran before running out.
 * @param scope trailing scope phrase, e.g. `" in epic"` — `""` for the whole PRD.
 */
export function formatMineLoopCompletionLines(
  assignee: string,
  processedCount: number,
  unfilteredCount: number,
  scope = "",
): string[] {
  return [
    `No tasks assigned to ${assignee}${scope} remain — ` +
      `loop finished after ${processedCount} task(s).`,
    unfilteredCount > 0
      ? `  ${unfilteredCount} actionable task(s) remain without --mine.`
      : `  No actionable tasks remain without --mine either.`,
  ];
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
// Quota log helper (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Fetch remaining quota and emit ANSI-colored log lines at the inter-run
 * boundary.
 *
 * - If `checkQuotaRemaining()` returns data, each entry is formatted and
 *   emitted via `info()`, which suppresses output in quiet/JSON mode.
 * - If the fetch throws, a single degraded indicator is emitted instead
 *   of crashing the loop.
 * - An empty result (no quota data available) produces no output.
 */
export async function emitQuotaLog(): Promise<void> {
  let quotas: Awaited<ReturnType<typeof checkQuotaRemaining>>;
  try {
    quotas = await checkQuotaRemaining();
  } catch {
    info("quota: unavailable");
    return;
  }
  for (const line of formatQuotaLog(quotas)) {
    info(line);
  }
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
  tags?: string[],
  assignee?: string,
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

  const selectOptions = (tags?.length || assignee)
    ? { ...(tags?.length ? { tags } : {}), ...(assignee ? { assignee } : {}) }
    : undefined;

  if (epicId) {
    // Use the same logic as assembleTaskBrief for epic-scoped selection
    const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
    const allActionable = findActionable(doc.items, skipIds, Infinity, selectOptions);
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
    const next = findNextTask(doc.items, skipIds, selectOptions);
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
  assignee?: string,
): Promise<string> {
  const store = await resolveStore(rexDir);
  // Tasks another worktree is working on are left off the menu.
  const claims = TaskClaims.forProject(dir);
  // `assignee` is --mine: the menu is the attended path's whole selection, so
  // an unfiltered menu here is the flag silently doing nothing.
  let tasks = await getActionableTasks(store, undefined, claims, assignee);

  // Filter to tasks within the specified epic if provided
  if (epicId) {
    const doc = await store.loadDocument();
    const epicTaskIds = collectEpicTaskIds(doc.items, epicId);
    tasks = tasks.filter((t) => epicTaskIds.has(t.id));
  }

  if (tasks.length === 0) {
    if (assignee) {
      // Name the identity `resolveActor` produced and say what dropping the
      // filter would find. "No actionable tasks found in PRD" under --mine
      // described the wrong thing entirely.
      const scope = epicId ? " in the specified epic" : "";
      for (const line of formatNoAssignedTasksLines(
        assignee,
        await countActionableIgnoringAssignee(store, epicId),
        scope,
      )) {
        output(line);
      }
    } else {
      const scope = epicId ? "within the specified epic" : "in PRD";
      output(`No actionable tasks found ${scope}.`);
    }
    // Check for deferred/failing tasks and offer to reset them interactively.
    // Under --mine both the count and the reset are scoped to the identity —
    // an offer phrased against the filtered menu must not act outside it.
    const doc = await store.loadDocument();
    const deferredCount = countTasksByStatus(doc.items, ["deferred", "failing"], assignee);
    if (deferredCount > 0 && process.stdin.isTTY) {
      const whose = assignee ? ` assigned to ${assignee}` : "";
      output(colorWarn(`  ${deferredCount} task(s)${whose} are deferred or failing.`));
      const answer = await promptUser("  Reset them to pending and continue? [y/N] ");
      if (answer.toLowerCase() === "y" || answer.toLowerCase() === "yes") {
        await resetDeferredTasks(store, assignee ? { assignee } : {});
        // Reload tasks after reset
        tasks = await getActionableTasks(store, undefined, claims, assignee);
        if (epicId) {
          const freshDoc = await store.loadDocument();
          const epicTaskIds = collectEpicTaskIds(freshDoc.items, epicId);
          tasks = tasks.filter((t) => epicTaskIds.has(t.id));
        }
        if (tasks.length === 0) {
          output("Still no actionable tasks after reset.");
          process.exit(0);
        }
      } else {
        process.exit(0);
      }
    } else if (deferredCount > 0) {
      const whose = assignee ? ` assigned to ${assignee}` : "";
      const retryCmd = assignee ? "ndx work --mine --reset-deferred" : "ndx work --reset-deferred";
      output(colorWarn(
        `  ${deferredCount} task(s)${whose} are deferred or failing — ` +
        `run '${retryCmd}' to reset them and retry.`,
      ));
      process.exit(0);
    } else {
      process.exit(0);
    }
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
 *   "Changes: 2 commits"
 *   "Changes: 7 uncommitted paths"
 *   "Changes: 1 commit, 1 uncommitted path"
 *
 * `commits` and `uncommittedPaths` are both authoritative over the
 * toolCalls-derived heuristic below, which only recognizes changes it can
 * infer from tool calls: a run can land a commit it does not recognize (no
 * `rex_update`/`rex_add` tool call, e.g. a bookkeeping-only commit), and a
 * run driven through a CLI provider can edit seven files without the
 * heuristic seeing one of them. Reporting "none" in either case is the bug
 * this guards — "none" is printed only when no source found anything, which
 * means no commit landed and the tree came out clean.
 *
 * Exported for testing.
 */
export function formatChangeClassification(
  toolCalls: ToolCallRecord[],
  commits?: RunRecord["commits"],
  uncommittedPaths?: RunRecord["uncommittedPaths"],
): string {
  const classified = classifyChangedFiles(toolCalls);
  const prdUpdate = hasPrdStatusUpdate(toolCalls);
  const commitCount = commits?.length ?? 0;
  const uncommittedCount = uncommittedPaths?.length ?? 0;

  // Remove metadata from the classified map for display purposes
  // (metadata = prd.json, shown separately as "PRD status update")
  classified.delete("metadata");

  const totalFiles = [...classified.values()].reduce((sum, files) => sum + files.length, 0);

  if (totalFiles === 0 && prdUpdate) {
    return "Changes: PRD status update only (no code changes)";
  }

  if (totalFiles === 0 && !prdUpdate) {
    const parts: string[] = [];
    if (commitCount > 0) {
      parts.push(`${commitCount} commit${commitCount === 1 ? "" : "s"}`);
    }
    if (uncommittedCount > 0) {
      parts.push(`${uncommittedCount} uncommitted path${uncommittedCount === 1 ? "" : "s"}`);
    }
    if (parts.length === 0) return "Changes: none";
    return `Changes: ${parts.join(", ")}`;
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
// Run outcome — distinguish work failure from record (bookkeeping) failure
// ---------------------------------------------------------------------------

/**
 * The three outcomes a finished run can report. `run.status` alone cannot
 * carry the third: a run whose work landed but whose follow-up PRD record
 * commit failed stays `"completed"` with `recordCommitPending` set (records
 * from before WM2085 read `"failed"` with a boolean flag instead, which
 * printed "Status: failed" beside "Summary: Task complete" — a bookkeeping
 * failure reading as a failed task).
 */
export type RunOutcome = "work_failed" | "work_completed" | "work_completed_record_pending";

/**
 * Classify a finished run into one of the three outcomes. Reads
 * `run.recordCommitPending` before `run.status` so the pending-record case is
 * told apart from a genuine task failure — necessary for legacy records,
 * where a record-commit failure also flipped `status` to `"failed"`.
 * Exported for testing.
 */
export function classifyRunOutcome(run: RunRecord): RunOutcome {
  if (run.recordCommitPending) return "work_completed_record_pending";
  return run.status === "completed" ? "work_completed" : "work_failed";
}

/**
 * Format the run's "Status:" line so it always agrees with the outcome
 * {@link classifyRunOutcome} computes, rather than printing the raw
 * (possibly misleading) `run.status` value directly. Exported for testing.
 */
export function formatRunStatusLine(run: RunRecord): string {
  if (classifyRunOutcome(run) === "work_completed_record_pending") {
    return `Status: ${colorStatus("completed")} ${colorWarn("(record commit pending)")}`;
  }
  return `Status: ${colorStatus(run.status)}`;
}

/**
 * Format the "Commits:" block naming every commit the run produced (work
 * commit, review-repair commit, completion-metadata commit — whichever
 * landed), oldest first. Returns an empty array when the run produced no
 * commits, so callers can splice the result in unconditionally.
 * Exported for testing.
 */
export function formatRunCommitsLines(commits: RunRecord["commits"]): string[] {
  if (!commits || commits.length === 0) return [];
  return ["Commits:", ...commits.map((c) => `  ${c.sha.slice(0, 8)} ${c.subject}`)];
}

/**
 * Format the run's "Summary:" line (the LLM's own account of the run).
 * Unconditional on outcome — a failed run's summary can still describe what
 * was attempted before the failure, which is real signal. Exported for
 * testing.
 */
export function formatRunSummaryLine(run: RunRecord): string | undefined {
  return run.summary ? `\nSummary: ${run.summary}` : undefined;
}

/**
 * Format the run's error/record line so it names what actually failed:
 *
 * - `work_failed`: `run.error`, as before.
 * - `work_completed`: nothing — the run succeeded outright.
 * - `work_completed_record_pending`: a "Record:" line saying the work is
 *   done and only the PRD bookkeeping commit is still pending, instead of an
 *   "Error:" line that would contradict "Summary: Task complete".
 *
 * Exported for testing.
 */
export function formatRunErrorLine(run: RunRecord): string | undefined {
  const outcome = classifyRunOutcome(run);
  if (outcome === "work_completed") return undefined;
  if (outcome === "work_completed_record_pending") {
    const reason = run.error ? ` (${run.error})` : "";
    return (
      `\n${colorWarn("Record:")} the task's work is complete, but the PRD record commit ` +
      `did not land${reason}. Rerun the task to retry recording it.`
    );
  }
  return run.error ? `\n${red("Error:")} ${run.error}` : undefined;
}

// ---------------------------------------------------------------------------
// Single task execution
// ---------------------------------------------------------------------------

/**
 * The system half of the end-of-run memory line. `-1` in the run record means
 * the reading was unknown; it is reported as such, never as a number.
 */
export function formatSystemMemory(stats: NonNullable<RunRecord["memoryStats"]>): string {
  const toGB = (bytes: number) => (bytes / 1024 / 1024 / 1024).toFixed(1);
  const totalGB = stats.systemTotalBytes >= 0 ? `${toGB(stats.systemTotalBytes)} GB` : "unknown total";
  return stats.systemAvailableAtEndBytes >= 0
    ? `system: ${toGB(stats.systemAvailableAtEndBytes)} / ${totalGB} available`
    : `system: available memory unknown / ${totalGB}`;
}

async function runOne(
  dir: string,
  henchDir: string,
  rexDir: string,
  gateTree: PerTaskTreeGate,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  reviewOpts: ReviewOptions,
  excludeTaskIds?: Set<string>,
  epicId?: string,
  tags?: string[],
  runHistory?: RunRecord[],
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  runNumber?: number,
  permissionMode?: PermissionMode,
  skipTestGate?: boolean,
  assignee?: string,
): Promise<{ status: string; taskTitle: string; selectedTaskId?: string }> {
  // First statement in the task: a tree this build would re-slug stops the task
  // before the claim below is taken and before any token is spent. The tree can
  // have changed since the previous task finished.
  await gateTree();

  // Lenient without a warning: cmdRun already loaded the same file leniently
  // and warned once — repeating it per task would spam loop mode.
  const config = await loadConfig(henchDir, { onInvalid: "use-defaults" });
  const store = await resolveStore(rexDir);
  await assertSchemaCompatibility(store);

  // Repository trust. While this checkout's execution config is not trusted
  // by the user, the guard it declares is clamped to the baseline and
  // bypassPermissions is lowered (store/trust.ts). cmdRun printed the warning
  // once; here the clamp is applied per task so a loop cannot outrun it.
  const trusted = applyRepoTrust(config, dir, permissionMode);
  permissionMode = trusted.permissionMode;

  // Load run history for prior attempt display if not provided
  const runs = runHistory ?? await listRuns(henchDir);

  // Apply CLI overrides (--token-budget, --skip-test-gate) to config
  const effectiveConfig = {
    ...trusted.config,
    provider,
    ...(tokenBudget != null ? { tokenBudget } : {}),
    ...(skipTestGate ? { skipFullTestGate: true } : {}),
  };

  // Cross-worktree claims: the loop claims the task it selects (before the
  // brief and any LLM turn) so other worktrees pass over it, refreshes it for
  // as long as the run lasts, and releases it on the way out — completed,
  // failed, cancelled by SIGINT, or thrown. A hard kill skips the release;
  // the claim then dies with the pid.
  //
  // A dry run observes but never writes. It does no work, so a claim would
  // buy it nothing, and taking one would let a preview here refuse a real run
  // starting in another worktree.
  const claims = TaskClaims.forProject(dir, { readOnly: dryRun });
  claims.startRenewal();
  let result: Awaited<ReturnType<typeof cliLoop>> | Awaited<ReturnType<typeof agentLoop>>;
  try {
  result = provider === "cli"
    ? await cliLoop({
        config: effectiveConfig as typeof config & { provider: "cli" },
        store,
        projectDir: dir,
        henchDir,
        taskId,
        dryRun,
        model,
        spawnModel,
        approveDiff: reviewOpts.approveDiff,
        reviewPass: reviewOpts.reviewPass,
        reviewModel: reviewOpts.reviewModel,
        reviewOptional: reviewOpts.reviewOptional,
        excludeTaskIds,
        epicId,
        tags,
        assignee,
        runHistory: runs,
        rollbackOnFailure,
        yes,
        autonomous,
        extraContext,
        runNumber,
        permissionMode,
        claims,
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
        approveDiff: reviewOpts.approveDiff,
        reviewPass: reviewOpts.reviewPass,
        reviewModel: reviewOpts.reviewModel,
        excludeTaskIds,
        epicId,
        tags,
        assignee,
        runHistory: runs,
        rollbackOnFailure,
        yes,
        autonomous,
        extraContext,
        runNumber,
        claims,
      });
  } finally {
    await claims.releaseAll();
  }

  const { run } = result;

  info(`\n${bold("=== Run Complete ===")}`);
  output(`Run ID: ${run.id}`);
  output(`Task: ${colorPink(run.taskTitle)}`);
  output(formatRunStatusLine(run));
  for (const line of formatRunCommitsLines(run.commits)) output(line);
  if (run.actor) output(`Actor: ${run.actor}${run.host ? ` @ ${run.host}` : ""}`);

  // Invocation context
  if (run.invocationContext) {
    const label = run.invocationContext === "cli" ? "CLI" : "API";
    output(colorWarn(`Invocation: ${label}`));
  }

  // Duration
  if (run.startedAt && run.finishedAt) {
    const durationMs = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
    info(`Duration: ${formatDuration(durationMs)}`);
  }

  info(`Turns: ${run.turns}`);
  info(formatTokenReport(run.tokenUsage, run.tokens?.cachedProvenance));
  if (run.session) info(formatSessionDecision(run.session));
  info(`Tool calls: ${run.toolCalls.length}`);

  // Memory stats
  if (run.memoryStats) {
    const peakMB = Math.round(run.memoryStats.peakRssBytes / 1024 / 1024);
    info(`Memory: ${peakMB} MB peak RSS (${formatSystemMemory(run.memoryStats)})`);
  }

  // Context-window churn — set only by the local (LM Studio) loop, so the
  // line appears for local runs only. Says how many times the conversation
  // window was condensed (digested or summarized) during the run.
  if (run.contextCondensations) {
    info(`Context window: condensed ${run.contextCondensations} time(s) during the run`);
  }

  // Post-task test results
  const postTests = run.structuredSummary?.postRunTests;
  if (postTests?.ran) {
    const scope = postTests.targetedFiles.length > 0
      ? `${postTests.targetedFiles.length} targeted file(s)`
      : "full suite";
    const testResult = postTests.passed ? green("passed") : red("FAILED");
    info(`Post-task tests: ${testResult} (${scope}, ${postTests.durationMs ?? 0}ms)`);
  }

  // Adversarial review outcome. Printed here as well as mid-run because the
  // mid-run line is long gone behind the test gate and the commit prompt by
  // the time anyone reads the result, and "completed" with no review line
  // beneath it is precisely the ambiguity `--review` exists to remove.
  for (const line of formatRunReviewStatus(run.review, run.id)) info(line);

  // Change classification
  info(formatChangeClassification(run.toolCalls, run.commits, run.uncommittedPaths));

  const summaryLine = formatRunSummaryLine(run);
  if (summaryLine) info(summaryLine);
  const errorLine = formatRunErrorLine(run);
  if (errorLine) output(errorLine);

  return { status: run.status, taskTitle: run.taskTitle, selectedTaskId: run.taskId };
}

// ---------------------------------------------------------------------------
// No-more-tasks sentinel
// ---------------------------------------------------------------------------

const NO_TASKS_MSG = "No actionable tasks found in PRD";

function isNoTasksError(err: unknown): boolean {
  return err instanceof Error && err.message.includes(NO_TASKS_MSG);
}

// ---------------------------------------------------------------------------
// Tag-filter completion helpers (used by runLoop for self-heal mode)
// ---------------------------------------------------------------------------

/** Returns true if there are still actionable tasks matching the given tags. */
async function hasPendingTaggedTasks(rexDir: string, tags: string[]): Promise<boolean> {
  const store = await resolveStore(rexDir);
  const doc = await store.loadDocument();
  const completedIds = collectCompletedIds(doc.items);
  const remaining = findActionable(doc.items, completedIds, 1, { tags });
  return remaining.length > 0;
}

interface CompletedItem {
  title: string;
  status: string;
}

/**
 * Build the completion summary lines for a tag-filtered loop run.
 * Returns an array of lines (without leading newlines) so callers can
 * either print them or assert on the content in tests.
 */
export function formatTagFilterCompletionSummary(
  tags: string[],
  items: CompletedItem[],
  processedCount: number,
): string[] {
  const tagLabel = tags.join(", ");
  const lines: string[] = [
    `All [${tagLabel}] tasks complete — ${processedCount} task(s) processed.`,
  ];
  if (items.length > 0) {
    lines.push("Resolved tasks:");
    for (const item of items) {
      const icon = item.status === "completed" ? green("✓") : red("✗");
      lines.push(`  ${icon} ${item.title} (${item.status})`);
    }
  }
  return lines;
}

/** Print the per-task summary emitted when all tagged items are resolved. */
function printTagFilterCompletionSummary(
  tags: string[],
  items: CompletedItem[],
  processedCount: number,
): void {
  const lines = formatTagFilterCompletionSummary(tags, items, processedCount);
  for (const line of lines) {
    info(`\n${line}`);
  }
}

// ---------------------------------------------------------------------------
// cmdRun — main entry point
// ---------------------------------------------------------------------------

export async function cmdRun(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const henchDir = resolveHenchPaths(dir).henchDir;
  // An invalid field in hench's config.json must not refuse the whole run —
  // fall back to that field's default and say so, so a bad edit (often made
  // from the dashboard) degrades to a warning instead of blocking `ndx work`.
  const config = await loadConfig(henchDir, {
    onInvalid: "use-defaults",
    onWarning: (message) => warn(message),
  });
  const rexDir = join(dir, config.rexDir);
  const llmConfig = await loadLLMConfig(henchDir);
  const llmVendor = resolveLLMVendor(llmConfig);

  // The CLI flag accepts both the vendor-neutral `--model` and the
  // vendor-specific `--claude-model` / `--codex-model` (the latter pair is
  // also recognized by `ndx init`; supporting them here means
  // `ndx work --claude-model=…` works end-to-end).
  const cliModelOverride =
    flags.model
    ?? (llmVendor === LLM_VENDOR.CLAUDE
      ? flags["claude-model"]
      : llmVendor === LLM_VENDOR.CODEX
        ? flags["codex-model"]
        : flags["google-model"]);
  // Resolution chain and the vendor-compatibility check both live in
  // agent-model.ts: --model > hench.models.<vendor> > llm.* > vendor default.
  const { model: resolvedModel, source: modelSource } = resolveAgentModel({
    vendor: llmVendor,
    cliModelOverride,
    henchModels: config.models,
    llmConfig,
  });

  // Surface vendor/model at command start for operator visibility.
  // Reads the most recent run artifact (if any) to detect model changes.
  const recentRuns = await listRuns(henchDir, 1);
  const lastRunModel = recentRuns[0]?.model;
  printVendorModelHeader(llmVendor, llmConfig, {
    lastModel: lastRunModel ? resolveModel(lastRunModel) : undefined,
    resolvedModel,
    modelSource,
  });

  // Suppress all informational output (including quota lines) in JSON mode,
  // consistent with how --quiet suppresses info() output.
  if (flags.format === "json") setQuiet(true);

  let provider = (flags.provider as "cli" | "api") ?? config.provider;
  const dryRun = flags["dry-run"] === "true";
  // `--review` now selects the adversarial review pass. The interactive
  // diff-approval gate that used to own this flag moved to `--approve-diff`.
  const reviewPass = flags.review === "true";
  const approveDiff = flags["approve-diff"] === "true";
  const reviewModelFlag = flags["review-model"];
  if (reviewModelFlag !== undefined && !reviewModelFlag.trim()) {
    throw new CLIError(
      "--review-model requires a model id.",
      "Example: --review-model=claude-opus-5-5. Omit the flag to use the recommended default for your vendor.",
    );
  }
  if (reviewModelFlag && !reviewPass) {
    throw new CLIError(
      "--review-model was passed without --review.",
      "The review model only applies to the adversarial review pass. Add --review, or drop --review-model.",
    );
  }
  const reviewOptional = flags["review-optional"] === "true";
  if (reviewOptional && !reviewPass) {
    throw new CLIError(
      "--review-optional was passed without --review.",
      "It only relaxes the gate the review pass installs. Add --review, or drop --review-optional.",
    );
  }
  const reviewOpts: ReviewOptions = {
    approveDiff,
    reviewPass,
    reviewModel: reviewModelFlag?.trim() || undefined,
    reviewOptional,
  };
  // --no-rollback always wins; otherwise read config (defaults to true).
  // Note: the failure rollback is prompt-only — it never runs without an
  // interactive confirmation, so this flag only governs whether that prompt
  // is offered at all.
  const rollbackOnFailure = flags["no-rollback"] === "true" ? false : (config.rollbackOnFailure ?? true);
  // --yes runs non-interactively, so no rollback prompt is shown (and thus no
  // revert occurs on failure).
  const yes = flags["yes"] === "true";
  // --allow-dirty lets autonomous runs start against an uncommitted working
  // tree instead of aborting at the pre-run commit gate.
  const allowDirty = flags["allow-dirty"] === "true";
  // --fresh discards the cached orientation session so this run re-orients
  // before forking task spawns from it.
  const fresh = flags["fresh"] === "true";
  const model = resolvedModel;
  // Always pass the resolved model to the spawned vendor CLI so the user's
  // configured choice (top-level or vendor-pinned) survives the spawn. The
  // adapter only appends a model flag when this value is set.
  const spawnModel = resolvedModel;
  const auto = flags.auto === "true";
  const loop = flags.loop === "true";
  const selfHeal = flags["self-heal"] === "true";
  const skipDeps = flags["skip-deps"] === "true";
  // --skip-test-gate: skip the mandatory full test suite gate before commit
  // for this invocation only. The persistent equivalent is the
  // hench.skipFullTestGate config field; the flag wins for the current run.
  const skipTestGate = flags["skip-test-gate"] === "true";

  // --permission-mode: validate against the four supported Claude CLI modes.
  // Resolution order (flag > config > runtime default) is computed below
  // after `autonomous` is derived, since the autonomous default depends on it.
  const permissionModeFlag = flags["permission-mode"];
  if (permissionModeFlag !== undefined && !isPermissionMode(permissionModeFlag)) {
    throw new CLIError(
      `Invalid --permission-mode value "${permissionModeFlag}".`,
      `Use one of: ${PERMISSION_MODES.join(", ")}.`,
    );
  }
  let tagsFilter = flags["tags"]
    ? (flags["tags"] as string).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;

  // Apply self-heal mode to config so it flows through to prompt building
  if (selfHeal) {
    config.selfHeal = true;
    // In self-heal mode, automatically restrict to self-heal-items.
    // Tag filter can still be combined with other explicit tags via --tags.
    tagsFilter = tagsFilter ? [...tagsFilter, SELF_HEAL_TAG] : [SELF_HEAL_TAG];
  }

  // --mine: restrict autoselection to tasks assigned to the current user.
  // Resolved once, the same way rex stamps `lastModifiedBy` (git user.name +
  // user.email, falling back to the OS username) — so a task's `assignee`
  // matches only when it was set to that same identity string. Like --tags,
  // this only constrains autoselection: an explicit --task bypasses it.
  const mine = flags["mine"] === "true";
  // --epic-by-epic walks every epic's tasks in order, and its selection path
  // carries no assignee filter. Accepting --mine there would run — and commit
  // under — tasks belonging to other people while the operator believes the
  // run was scoped to their own, so refuse instead of no-opping. Same reason
  // --review refuses on the api provider rather than reporting unreviewed runs
  // as reviewed. Checked before resolveActor so a contradictory invocation
  // fails on its arguments rather than after reading git config.
  if (mine && flags["epic-by-epic"] === "true") {
    throw new CLIError(
      "Cannot use --mine with --epic-by-epic.",
      "--epic-by-epic processes every epic in order and cannot filter by assignee. " +
        "Drop --mine, or run without --epic-by-epic.",
    );
  }
  const assignee = mine ? await resolveActor(dir) : undefined;

  // VENDOR_PROVIDERS (provider-support.ts) is the single source of truth:
  // claude accepts cli or api; codex only cli (no API loop); google and local
  // only api (no CLI binary exists). A vendor that rejects "cli" always
  // accepts "api" instead, so an unsupported "cli" auto-switches silently —
  // ndx config / ndx init persist hench.provider=api automatically when
  // local or google is selected as the vendor, so this branch is a safety
  // net for projects configured outside of those flows. An unsupported "api"
  // (codex only) has no such fallback and fails loudly instead.
  if (!dryRun && !isProviderSupported(llmVendor, provider)) {
    if (provider === "cli") {
      provider = "api";
    } else {
      throw new CLIError(
        "Hench API provider is only supported for vendor=claude or vendor=google.",
        "Set 'n-dx config hench.provider cli' or switch vendor: 'n-dx config llm.vendor claude'.",
      );
    }
  }

  // The adversarial review pass spawns a second vendor CLI session, so it
  // exists only on the CLI provider. Fail loudly rather than accepting the
  // flag and doing nothing: a silent no-op here would report "reviewed" runs
  // that were never reviewed, which is worse than not offering the flag.
  if (reviewOpts.reviewPass && provider === "api" && !dryRun) {
    throw new CLIError(
      `--review requires the CLI provider, but this run resolved to provider="api"` +
        `${llmVendor === LLM_VENDOR.GOOGLE || llmVendor === LLM_VENDOR.LOCAL ? ` (vendor="${llmVendor}" has no CLI binary)` : ""}.`,
      "Switch with 'ndx config hench.provider cli' on a vendor that has a CLI (claude, codex), or drop --review.",
    );
  }

  if (reviewOpts.reviewPass) {
    info(
      "\nAdversarial review enabled — a reviewer runs after each task validates, " +
        "before the commit.\n(The diff-approval gate that used to be --review is now --approve-diff.)",
    );
  }

  // Refuse a tree this build would re-slug, before anything is claimed, reset
  // or written — `--reset-deferred` below is the run's first PRD write, the
  // commit gate further down can commit the working tree, and the claims store
  // is opened later still. Unconditional: a dry run that hid the refusal would
  // report that the real run was going to be fine.
  //
  // This check cannot be the one the first task relies on, so `gateTree` is
  // built without consuming it: every task re-asks inside runOne, the first
  // included. Between here and that first task sit `--reset-deferred` below
  // and the commit gate further down, and the commit gate blocks on an
  // operator prompt — unbounded wall-clock time. An operator who starts a run,
  // is asked about uncommitted changes, and answers an hour later would
  // otherwise execute task one against a tree last verified an hour ago, and
  // task one's completion write would be the sweeper. The cost of re-asking is
  // one extra loadDocument, ~0.33s on a 405-item tree, once per run.
  //
  // This is also the only gate an interactive run can reach before anything
  // happens, so it is where the migration is offered — see
  // `offerSlugMigration`. The per-task gate inside `runOne` deliberately does
  // not offer: by the time it fires for task two, the run has already committed
  // task one, and a rename dropped in there is the surprise diff the offer
  // exists to prevent. A loop is autonomous anyway, and autonomous never asks.
  const treeRefusal = await readTreeConformanceRefusal(rexDir);
  if (treeRefusal) {
    const offer = await offerSlugMigration(
      dir,
      treeRefusal,
      {
        dryRun,
        autonomous: auto || loop || flags["epic-by-epic"] === "true",
        assumeYes: yes,
      },
    );
    if (offer.outcome === "migrated") {
      output(offer.report);
      // Stop. Not an error — the migration succeeded and the operator has been
      // told what to do next — so `cmdRun` returns rather than throwing.
      return;
    }
    throw treeConformanceError(
      treeRefusal,
      offer.outcome === "withheld" ? offer.note : undefined,
    );
  }
  const gateTree = createPerTaskTreeGate(rexDir);

  // Warn when a local-scope Claude MCP registration pins this repository's
  // servers to a different checkout — the shape that sent run 0b919f4f's
  // `update_task_status` into the main checkout instead of the worktree it was
  // executing in.
  //
  // Only for the spawns that cannot override it — see the function's own note
  // on which those are.
  await warnOnShadowingMcpRegistration(dir, llmVendor);

  // --reset-deferred: reset deferred/failing tasks to pending before running.
  // This lets the user retry tasks that were deferred by infrastructure failures
  // (e.g. context window overflow) without manually editing each task.
  //
  // With --mine the reset is scoped to the resolved identity, for the same
  // reason the interactive offer is: the run that follows will only work this
  // operator's items, so resetting everyone else's — and committing that under
  // this operator's name — is never what the pair of flags asked for.
  if (flags["reset-deferred"] === "true") {
    const store = await resolveStore(rexDir);
    await resetDeferredAndCommit(store, dir, { dryRun, ...(assignee ? { assignee } : {}) });
  }

  // Fail fast if CLI provider selected but vendor CLI binary not available.
  // Google and local are excluded — they have no CLI binary and are already guarded above.
  if (provider === "cli" && !dryRun && llmVendor !== LLM_VENDOR.GOOGLE && llmVendor !== LLM_VENDOR.LOCAL) {
    const customPath = resolveVendorCliPath(llmConfig);
    requireLLMCLI(llmVendor as "claude" | "codex", customPath);
  }

  // Local vendor preflight: verify the LM Studio server is reachable and a model is loaded.
  // Fails fast before task selection and brief assembly to give the user a clear error instead
  // of a mid-run context-window or connection failure deep in the loop.
  if (llmVendor === LLM_VENDOR.LOCAL && !dryRun) {
    const localCfg = llmConfig?.local;
    const host = localCfg?.host ?? "localhost";
    const port = localCfg?.port ?? 1234;
    const baseUrl = `http://${host}:${port}/v1`;
    try {
      const res = await fetch(`${baseUrl}/models`, {
        method: "GET",
        headers: { "Accept": "application/json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        throw new CLIError(
          `LM Studio server responded with HTTP ${res.status} on GET /v1/models.`,
          `Check that LM Studio is running at ${host}:${port} and a model is loaded.`,
        );
      }
      type ModelsResponse = { data?: Array<{ id?: string; context_length?: number }> };
      const data = await res.json() as ModelsResponse;
      const models = data.data ?? [];
      if (models.length === 0) {
        throw new CLIError(
          `LM Studio is running at ${host}:${port} but no models are loaded.`,
          "Open LM Studio and load a model before running 'ndx work'.",
        );
      }
      // Surface model count and context window so the user can verify their setup.
      const modelId = models[0].id ?? "(unknown)";
      const contextLen = models[0].context_length;
      const ctxNote = contextLen
        ? ` (context window: ${contextLen.toLocaleString()} tokens)`
        : "";
      info(`✓ LM Studio ready — ${models.length} model(s) available, active: ${modelId}${ctxNote}`);
      if (contextLen && contextLen < 16_384) {
        info(
          colorWarn(
            `  ⚠ Context window is only ${contextLen.toLocaleString()} tokens — ` +
            `briefs often exceed 32 768 tokens. Increase "Context Length" in LM Studio.`,
          ),
        );
      }
    } catch (err) {
      if (err instanceof CLIError) throw err;
      throw new CLIError(
        `Cannot reach LM Studio at ${host}:${port}: ${(err as Error).message}`,
        "Ensure LM Studio is running and the server is started (port matches your config).",
      );
    }
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
      output(`\n${formatRunSuccessMessage(`✓ All tasks in epic "${scopeInfo.title}" are complete.`)}`);
      process.exit(0);
    }
    if (!scopeInfo.hasActionableTasks) {
      const [line1, line2, line3] = formatNoActionableTasksWarning(
        scopeInfo.title,
        scopeInfo.totalTasks - scopeInfo.completedTasks,
      );
      output(line1);
      output(line2);
      output(line3);
      process.exit(0);
    }
  }

  const epicByEpic = flags["epic-by-epic"] === "true";

  // --priority flag: override task scheduling priority.
  // Valid values: critical, high, medium, low.
  const priorityOverride = flags.priority;

  // --context-file flag: read extra project context (injected by pair-programming).
  // If the file is absent or unreadable, warn and continue without context.
  let extraContext: string | undefined;
  const contextFilePath = flags["context-file"];
  if (contextFilePath) {
    if (existsSync(contextFilePath)) {
      try {
        // Size-guarded: `ndx work` pipes the entire CONTEXT.md plus the PRD
        // tree through this flag, and the result is re-sent on every task and
        // every retry. Trim with a stated marker rather than inlining
        // whatever happens to be on disk.
        const raw = readFileSync(contextFilePath, "utf-8");
        extraContext = trimDocument(raw, MAX_CONTEXT_FILE_CHARS, "context file");
        if (raw.length > MAX_CONTEXT_FILE_CHARS) {
          info(
            `⚠ Context file trimmed: ${raw.length} chars → ${MAX_CONTEXT_FILE_CHARS} ` +
              `(${contextFilePath})`,
          );
        }
      } catch (err) {
        info(`⚠ Could not read context file "${contextFilePath}": ${(err as Error).message}`);
      }
    } else {
      info(`⚠ Context file not found: "${contextFilePath}" — proceeding without context`);
    }
  }

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
    const usage = memoryUsagePercent === null ? "unknown" : `${memoryUsagePercent.toFixed(1)}%`;
    if (decision === "delay") {
      info(
        `⏳ Memory usage high (${usage}) — ` +
        `delaying execution ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`,
      );
    } else if (decision === "reject") {
      info(`🚫 Memory usage critical (${usage}) — rejecting execution`);
    } else if (attempt > 0) {
      info(memoryUsagePercent === null
        ? "✓ Memory reading unknown — proceeding"
        : `✓ Memory usage recovered (${usage}) — proceeding`);
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

    // Run dependency audit in self-heal mode (once per hench invocation, before task loop)
    if (selfHeal && !skipDeps && !dryRun) {
      const { runDependencyAudit } = await import("../../tools/test-runner.js");
      const { writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");

      info("\n[Dependency Audit]");
      const audit = await runDependencyAudit({
        projectDir: dir,
        timeout: 60_000,
      });

      // Store audit result to a temp file so the first run can include it
      const auditFile = join(henchDir, ".pending-audit.json");
      try {
        writeFileSync(auditFile, JSON.stringify(audit, null, 2));
      } catch {
        // Ignore if we can't write the temp file
      }

      if (audit.ran) {
        const vulnCount =
          audit.vulnerabilities.critical +
          audit.vulnerabilities.high +
          audit.vulnerabilities.moderate +
          audit.vulnerabilities.low;
        const outdatedCount =
          audit.outdated.major.length +
          audit.outdated.minor.length +
          audit.outdated.patch.length;

        // `audit.error` alongside `ran: true` means one of the two steps could
        // not report, so its half of these counts is zeros that mean nothing.
        // Claiming "none found" off a partial audit is the fail-open failure
        // this whole path guards against — say what was actually measured.
        if (audit.error) {
          info(`⚠ Audit incomplete — ${audit.error}`);
          info(
            `Measured so far: ${vulnCount} vulnerabilities, ${outdatedCount} outdated packages ` +
            `(zeros from the step that failed carry no information)`,
          );
        } else if (vulnCount === 0 && outdatedCount === 0) {
          info("✓ No vulnerabilities or outdated packages found");
        } else {
          if (vulnCount > 0) {
            info(
              `Found ${vulnCount} vulnerabilities: ${audit.vulnerabilities.critical} critical, ` +
              `${audit.vulnerabilities.high} high, ${audit.vulnerabilities.moderate} moderate, ` +
              `${audit.vulnerabilities.low} low`,
            );
          }
          if (outdatedCount > 0) {
            info(
              `Found ${outdatedCount} outdated packages: ${audit.outdated.major.length} major, ` +
              `${audit.outdated.minor.length} minor, ${audit.outdated.patch.length} patch`,
            );
          }
        }
        if (audit.totalDurationMs != null) {
          info(`Audit completed in ${Math.round(audit.totalDurationMs / 1000)}s`);
        }
      } else if (audit.skipped && audit.skipReason) {
        info(`Skipped: ${audit.skipReason}`);
      } else if (audit.error) {
        // INCONCLUSIVE, not clean — neither step produced counts. Warn and
        // proceed, per the decision recorded on DependencyAuditResult: the audit
        // gates nothing today, so a `pnpm` that will not spawn must not be a
        // harder stop than ten critical vulnerabilities are.
        info(`⚠ Dependency audit inconclusive — ${audit.error}`);
        info("Proceeding without dependency findings; nothing was verified.");
      }
    }

    // Autonomous runs (--auto, --loop, --epic-by-epic) bypass interactive
    // prompts such as the commit-message approval gate. The same flag state
    // governs task autoselect above — both are facets of "running unattended".
    const autonomous = auto || loop || epicByEpic;

    // Repository trust, reported once per invocation. The per-task clamp in
    // runOne is what enforces it; this is the operator-facing warning, so an
    // unattended loop on an untrusted clone says so at the top of its output.
    const repoTrust = evaluateRepoTrust(dir);
    if (repoTrust.restricted) {
      for (const line of formatTrustWarningForRun(repoTrust, config.provider)) warn(line);
    }

    // Resolve the effective permission mode for the spawned Claude session.
    // Precedence: --permission-mode flag > config.permissionMode > autonomous
    // default ("acceptEdits") > undefined (Claude CLI's built-in default).
    // Codex spawns ignore this — warn the user that the value will be dropped.
    let effectivePermissionMode: PermissionMode | undefined =
      (permissionModeFlag as PermissionMode | undefined) ??
      config.permissionMode ??
      (autonomous ? "acceptEdits" : undefined);
    if (repoTrust.restricted && effectivePermissionMode === "bypassPermissions") {
      warn("Lowering --permission-mode bypassPermissions to acceptEdits: this repository's execution config is not trusted.");
      effectivePermissionMode = "acceptEdits";
    }
    if (effectivePermissionMode && llmVendor !== LLM_VENDOR.CLAUDE) {
      info(
        `⚠ --permission-mode is a Claude CLI feature; ignoring "${effectivePermissionMode}" for vendor=${llmVendor}.`,
      );
      effectivePermissionMode = undefined;
    }

    // The checkout this invocation belongs to. Captured before the gate can
    // prompt, so the gate's commit is bound to the branch and worktree the
    // operator started from. Each run then captures its own copy onto the run
    // record, for the commits that happen later in the loop.
    const invocationGitOrigin = captureRunGitOrigin(dir);

    // One-time pre-run commit gate: before the work loop begins, offer to
    // commit any pre-existing uncommitted changes so the user's in-progress
    // edits are not folded into hench's own commits. Runs once per invocation
    // (not per iteration) and only prompts in an attended TTY session.
    const gate = await performPreRunCommitGateIfNeeded({
      projectDir: dir,
      henchDir,
      model,
      yes,
      autonomous,
      allowDirty,
      dryRun,
      origin: invocationGitOrigin,
      // Size-aware escalation config (hench.git.*); --allow-dirty above
      // takes precedence over both settings.
      checkpointThreshold: config.git?.checkpointThreshold,
      requireCleanTree: config.git?.requireCleanTree,
    });
    if (gate === "stop") {
      info("Stopped before running. Commit or discard your changes, then re-run.");
      // A refusal to start is not success — without this the process exits 0
      // and an unattended caller (a script, `--loop`, the dashboard) reads
      // "no task ran" as "done" (GitHub #365).
      process.exitCode = 1;
      return;
    }

    // --fresh: drop the cached orientation session exactly once, here, before
    // any task runs. Clearing per task instead would make every task in a
    // loop re-orient, which is the opposite of what the flag is for — the
    // first task then re-orients on the cache miss and the rest reuse it.
    if (fresh) {
      await clearSessionCache(henchDir);
      detail("Discarded the cached orientation session (--fresh)");
    }

    if (epicByEpic) {
      await runEpicByEpic(dir, henchDir, rexDir, gateTree, provider, dryRun, model, spawnModel, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, reviewOpts, queue, priorityOverride, rollbackOnFailure, yes, extraContext, autonomous, effectivePermissionMode, skipTestGate);
      return;
    }

    let taskId = flags.task;

    // Task selection: --task > interactive (TTY) > autoselect
    // In loop mode, always autoselect (skip interactive)
    if (!taskId && !auto && !loop && process.stdin.isTTY && !dryRun) {
      taskId = await selectTask(dir, rexDir, epicId, assignee);
    }
    // If --auto, --loop, or non-TTY, taskId stays undefined → assembleTaskBrief autoselects

    if (loop) {
      await runLoop(dir, henchDir, rexDir, gateTree, provider, taskId, dryRun, model, spawnModel, maxTurns, tokenBudget, pauseMs, config.maxFailedAttempts, reviewOpts, epicId, tagsFilter, queue, priorityOverride, rollbackOnFailure, yes, extraContext, autonomous, effectivePermissionMode, skipTestGate, assignee);
    } else {
      await runIterations(dir, henchDir, rexDir, gateTree, provider, taskId, dryRun, model, spawnModel, maxTurns, tokenBudget, iterations, config.maxFailedAttempts, reviewOpts, epicId, tagsFilter, rollbackOnFailure, yes, extraContext, autonomous, effectivePermissionMode, skipTestGate, assignee);
    }
  } finally {
    await limiter.release();
  }
}

// ---------------------------------------------------------------------------
// Between-task working-tree guard
// ---------------------------------------------------------------------------

/**
 * Refuse to start another task while the previous one's output is still in the
 * working tree (#363).
 *
 * The pre-run commit gate runs once per invocation, so in a multi-task run
 * nothing checked the tree again between tasks. When one task leaked its
 * files, the next started on top of them: its diff, its review and its commit
 * all covered work it never wrote, and three tasks' output ended up tangled
 * together in one session.
 *
 * The PRD paths are discounted, along with hench's own runtime artifacts.
 * An earlier revision discounted nothing but the artifacts, on the premise
 * that uncommitted `.rex/prd_tree/` between tasks meant the previous task's
 * status write never landed. That premise only holds for a *successful* task.
 * Every failure path writes the PRD and commits nothing: `handleRunFailure`
 * records `deferred`/`pending` on the task, while the two committers
 * ({@link performCommitPromptIfNeeded}, `commitCompletionMetadata`) run only
 * when the run completed, and the rollback never reverts unattended. So the
 * first failed, deferred or timed-out task stopped the whole loop, and the
 * consecutive-failure counter and stuck-task skipping below could never be
 * reached. A PRD write with no code beside it is not leaked work — and the
 * completion gate in `finalizeRun` still covers the case that is.
 *
 * Attended runs are left alone: a user who declined the commit prompt made
 * that choice deliberately and is watching.
 *
 * @returns true when the caller should stop the loop.
 */
export async function shouldStopForUncommittedWork(
  projectDir: string,
  autonomous: boolean | undefined,
): Promise<boolean> {
  if (!autonomous) return false;
  const leftover = await findUncommittedWork({
    projectDir,
    discountPaths: PRD_COMMIT_PATHS,
  });
  if (leftover.clean) return false;
  const deleted = deletedAmong(projectDir, leftover.paths);
  info(`\n${colorWarn(formatLoopRefusal(
    leftover.paths,
    deleted,
    await prepareRecoveryPathspecs(projectDir, leftover.paths, deleted),
  ))}`);
  process.exitCode = 1;
  return true;
}

// ---------------------------------------------------------------------------
// Fixed iteration mode (existing behaviour)
// ---------------------------------------------------------------------------

async function runIterations(
  dir: string,
  henchDir: string,
  rexDir: string,
  gateTree: PerTaskTreeGate,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  iterations: number,
  maxFailedAttempts: number,
  reviewOpts: ReviewOptions,
  epicId?: string,
  tags?: string[],
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  permissionMode?: PermissionMode,
  skipTestGate?: boolean,
  assignee?: string,
): Promise<void> {
  // Track attempt counts per task ID within this run invocation
  const attemptTracker = createAttemptTracker();
  // Tasks excluded from selection due to reaching 3 attempts
  const forcedExclusionIds = new Set<string>();

  for (let i = 0; i < iterations; i++) {
    // Banner between iterations: printed before iteration i+1 starts,
    // i.e. after iteration i's commit and run summary have been rendered.
    // Not emitted before the first iteration (i === 0).
    if (i > 0) {
      info(`\n${formatIterationBanner(i + 1, iterations)}`);
      if (await shouldStopForUncommittedWork(dir, autonomous)) break;
    }

    // For autoselected iterations, skip stuck tasks
    const isAutoselect = i > 0 || !taskId;
    const stuckIds = isAutoselect
      ? await loadStuckTaskIds(henchDir, maxFailedAttempts)
      : undefined;

    // Combine stuck tasks with tasks that reached max attempts
    const combinedExcludedIds = stuckIds
      ? new Set([...stuckIds, ...forcedExclusionIds])
      : forcedExclusionIds;

    const { status, selectedTaskId } = await runOne(
      dir, henchDir, rexDir, gateTree, provider,
      // Only use the explicit taskId for the first iteration;
      // subsequent iterations autoselect the next task
      i === 0 ? taskId : undefined,
      dryRun, model, spawnModel, maxTurns, tokenBudget,
      reviewOpts,
      combinedExcludedIds,
      epicId,
      tags,
      undefined,
      rollbackOnFailure,
      yes,
      extraContext,
      autonomous,
      undefined,
      permissionMode,
      skipTestGate,
      assignee,
    );

    // Track attempt count for the selected task
    if (selectedTaskId) {
      const attemptCount = attemptTracker.incrementAndGetCount(selectedTaskId);
      if (attemptCount >= 3 && !forcedExclusionIds.has(selectedTaskId)) {
        forcedExclusionIds.add(selectedTaskId);
        // Note: taskTitle would be in the original runOne result, not in status
        // We could enhance this later, but for now we just log the taskId
        info(`\n${colorWarn(`Forced advancement: task "${selectedTaskId}" has reached 3 attempts in this run. Excluding from next iteration.`)}`);
      }
    }

    // Emit quota log line(s) at the inter-run boundary.
    await emitQuotaLog();

    if (status === "error_transient") {
      info(`\n${colorWarn(`Transient error on iteration ${i + 1}, continuing to next task...`)}`);
      continue;
    }

    if (status === "failed" || status === "timeout" || status === "budget_exceeded") {
      info(`\n${red(`Stopping after ${i + 1} iteration(s) due to ${status} status.`)}`);
      // Without this, the process exits 0 despite the task run failing —
      // this loop only ever throws for unexpected errors, so a graceful
      // stop here looked identical to success to any caller checking the
      // exit code (e.g. the dashboard's "Start Working" trigger, which
      // used exitCode === 0 as its sole success signal and reported
      // "completed" for a run that actually failed).
      process.exitCode = 1;
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
  gateTree: PerTaskTreeGate,
  provider: "cli" | "api",
  taskId: string | undefined,
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  pauseMs: number,
  maxFailedAttempts: number,
  reviewOpts: ReviewOptions,
  epicId?: string,
  tags?: string[],
  queue?: ExecutionQueue,
  priorityOverride?: string,
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  permissionMode?: PermissionMode,
  skipTestGate?: boolean,
  assignee?: string,
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
  // Also handle SIGTERM (e.g. the web dashboard's Stop button, or a graceful
  // server shutdown) the same way as Ctrl-C — otherwise an unhandled SIGTERM
  // kills this process immediately, orphaning whatever LLM CLI child is
  // currently in flight instead of draining the queue first.
  process.on("SIGTERM", onSignal);

  let completed = 0;
  // Tracks per-task outcomes when a tag filter is active (e.g. self-heal mode).
  const taggedCompletedItems: CompletedItem[] = [];
  // Track attempt counts per task ID within this run invocation
  const attemptTracker = createAttemptTracker();
  // Tasks excluded from selection due to reaching 3 attempts
  const forcedExclusionIds = new Set<string>();
  // Track consecutive failures per loop invocation (3-strike auto-cancel)
  const consecutiveFailureCounter = new ConsecutiveFailureCounter();

  try {
    const scope = epicId ? "epic tasks" : "all tasks";
    const tagNote = tags?.length ? ` [tag filter: ${tags.join(", ")}]` : "";
    info(`Loop mode: running continuously until ${scope} complete or interrupted (Ctrl+C to stop)${tagNote}`);

    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (stopping) {
        info(`\nLoop stopped by user after ${completed} task(s).`);
        break;
      }

      completed++;
      // Banner between iterations: not emitted before the first iteration.
      if (completed > 1) {
        info(`\n${formatIterationBanner(completed)}`);
        if (await shouldStopForUncommittedWork(dir, autonomous)) break;
      }

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
        // Combine stuck tasks with tasks that reached max attempts
        const combinedExcludedIds = stuckIds
          ? new Set([...stuckIds, ...forcedExclusionIds])
          : forcedExclusionIds;
        let schedulingPriority: TaskPriority = "medium";
        if (queue) {
          const store = await resolveStore(rexDir);
          schedulingPriority = await peekNextTaskPriority(
            store, effectiveTaskId, priorityOverride, combinedExcludedIds, epicId, tags, assignee,
          );
          await queue.acquire(effectiveTaskId ?? "auto", schedulingPriority);
        }

        try {
          const result = await runOne(
            dir, henchDir, rexDir, gateTree, provider,
            // Only use explicit taskId on the very first iteration
            effectiveTaskId,
            dryRun, model, spawnModel, maxTurns, tokenBudget,
            reviewOpts,
            combinedExcludedIds,
            epicId,
            tags,
            undefined,
            rollbackOnFailure,
            yes,
            extraContext,
            autonomous,
            completed,
            permissionMode,
            skipTestGate,
            assignee,
          );
          status = result.status;

          // Track consecutive failures for 3-strike auto-cancel.
          // Uses isFailureStatus (not !shouldContinueLoop) so that
          // error_transient and cancelled — which keep the loop iterating —
          // still count toward the threshold instead of resetting the counter.
          if (isFailureStatus(status)) {
            consecutiveFailureCounter.recordFailure(result.selectedTaskId || "unknown");
          } else {
            consecutiveFailureCounter.recordSuccess();
          }

          // Track attempt count for the selected task
          if (result.selectedTaskId) {
            const attemptCount = attemptTracker.incrementAndGetCount(result.selectedTaskId);
            if (attemptCount >= 3 && !forcedExclusionIds.has(result.selectedTaskId)) {
              forcedExclusionIds.add(result.selectedTaskId);
              info(`\n${colorWarn(`Forced advancement: task "${result.taskTitle}" has reached 3 attempts in this run. Excluding from next selection.`)}`);
            }
          }

          if (tags?.length) {
            taggedCompletedItems.push({ title: result.taskTitle, status: result.status });
          }
          // Close the banner opened by the lifecycle loop. Mirrors the
          // start banner's format so each run is visually bracketed in
          // long --loop transcripts.
          section(`Agent Run #${completed}${model ? ` (${model})` : ""} end`);
        } finally {
          // Release the queue slot after the task completes
          if (queue) queue.release();
        }
      } catch (err) {
        if (isNoTasksError(err)) {
          const scope = epicId ? " in epic" : "";
          if (tags?.length) {
            printTagFilterCompletionSummary(tags, taggedCompletedItems, completed - 1);
          } else if (assignee) {
            // Not "All tasks complete": under --mine the loop ran out of *this
            // operator's* tasks, which says nothing about the rest of the PRD.
            // On a first iteration that matched nothing it said the project was
            // finished.
            //
            // The unfiltered count is best-effort: this is the loop's clean
            // exit, and a store that cannot be read here must not turn a
            // finished run into a crash. Reporting one number less is strictly
            // better than losing the completion message entirely.
            let unfiltered = 0;
            try {
              unfiltered = await countActionableIgnoringAssignee(
                await resolveStore(rexDir),
                epicId,
              );
            } catch {
              unfiltered = 0;
            }
            const lines = formatMineLoopCompletionLines(
              assignee,
              completed - 1,
              unfiltered,
              scope,
            );
            info("");
            for (const line of lines) info(line);
          } else {
            info(`\nAll tasks${scope} complete — loop finished after ${completed - 1} task(s).`);
          }
          break;
        }
        throw err;
      }

      // After each completed task, check whether any tagged items remain.
      // This satisfies the "evaluated after each task" requirement and avoids
      // a spurious extra iteration that would end in isNoTasksError.
      if (tags?.length && !dryRun) {
        const stillPending = await hasPendingTaggedTasks(rexDir, tags);
        if (!stillPending) {
          printTagFilterCompletionSummary(tags, taggedCompletedItems, completed);
          break;
        }
      }

      // Emit quota log line(s) at the inter-run boundary.
      await emitQuotaLog();

      // Check for 3-strike auto-cancel on consecutive failures
      if (consecutiveFailureCounter.shouldCancel()) {
        const cancelMessage = consecutiveFailureCounter.getCancellationMessage();
        info(`\n${red(cancelMessage)}`);
        break;
      }

      if (!shouldContinueLoop(status)) {
        // In loop mode, hard failures don't stop the loop — the stuck
        // task will be detected and skipped on the next iteration.
        info(`\n${red(`Task failed (${status}), will skip if stuck on next iteration...`)}`);
      }

      if (dryRun) {
        info("\nDry run — stopping after one iteration.");
        break;
      }

      if (status === "error_transient") {
        info(`\n${colorWarn("Transient error, continuing to next task...")}`);
      }

      // Pause between tasks (interruptible)
      if (!stopping && pauseMs > 0) {
        const spinner = createSpinner(formatPauseMessage(pauseMs, "task")).start();
        await loopPause(pauseMs, ac.signal);
        spinner.stop();
      }

      // Emit a pink separator at each loop-iteration boundary so long
      // transcripts are easy to scan.  Suppressed entirely when color is
      // disabled (NO_COLOR=1 or non-TTY without FORCE_COLOR) — no plain-text
      // fallback, because a bare ─── line would add noise without the colour
      // distinction that makes it useful.
      if (isColorEnabled()) {
        info(`\n${formatLoopIterationSeparator()}`);
      }
    }
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
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
  gateTree: PerTaskTreeGate,
  provider: "cli" | "api",
  dryRun: boolean,
  model: string | undefined,
  spawnModel: string | undefined,
  maxTurns: number | undefined,
  tokenBudget: number | undefined,
  pauseMs: number,
  maxFailedAttempts: number,
  reviewOpts: ReviewOptions,
  queue?: ExecutionQueue,
  priorityOverride?: string,
  rollbackOnFailure?: boolean,
  yes?: boolean,
  extraContext?: string,
  autonomous?: boolean,
  permissionMode?: PermissionMode,
  skipTestGate?: boolean,
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
  // Also handle SIGTERM (e.g. the web dashboard's Stop button, or a graceful
  // server shutdown) the same way as Ctrl-C — otherwise an unhandled SIGTERM
  // kills this process immediately, orphaning whatever LLM CLI child is
  // currently in flight instead of draining the queue first.
  process.on("SIGTERM", onSignal);

  const summaries: EpicRunSummary[] = [];
  /**
   * Tasks started by this invocation, counted across every epic.
   *
   * The between-task guard runs before each task except the very first, and
   * "first" has to mean first of the *invocation*, not first of the epic: the
   * task that leaks its work is just as likely to be the last one of the
   * previous epic. The pre-run commit gate has already vetted the tree for
   * task one.
   */
  let tasksStarted = 0;

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
      output(formatRunSuccessMessage("✓ All epics are complete."));
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

      info(`\n${colorPink("═".repeat(60))}`);
      info(bold(`Epic ${epicIdx + 1}/${actionableEpics.length}: ${epic.title}`));
      info(colorPink("═".repeat(60)));

      // Re-check epic scope (tasks may have changed from prior epic's work)
      const freshScope = await getEpicScopeInfo(store, epic.id);

      if (freshScope.isComplete) {
        info(green(`✓ Epic "${epic.title}" is already complete.`));
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
        for (const line of formatEpicSkipLines(freshScope)) info(colorWarn(line));
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

        // Same between-task guard the fixed-iteration and loop modes run
        // (#363). `stopping` ends the outer epic loop too, so the refusal
        // stops the invocation rather than just this epic.
        if (tasksStarted > 0 && await shouldStopForUncommittedWork(dir, autonomous)) {
          stopping = true;
          break;
        }

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
              dir, henchDir, rexDir, gateTree, provider,
              undefined, // autoselect within epic
              dryRun, model, spawnModel, maxTurns, tokenBudget,
              reviewOpts,
              stuckIds,
              epic.id,
              undefined, // tags (epic-by-epic doesn't apply a tag filter)
              undefined,
              rollbackOnFailure,
              yes,
              extraContext,
              autonomous,
              undefined,
              permissionMode,
              skipTestGate,
              undefined, // assignee — --mine is refused with --epic-by-epic
            );
            status = result.status;
            tasksStarted++;
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

        // Emit quota log line(s) at the inter-run boundary.
        await emitQuotaLog();

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
          info(`\n${green(`✓ Epic "${epic.title}" is now complete!`)}`);
          break;
        }
        if (!updated.hasActionableTasks) {
          info(`\n${colorWarn(`⚠ Epic "${epic.title}" has no more actionable tasks.`)}`);
          break;
        }

        // Pause between tasks (interruptible)
        if (!stopping && pauseMs > 0) {
          const spinner = createSpinner(formatPauseMessage(pauseMs, "task")).start();
          await loopPause(pauseMs, ac.signal);
          spinner.stop();
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
        info(`\n${formatPauseMessage(pauseMs, "epic")}`);
        await loopPause(pauseMs, ac.signal);
      }
    }

    // Print final summary
    printEpicByEpicSummary(summaries);
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}

/**
 * Print a summary table of epic-by-epic execution results.
 */
export function printEpicByEpicSummary(summaries: EpicRunSummary[]): void {
  info(`\n${colorPink("═".repeat(60))}`);
  info(bold("Epic-by-Epic Execution Summary"));
  info(colorPink("═".repeat(60)));

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
      ? ` (${green(String(s.tasksCompleted))} done, ${red(String(s.tasksFailed))} failed)`
      : "";

    output(`  ${icon} ${s.title} — ${s.outcome}${stats}`);
    totalCompleted += s.tasksCompleted;
    totalFailed += s.tasksFailed;
  }

  const epicsDone = summaries.filter((s) => s.outcome === "completed").length;
  output(`\nEpics: ${epicsDone}/${summaries.length} completed | Tasks: ${green(String(totalCompleted))} done, ${red(String(totalFailed))} failed`);
}
