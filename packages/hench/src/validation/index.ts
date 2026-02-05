/**
 * Shared validation utilities.
 *
 * These are used by both hench-core (agent loops) and hench-tooling
 * (rex tool completion gate). Keeping them in a separate module avoids
 * cross-boundary imports between agent and tools.
 */
export {
  validateCompletion,
  formatValidationResult,
} from "./completion.js";

export type {
  CompletionValidationResult,
  CompletionValidationOptions,
} from "./completion.js";
