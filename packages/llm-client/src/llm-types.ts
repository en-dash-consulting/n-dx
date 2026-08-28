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
import {
  DEFAULT_LLM_VENDOR,
  LLM_VENDOR,
  LLM_VENDORS,
  isLLMVendor,
  type LLMVendor,
} from "./provider-interface.js";
export {
  DEFAULT_LLM_VENDOR,
  LLM_VENDOR,
  LLM_VENDORS,
  isLLMVendor,
};
export type { LLMVendor };

/**
 * Task weight for model tier selection.
 *
 * - `light` — simple classification and other explicitly low-complexity work
 * - `standard` — multi-turn agents, deep analysis, full-capability tasks
 * - `heavy` — maximum capability: complex reasoning, long-horizon tasks
 *
 * Used by `resolveVendorModel()` to select the appropriate model tier.
 * When omitted, defaults to 'standard' for backward compatibility.
 */
export type TaskWeight = "light" | "standard" | "heavy";

/**
 * A routing tier: the three vendor-catalog weights plus `free`, the
 * zero-cost tier served by a locally configured model. `free` has no
 * catalog entry — a route that names it falls through to `light` unless
 * `llm.tiers.<vendor>.free` supplies a model.
 */
export type TaskTier = TaskWeight | "free";

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
  /**
   * Model override for the adversarial review pass (`ndx work --review`).
   * When set, the reviewer runs on this model instead of the recommended
   * default in `REVIEW_MODELS`. The `--review-model` CLI flag outranks it.
   */
  reviewModel?: string;
}

/**
 * Config for a second local model that reviews primary output.
 *
 * When set, hench queries this endpoint after the primary model finishes a task
 * and asks it to verify the solution against the task requirements. If the
 * verifier returns FAIL, it feeds the reasoning back to the primary as a new
 * user message and lets it revise — up to `maxCycles` times.
 *
 * The verifier needs no tool access; any chat-completion endpoint works.
 * A smaller/faster model is a good choice (lower VRAM, lower latency).
 */
export interface LocalVerifierConfig {
  /** Host for the verifier server. Defaults to `"localhost"`. */
  host?: string;
  /** Port for the verifier server. Defaults to `1235`. */
  port?: number;
  /** Model to use on the verifier endpoint. When unset, uses whatever is loaded. */
  model?: string;
  /**
   * Maximum number of FAIL → revise cycles per run (default: 2).
   * Once exhausted the run finalizes with whatever state the primary is in.
   */
  maxCycles?: number;
}

/** Optional local model config section in `.n-dx.json` (e.g. LM Studio). */
export interface LocalConfig {
  /** Host for the local server. Defaults to `"localhost"`. */
  host?: string;
  /** Port for the local server. Defaults to `1234` (LM Studio default). */
  port?: number;
  /** Default model for local requests. When unset, the server uses whichever model is currently loaded. */
  model?: string;
  /**
   * Model override for the 'light' task weight tier.
   * When set, resolveVendorModel uses this model for light-weight tasks.
   */
  lightModel?: string;
  /**
   * Model override for the adversarial review pass (`ndx work --review`).
   * When set, the reviewer runs on this model instead of the recommended
   * default in `REVIEW_MODELS`. The `--review-model` CLI flag outranks it.
   */
  reviewModel?: string;
  /**
   * Maximum context window size in tokens for the local model.
   *
   * When set, hench will check whether the assembled brief fits before
   * sending it to LM Studio. If the estimated token count exceeds this value,
   * the run will fail fast with a clear error instead of a cryptic HTTP 400.
   *
   * Typical values: 8192 (LM Studio default), 32768, 65536, 131072.
   * Set this to match "Context Length" in your LM Studio model settings.
   *
   * If unset, no pre-send check is performed; the server error is still
   * surfaced with actionable guidance via parseLmStudioError.
   */
  maxContextTokens?: number;
  /**
   * Second-model verifier. When set, hench sends the primary model's completed
   * solution to this endpoint for review before finalizing the run.
   *
   * Example (two LM Studio instances, or one Ollama serving two models):
   * ```json
   * "verifier": { "port": 1235, "model": "qwen2.5-7b", "maxCycles": 2 }
   * ```
   */
  verifier?: LocalVerifierConfig;
  /**
   * Saved connection profiles ({name, host, port, model}), managed entirely
   * by the web dashboard's LLM Provider page (Settings → General → Local).
   * Not read by hench, rex, or any CLI at runtime — applying a profile just
   * copies its fields into `host`/`port`/`model` above.
   */
  profiles?: Array<{ name: string; host: string; port: number; model: string }>;
}

/** Optional Google Gemini-specific config section in `.n-dx.json`. */
export interface GoogleConfig {
  /** Google API key (from Google AI Studio or GCP). */
  api_key?: string;
  /** Custom API endpoint base URL. When set, overrides the default Gemini URL. */
  api_endpoint?: string;
  /** Default Gemini model ID (e.g. `"gemini-2.5-pro"`). */
  model?: string;
  /**
   * Model override for the 'light' task weight tier.
   * When set, resolveVendorModel uses this model for light-weight tasks
   * instead of TIER_MODELS.google.light.
   */
  lightModel?: string;
  /**
   * Model override for the adversarial review pass (`ndx work --review`).
   * When set, the reviewer runs on this model instead of the recommended
   * default in `REVIEW_MODELS`. The `--review-model` CLI flag outranks it.
   */
  reviewModel?: string;
  /**
   * Environment variable name for the Google API key.
   * Defaults to `"GEMINI_API_KEY"` when not set.
   * Override to use a custom env var name (e.g. `"MY_GOOGLE_KEY"`).
   */
  apiKeyEnv?: string;
}

/** Vendor-neutral config shape loaded from `.n-dx.json`. */
export interface LLMConfig {
  /** Default vendor selected by the project. */
  vendor?: LLMVendor;
  /**
   * Top-level model override for the active vendor. When set, this wins over
   * `claude.model`/`codex.model` so users can switch the active model with a
   * single edit without having to clear the vendor-pinned slot written by
   * `ndx init`.
   */
  model?: string;
  /**
   * Vendor-neutral model override for the adversarial review pass
   * (`ndx work --review`). Outranked by `<vendor>.reviewModel` and by the
   * `--review-model` CLI flag; outranks the `REVIEW_MODELS` default.
   *
   * Deliberately separate from `model`: the execution model must never be
   * inherited as the review model, or pinning a cheap executor would silently
   * downgrade every review.
   */
  reviewModel?: string;
  /** Claude-specific config (legacy + active). */
  claude?: ClaudeConfig;
  /** Codex-specific config (reserved for adapter integration). */
  codex?: CodexConfig;
  /** Google Gemini-specific config. */
  google?: GoogleConfig;
  /** Local model config (LM Studio or other OpenAI-compatible local servers). */
  local?: LocalConfig;
  /**
   * Enable automatic failover on model/vendor errors.
   * When true, hench retries failed runs on fallback models before surfacing errors.
   * Default: false (disabled for backward compatibility).
   */
  autoFailover?: boolean;
  /**
   * Tier → model overrides per vendor (`llm.tiers.<vendor>.<tier>`).
   * Consulted by `resolveTaskModel` after routing picks a tier, ahead of the
   * legacy per-vendor slots (`lightModel`, `model`) and the `TIER_MODELS`
   * catalog. The only place the `free` tier can be given a model.
   */
  tiers?: Partial<Record<LLMVendor, Partial<Record<TaskTier, string>>>>;
  /**
   * Task class → tier routes (`llm.routes.<class>`). Keys are exact class
   * names (`"prd.rename"`) or glob prefixes (`"prd.*"`, `"*"`); exact wins
   * over glob, longer prefixes over shorter. Values name a {@link TaskTier};
   * an unrecognized value degrades to `standard` rather than erroring.
   */
  routes?: Record<string, string>;
  /**
   * Task class → effort level (`llm.effort.<class>`), matched with the same
   * exact-then-glob rules as `routes`. Returned verbatim by
   * `resolveTaskModel` for callers that pass `--effort` / `output_config`.
   */
  effort?: Record<string, string>;
  /**
   * Escalation policy for light-first task classes: retry a failed
   * light-tier call once on the standard tier with the validation error
   * appended. Declared here so config can round-trip it; the ladder itself
   * is implemented by the callers that validate light-tier output.
   */
  escalation?: { enabled?: boolean; maxSteps?: number };
}

/** Alias that preserves migration ergonomics for downstream packages. */
export type LLMClient = ClaudeClient;
