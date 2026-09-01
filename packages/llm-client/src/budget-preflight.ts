/**
 * Budget preflight — prompt-size and cost estimation before sending a request.
 *
 * Uses MODEL_CONTEXT_WINDOWS and MODEL_COSTS from config.ts to determine whether
 * a prompt fits within a model's context window and to estimate the input cost
 * of the request. Only the input side is priced — see `estimatedCostUsd` below.
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
   * Estimated **input** cost in USD: `tokenEstimate × the input rate of the
   * applicable pricing tier`. Undefined when the model has no entry in
   * MODEL_COSTS.
   *
   * This is not a total-cost estimate. The tier's `outputPerMToken` is not
   * applied — preflight runs before generation, so the output token count is
   * unknown here. On generation-heavy requests output dominates cost, so treat
   * this as a floor. See the MODEL_COSTS doc comment in config.ts.
   */
  estimatedCostUsd: number | undefined;
  /**
   * Which pricing tier `estimatedCostUsd` was computed at — `"base"`, or
   * `"aboveThreshold"` when the prompt crossed the model's long-context
   * threshold. Undefined when the model has no entry in MODEL_COSTS.
   *
   * Exposed so a cost estimate is auditable: without it, a caller comparing the
   * figure against a rate in MODEL_COSTS cannot tell which rate was used.
   */
  costTier: "base" | "aboveThreshold" | undefined;
}

/**
 * Run a budget preflight check for a prompt against the given model.
 *
 * Estimates token count using the 4-chars-per-token approximation and checks
 * whether the estimate fits within 90% of the model's context window. Also
 * computes the estimated input cost when pricing data is available — input only,
 * never a total; `outputPerMToken` is not applied here. For models with a
 * long-context premium the rate is selected from the tier the estimate falls in,
 * and `costTier` reports which one was used.
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
  // Select the pricing tier before multiplying: a vendor with a long-context
  // premium charges the higher rate for the whole prompt once it crosses the
  // threshold, so pricing a large prompt at the base rate under-reports.
  const tier = costs?.aboveThreshold;
  const useAboveThreshold = tier !== undefined && tokenEstimate > tier.thresholdTokens;
  const costTier = costs === undefined ? undefined : useAboveThreshold ? "aboveThreshold" : "base";
  const inputRate = useAboveThreshold ? tier.inputPerMToken : costs?.inputPerMToken;
  const estimatedCostUsd =
    inputRate !== undefined ? (tokenEstimate / 1_000_000) * inputRate : undefined;

  return {
    modelId,
    fits,
    tokenEstimate,
    contextWindow,
    utilizationPercent,
    estimatedCostUsd,
    costTier,
  };
}
