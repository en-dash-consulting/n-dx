/**
 * Agent analysis module — runtime analysis and failure-recovery capabilities.
 *
 * Five analysis domains, each a pure-function module with no I/O:
 *
 * - **adaptive** — project evolution metrics → automatic config adjustments
 * - **review**   — diff collection and interactive approval gate
 * - **spin**     — empty-turn detection (agent producing text without tool calls)
 * - **stuck**    — consecutive-failure detection for task-level blocking
 * - **workflow** — historical run analysis → optimization suggestions
 * - **summary**  — post-run summarization (tool calls, files, tests)
 *
 * All modules follow the same contract:
 * - Pure functions operating on typed inputs (RunRecord[], config, etc.)
 * - No I/O or side effects (review.ts's prompt function accepts an injected promptFn)
 * - Exported types describe each module's input/output shapes
 */

// ── Adaptive ─────────────────────────────────────────────────────────
export {
  analyzeAdaptive,
  collectMetrics,
  getAutoApplicable,
  DEFAULT_ADAPTIVE_SETTINGS,
} from "./adaptive.js";

export type {
  ProjectMetrics,
  WorkflowAdjustment,
  AdjustmentNotification,
  AdaptiveSettings,
  AdaptiveAnalysis,
  AdjustmentCategory,
  AdjustmentPriority,
} from "./adaptive.js";

// ── Review ───────────────────────────────────────────────────────────
export {
  collectReviewDiff,
  promptReview,
  revertChanges,
} from "./review.js";

export type {
  ReviewResult,
  ReviewDiff,
} from "./review.js";

// ── Spin detection ───────────────────────────────────────────────────
export {
  updateEmptyTurnCount,
  isSpinningRun,
  DEFAULT_SPIN_THRESHOLD,
} from "./spin.js";

// ── Stuck detection ──────────────────────────────────────────────────
export {
  countRecentFailures,
  isStuckTask,
  getStuckTaskIds,
} from "./stuck.js";

// ── Workflow analysis ────────────────────────────────────────────────
export {
  analyzeWorkflow,
  computeStats,
} from "./workflow.js";

export type {
  WorkflowAnalysis,
  WorkflowStats,
  WorkflowSuggestion,
  SuggestionCategory,
  SuggestionPriority,
} from "./workflow.js";

// ── Summary ──────────────────────────────────────────────────────────
export { buildRunSummary } from "./summary.js";
