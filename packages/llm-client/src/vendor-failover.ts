/**
 * Vendor-specific failover chains for automatic model/vendor fallback on errors.
 *
 * Encodes the ordered failover sequence when an LLM run fails with a retryable error:
 * - When the active vendor is Claude, failover tries lighter Claude models first,
 *   then crosses to Codex (starting with standard, then light tier).
 * - When the active vendor is Codex, failover tries lighter Codex models first,
 *   then crosses to Claude (starting with standard, then light tier).
 *
 * All model IDs are resolved through `resolveVendorModel()` to respect project config
 * overrides (custom models, lightModel settings, etc.), never hardcoded literals.
 *
 * Chain lengths:
 * - Claude-origin: sonnet (attempt 0) → haiku (1) → codex-standard (2) → codex-light (3) → exhausted (4+)
 * - Codex-origin: gpt-5.5 (attempt 0) → gpt-5.4-mini (1) → sonnet (2) → haiku (3) → exhausted (4+)
 *
 * The chain terminates after 3 failover attempts (attempts 1-3), with attempt 4+ reporting exhaustion.
 */

import type { LLMVendor, LLMConfig } from "./llm-types.js";
import { resolveVendorModel } from "./config.js";

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
 * - Attempt 3: codex (light/gpt-5.4-mini)
 * - Attempt 4+: exhausted
 *
 * Failover chain for Codex-origin:
 * - Attempt 1: codex (light/gpt-5.4-mini)
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
  // Attempt 0 is the original, not a failover attempt.
  if (attemptNumber === 0) {
    return { isExhausted: true };
  }

  if (originVendor === "claude") {
    return getClaudeFailoverAttempt(attemptNumber, llmConfig);
  }
  if (originVendor === "codex") {
    return getCodexFailoverAttempt(attemptNumber, llmConfig);
  }

  // Unknown vendor: exhaust immediately.
  return { isExhausted: true };
}

/**
 * Get the next failover attempt when the origin vendor is Claude.
 *
 * Sequence: haiku (light) → codex standard → codex light → exhausted
 */
function getClaudeFailoverAttempt(
  attemptNumber: number,
  llmConfig?: LLMConfig,
): FailoverAttemptResult {
  switch (attemptNumber) {
    case 1:
      // Try Claude light (haiku)
      return {
        isExhausted: false,
        vendor: "claude",
        model: resolveVendorModel("claude", llmConfig, "light"),
      };

    case 2:
      // Cross to Codex standard (gpt-5.5)
      return {
        isExhausted: false,
        vendor: "codex",
        model: resolveVendorModel("codex", llmConfig, "standard"),
      };

    case 3:
      // Try Codex light (gpt-5.4-mini)
      return {
        isExhausted: false,
        vendor: "codex",
        model: resolveVendorModel("codex", llmConfig, "light"),
      };

    default:
      // Attempt 4+ is exhausted
      return { isExhausted: true };
  }
}

/**
 * Get the next failover attempt when the origin vendor is Codex.
 *
 * Sequence: codex light → claude standard → claude light → exhausted
 */
function getCodexFailoverAttempt(
  attemptNumber: number,
  llmConfig?: LLMConfig,
): FailoverAttemptResult {
  switch (attemptNumber) {
    case 1:
      // Try Codex light (gpt-5.4-mini)
      return {
        isExhausted: false,
        vendor: "codex",
        model: resolveVendorModel("codex", llmConfig, "light"),
      };

    case 2:
      // Cross to Claude standard (sonnet)
      return {
        isExhausted: false,
        vendor: "claude",
        model: resolveVendorModel("claude", llmConfig, "standard"),
      };

    case 3:
      // Try Claude light (haiku)
      return {
        isExhausted: false,
        vendor: "claude",
        model: resolveVendorModel("claude", llmConfig, "light"),
      };

    default:
      // Attempt 4+ is exhausted
      return { isExhausted: true };
  }
}
