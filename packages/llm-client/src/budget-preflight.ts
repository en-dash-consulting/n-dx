/**
 * Budget preflight — prompt-size and cost estimation before sending a request.
 *
 * Uses MODEL_CONTEXT_WINDOWS and MODEL_COSTS from config.ts to determine whether
 * a prompt fits within a model's context window and to estimate the request cost.
 *
 * ## Usage
 *
 * ```ts
 * const result = budgetPreflight("gemini-2.5-pro", promptText.length);
 * if (!result.fits) {
 *   throw new Error(`Prompt exceeds ${result.contextWindow} token context window`);
 * }
 * console.log(`Estimated cost: $${result.estimatedCostUsd?.toFixed(4)}`);
 * ```
 */

import { MODEL_CONTEXT_WINDOWS, MODEL_COSTS } from "./config.js";

/** Conservative fallback context window used when the model is not in MODEL_CONTEXT_WINDOWS. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/**
 * Maximum safe utilization fraction before a prompt is considered too large.
 * Leaves headroom for system prompt, tool definitions, and output tokens.
 */
const MAX_UTILIZATION = 0.9;

/** Approximate characters-per-token ratio for English prose. */
const CHARS_PER_TOKEN = 4;

/** Result returned by budgetPreflight. */
export interface BudgetPreflightResult {
  /** The model ID that was checked. */
  modelId: string;
  /** True when the estimated token count fits within MAX_UTILIZATION of the context window. */
  fits: boolean;
  /** Estimated input token count (promptCharCount / CHARS_PER_TOKEN, rounded up). */
  tokenEstimate: number;
  /** Context window size in tokens for this model (from MODEL_CONTEXT_WINDOWS or the default). */
  contextWindow: number;
  /** Estimated utilization as a percentage (0–100+). Values above 90 fail the fits check. */
  utilizationPercent: number;
  /**
   * Estimated input cost in USD based on MODEL_COSTS.inputPerMToken.
   * Undefined when the model has no entry in MODEL_COSTS.
   */
  estimatedCostUsd: number | undefined;
}

/**
 * Run a budget preflight check for a prompt against the given model.
 *
 * Estimates token count using the 4-chars-per-token approximation and checks
 * whether the estimate fits within 90% of the model's context window. Also
 * computes the estimated input cost when pricing data is available.
 *
 * @param modelId        The canonical model identifier (e.g. "gemini-2.5-pro").
 * @param promptCharCount  Number of characters in the prompt text.
 * @returns              BudgetPreflightResult with fits flag, estimates, and cost.
 */
export function budgetPreflight(
  modelId: string,
  promptCharCount: number,
): BudgetPreflightResult {
  const tokenEstimate = Math.ceil(promptCharCount / CHARS_PER_TOKEN);
  const contextWindow = MODEL_CONTEXT_WINDOWS[modelId] ?? DEFAULT_CONTEXT_WINDOW;
  const utilizationPercent = (tokenEstimate / contextWindow) * 100;
  const fits = tokenEstimate <= contextWindow * MAX_UTILIZATION;

  const costs = MODEL_COSTS[modelId];
  const estimatedCostUsd =
    costs !== undefined ? (tokenEstimate / 1_000_000) * costs.inputPerMToken : undefined;

  return {
    modelId,
    fits,
    tokenEstimate,
    contextWindow,
    utilizationPercent,
    estimatedCostUsd,
  };
}
