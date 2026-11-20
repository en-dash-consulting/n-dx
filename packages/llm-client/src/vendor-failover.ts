/**
 * Vendor-specific failover chains for automatic model/vendor fallback on errors.
 *
 * Encodes the ordered failover sequence when an LLM run fails with a retryable error:
 * - When the active vendor is Claude, failover tries lighter Claude models first,
 *   then crosses to Codex (starting with standard, then light tier).
 * - When the active vendor is Codex, failover tries lighter Codex models first,
 *   then crosses to Claude (starting with standard, then light tier).
 * - When the active vendor is Google, failover tries the lighter Google model first,
 *   then crosses to Claude (starting with standard, then light tier).
 *
 * All model IDs are resolved through `resolveVendorModel()` to respect project config
 * overrides (custom models, lightModel settings, etc.), never hardcoded literals.
 *
 * Chain lengths:
 * - Claude-origin: sonnet (attempt 0) → haiku (1) → codex-standard (2) → codex-light (3) → exhausted (4+)
 * - Codex-origin: gpt-5.6-terra (attempt 0) → gpt-5.6-luna (1) → sonnet (2) → haiku (3) → exhausted (4+)
 * - Google-origin: flash (attempt 0) → google-light/flash (1) → claude-standard (2) → claude-light (3) → exhausted (4+)
 *
 * The chain terminates after 3 failover attempts (attempts 1-3), with attempt 4+ reporting exhaustion.
 */

import { LLM_VENDOR, type LLMVendor, type LLMConfig, type TaskWeight } from "./llm-types.js";
import { resolveVendorModel } from "./config.js";

/** One failover step: the vendor to try and the tier its model resolves at. */
type FailoverStep = readonly [vendor: LLMVendor, weight: TaskWeight];

/**
 * Failover attempts 1–3 for each origin vendor, in order. A vendor with no
 * chain (local) exhausts immediately.
 */
const FAILOVER_CHAINS: ReadonlyMap<LLMVendor, readonly FailoverStep[]> = new Map([
  // haiku (light) → codex standard → codex light
  [LLM_VENDOR.CLAUDE, [[LLM_VENDOR.CLAUDE, "light"], [LLM_VENDOR.CODEX, "standard"], [LLM_VENDOR.CODEX, "light"]]],
  // codex light (gpt-5.6-luna) → claude standard (sonnet) → claude light (haiku)
  [LLM_VENDOR.CODEX, [[LLM_VENDOR.CODEX, "light"], [LLM_VENDOR.CLAUDE, "standard"], [LLM_VENDOR.CLAUDE, "light"]]],
  // google light (gemini-3.5-flash-lite) → claude standard (sonnet) → claude light (haiku)
  [LLM_VENDOR.GOOGLE, [[LLM_VENDOR.GOOGLE, "light"], [LLM_VENDOR.CLAUDE, "standard"], [LLM_VENDOR.CLAUDE, "light"]]],
]);

/** Result of a failover attempt query. */
export interface FailoverAttemptResult {
  /** Whether the failover chain has been exhausted. */
  isExhausted: boolean;
  /** The next vendor to try (undefined if exhausted). */
  vendor?: LLMVendor;
  /** The next model to try (undefined if exhausted). */
  model?: string;
}

/**
 * Get the next failover attempt in the chain for the given origin vendor.
 *
 * Failover chain for Claude-origin:
 * - Attempt 1: claude (light/haiku)
 * - Attempt 2: codex (standard/gpt-5.5)
 * - Attempt 3: codex (light/gpt-5.6-luna)
 * - Attempt 4+: exhausted
 *
 * Failover chain for Codex-origin:
 * - Attempt 1: codex (light/gpt-5.6-luna)
 * - Attempt 2: claude (standard/sonnet)
 * - Attempt 3: claude (light/haiku)
 * - Attempt 4+: exhausted
 *
 * Failover chain for Google-origin:
 * - Attempt 1: google (light/gemini-3.5-flash-lite)
 * - Attempt 2: claude (standard/sonnet)
 * - Attempt 3: claude (light/haiku)
 * - Attempt 4+: exhausted
 *
 * @param attemptNumber - Zero-based attempt counter. Attempt 0 is the original run;
 *                        attempts 1-3 are valid failover attempts; 4+ are exhausted.
 * @param originVendor  - The vendor that originated the failing run.
 * @param llmConfig     - Optional LLM config to resolve custom tier-specific models.
 *                        When omitted, defaults from TIER_MODELS are used.
 * @returns             - An object with `isExhausted` flag and (if not exhausted)
 *                        `vendor` and `model` fields for the next attempt.
 */
export function getNextFailoverAttempt(
  attemptNumber: number,
  originVendor: LLMVendor,
  llmConfig?: LLMConfig,
): FailoverAttemptResult {
  // Attempt 0 is the original, not a failover attempt; past the chain's end
  // (attempt 4+) and for an unknown vendor, the chain is exhausted.
  const step = attemptNumber >= 1 ? FAILOVER_CHAINS.get(originVendor)?.[attemptNumber - 1] : undefined;
  if (!step) {
    return { isExhausted: true };
  }

  const [vendor, weight] = step;
  return {
    isExhausted: false,
    vendor,
    model: resolveVendorModel(vendor, llmConfig, weight),
  };
}
