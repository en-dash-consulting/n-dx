/**
 * hench-core — Run loop, context assembly, and orchestration.
 *
 * This module owns the agent execution lifecycle:
 * - API agent loop (Anthropic SDK direct)
 * - CLI agent loop (claude subprocess)
 * - Task brief assembly and formatting
 * - System prompt generation
 * - Completion validation and review gate
 * - Token budget management
 * - Run summary generation
 * - Stuck task detection
 *
 * Organized into subdirectories:
 * - lifecycle/  — Agent execution loops and token tracking
 * - planning/   — Task brief assembly and system prompt generation
 * - analysis/   — Post-run review, summary, and stuck detection
 *
 * Tool definitions and implementations live in `../tools/`.
 */

// ── Lifecycle ──

// Agent loops
export { agentLoop } from "./lifecycle/loop.js";
export type { AgentLoopOptions, AgentLoopResult } from "./lifecycle/loop.js";
export { cliLoop } from "./lifecycle/cli-loop.js";
export type { CliLoopOptions, CliLoopResult } from "./lifecycle/cli-loop.js";

// Token budget
export { checkTokenBudget } from "./lifecycle/token-budget.js";
export type { TokenBudgetResult } from "./lifecycle/token-budget.js";

// Token usage parsing & accumulation
export {
  parseTokenUsage,
  parseStreamTokenUsage,
  emptyAggregateTokenUsage,
  accumulateTokenUsage,
  formatTokenUsage,
} from "./lifecycle/token-usage.js";
export type { AggregateTokenUsage } from "./lifecycle/token-usage.js";

// ── Planning ──

// Task brief assembly
export {
  assembleTaskBrief,
  formatTaskBrief,
  getActionableTasks,
  collectEpicTaskIds,
  TaskNotActionableError,
} from "./planning/brief.js";
export type { AssembleBriefOptions, ActionableTask } from "./planning/brief.js";

// System prompt
export { buildSystemPrompt } from "./planning/prompt.js";

// ── Analysis ──

// Review gate
export { collectReviewDiff, promptReview, revertChanges } from "./analysis/review.js";
export type { ReviewResult, ReviewDiff } from "./analysis/review.js";

// Run summary
export { buildRunSummary } from "./analysis/summary.js";

// Stuck task detection
export { countRecentFailures, isStuckTask, getStuckTaskIds } from "./analysis/stuck.js";

// ── Validation (canonical source: ../validation/) ──

// Completion validation
export { validateCompletion, formatValidationResult } from "../validation/completion.js";
export type { CompletionValidationResult, CompletionValidationOptions } from "../validation/completion.js";
