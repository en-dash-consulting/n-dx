/**
 * Vendor-neutral LLM client types.
 *
 * These types define the forward-looking contract for multi-vendor support
 * while keeping the existing Claude-specific contract available for
 * backward compatibility during migration.
 *
 * ## Dependency note
 *
 * This module imports only from foundational leaf modules (`types.ts`,
 * `provider-interface.ts`). Factory-level types such as
 * `CreateLLMClientOptions` live in `llm-client.ts` alongside the factory
 * function they parameterise, keeping this file free of implementation
 * dependencies.
 */

import type { ClaudeClient, ClaudeConfig } from "./types.js";

// LLMVendor is defined in provider-interface.ts (its natural home as part of
// the provider contract). Re-exported here so consumers can import it from
// the vendor-neutral types module without knowing its origin.
import type { LLMVendor } from "./provider-interface.js";
export type { LLMVendor };

/**
 * Task weight for model tier selection.
 *
 * - `light` — simple classification and other explicitly low-complexity work
 * - `standard` — multi-turn agents, deep analysis, full-capability tasks
 *
 * Used by `resolveVendorModel()` to select the appropriate model tier.
 * When omitted, defaults to 'standard' for backward compatibility.
 */
export type TaskWeight = "light" | "standard";

/** Optional Codex-specific config section in `.n-dx.json`. */
export interface CodexConfig {
  /** Path to Codex CLI binary. Defaults to `codex`. */
  cli_path?: string;
  /** API key used by future Codex API providers. */
  api_key?: string;
  /** Optional custom API endpoint. */
  api_endpoint?: string;
  /** Default model for Codex requests. */
  model?: string;
  /**
   * Model override for the 'light' task weight tier.
   * When set, resolveVendorModel uses this model for light-weight tasks
   * instead of TIER_MODELS.codex.light.
   */
  lightModel?: string;
}

/** Vendor-neutral config shape loaded from `.n-dx.json`. */
export interface LLMConfig {
  /** Default vendor selected by the project. */
  vendor?: LLMVendor;
  /** Claude-specific config (legacy + active). */
  claude?: ClaudeConfig;
  /** Codex-specific config (reserved for adapter integration). */
  codex?: CodexConfig;
}

/** Alias that preserves migration ergonomics for downstream packages. */
export type LLMClient = ClaudeClient;
