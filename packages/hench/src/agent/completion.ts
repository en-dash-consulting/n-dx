/**
 * Backward-compatibility re-exports.
 *
 * Completion validation has moved to `../validation/completion.js`.
 * This shim keeps existing imports working until all consumers migrate.
 */
export {
  validateCompletion,
  formatValidationResult,
} from "../validation/completion.js";

export type {
  CompletionValidationResult,
  CompletionValidationOptions,
} from "../validation/completion.js";
