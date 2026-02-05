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
 * Tool definitions and implementations live in `../tools/`.
 */

// Agent loops
export { agentLoop } from "./loop.js";
export type { AgentLoopOptions, AgentLoopResult } from "./loop.js";
export { cliLoop } from "./cli-loop.js";
export type { CliLoopOptions, CliLoopResult } from "./cli-loop.js";

// Task brief assembly
export {
  assembleTaskBrief,
  formatTaskBrief,
  getActionableTasks,
  collectEpicTaskIds,
  TaskNotActionableError,
} from "./brief.js";
export type { AssembleBriefOptions, ActionableTask } from "./brief.js";

// System prompt
export { buildSystemPrompt } from "./prompt.js";

// Completion validation (canonical source: ../validation/)
export { validateCompletion, formatValidationResult } from "../validation/completion.js";
export type { CompletionValidationResult, CompletionValidationOptions } from "../validation/completion.js";

// Review gate
export { collectReviewDiff, promptReview, revertChanges } from "./review.js";
export type { ReviewResult, ReviewDiff } from "./review.js";

// Token budget
export { checkTokenBudget } from "./token-budget.js";
export type { TokenBudgetResult } from "./token-budget.js";

// Run summary
export { buildRunSummary } from "./summary.js";

// Stuck task detection
export { countRecentFailures, isStuckTask, getStuckTaskIds } from "./stuck.js";
