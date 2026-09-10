/**
 * Model-aware token pricing.
 *
 * One arithmetic and one price table for every surface that quotes a dollar
 * figure — `ndx usage`, `ndx status`, and the dashboard's spend views. Before
 * this module each surface carried its own `DEFAULT_PRICING` literal at Claude
 * Sonnet rates and applied it to every token regardless of which model spent
 * it, so a repo configured for Opus (5/25 rather than 3/15) had its bill
 * under-reported by exactly the Sonnet-to-Opus ratio.
 *
 * The rates live in `config.ts` next to `TIER_MODELS`, which already knows
 * every model id the toolkit can select. This module is the lookup and the
 * multiplication over them.
 *
 * Architectural note: this is foundation tier, so rex and web both import it
 * directly. That is deliberate — a shared table that either package copies is
 * a table that will drift.
 */

import { MODEL_COSTS, resolveModel, normalizeCodexModel, type ModelCost } from "./config.js";

/** Per-million-token rates for all four billed token kinds. */
export interface ModelTokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  /** Writing a token to the prompt cache. At or above the input rate. */
  cacheWritePerMillion: number;
  /** Reading a token back from the prompt cache. Below the input rate. */
  cacheReadPerMillion: number;
}

/**
 * The model an unrecognised (or unrecorded) model id is priced as.
 *
 * Sonnet is the toolkit's standard tier, so it is the least-wrong single guess.
 * It is still a guess: callers must surface `known: false` rather than passing
 * a fallback-priced figure off as measured. Pricing an unknown model at zero
 * would be worse than being wrong — it would read as "this cost nothing".
 */
export const FALLBACK_PRICING_MODEL = "claude-sonnet-5";

/** Rates applied when a model id cannot be resolved. See {@link FALLBACK_PRICING_MODEL}. */
export const FALLBACK_MODEL_PRICING: ModelTokenPricing = toPricing(
  MODEL_COSTS[FALLBACK_PRICING_MODEL],
);

/** Outcome of a model-id lookup against {@link MODEL_COSTS}. */
export interface ResolvedModelPricing {
  /** The catalog id the rates came from, or {@link FALLBACK_PRICING_MODEL}. */
  modelId: string;
  pricing: ModelTokenPricing;
  /** False when the requested id was absent from the table and the fallback was used. */
  known: boolean;
}

/** Adapt a catalog entry to the per-million naming used by cost estimation. */
function toPricing(cost: ModelCost): ModelTokenPricing {
  return {
    inputPerMillion: cost.inputPerMToken,
    outputPerMillion: cost.outputPerMToken,
    cacheWritePerMillion: cost.cacheWritePerMToken,
    cacheReadPerMillion: cost.cacheReadPerMToken,
  };
}

/**
 * Resolve rates for a recorded model id.
 *
 * Recorded ids are not guaranteed to be catalog ids: a run may have stored a
 * CLI shorthand (`opus`), a Codex model since retired and remapped
 * (`gpt-5.4`), or a placeholder written by an older recorder (`unknown`).
 * Lookup therefore tries, in order: the id as given, the Claude alias
 * expansion, the Codex legacy remap, and a case-normalised retry — then falls
 * back with `known: false`.
 */
export function resolveModelPricing(modelId?: string): ResolvedModelPricing {
  const raw = modelId?.trim();
  if (raw) {
    for (const candidate of [raw, resolveModel(raw), normalizeCodexModel(raw), raw.toLowerCase()]) {
      const cost = MODEL_COSTS[candidate];
      if (cost) return { modelId: candidate, pricing: toPricing(cost), known: true };
    }
  }
  return {
    modelId: FALLBACK_PRICING_MODEL,
    pricing: FALLBACK_MODEL_PRICING,
    known: false,
  };
}

/** The four billed token counts for one bucket of usage. */
export interface BillableTokens {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

/** Cost of one bucket of usage, split by token kind. */
export interface TokenCostBreakdown {
  inputCost: number;
  outputCost: number;
  cacheWriteCost: number;
  cacheReadCost: number;
  totalRaw: number;
}

/**
 * Price a bucket of tokens at one model's rates.
 *
 * All four kinds are billed. Cache tokens used to be omitted entirely, which
 * on a cache-heavy agent workload was not an approximation but an
 * order-of-magnitude error — and it hid the one term the cost work exists to
 * move.
 */
export function priceTokens(
  tokens: BillableTokens,
  pricing: ModelTokenPricing,
): TokenCostBreakdown {
  const inputCost = (tokens.inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputCost = (tokens.outputTokens / 1_000_000) * pricing.outputPerMillion;
  const cacheWriteCost = (tokens.cacheCreationTokens / 1_000_000) * pricing.cacheWritePerMillion;
  const cacheReadCost = (tokens.cacheReadTokens / 1_000_000) * pricing.cacheReadPerMillion;
  return {
    inputCost,
    outputCost,
    cacheWriteCost,
    cacheReadCost,
    totalRaw: inputCost + outputCost + cacheWriteCost + cacheReadCost,
  };
}
