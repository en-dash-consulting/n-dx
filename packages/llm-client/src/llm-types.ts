/**
 * Vendor-neutral LLM client types.
 *
 * These types define the forward-looking contract for multi-vendor support
 * while keeping the existing Claude-specific contract available for
 * backward compatibility during migration.
 */

import type { CreateClientOptions } from "./create-client.js";
import type { ClaudeClient, ClaudeConfig } from "./types.js";

// LLMVendor lives in provider-interface.ts to break the circular dependency:
//   provider-interface → llm-types → create-client → api/cli-provider → provider-interface
// Imported for local use and re-exported so all existing consumers are unaffected.
import type { LLMVendor } from "./provider-interface.js";
export type { LLMVendor };

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

/** Vendor-neutral client creation options. */
export interface CreateLLMClientOptions extends Omit<CreateClientOptions, "claudeConfig"> {
  /** Explicit vendor override. Defaults to `llmConfig.vendor` or `claude`. */
  vendor?: LLMVendor;
  /** Unified vendor config loaded from project config. */
  llmConfig?: LLMConfig;
  /**
   * Legacy Claude config override.
   * If provided, takes precedence over `llmConfig.claude`.
   */
  claudeConfig?: ClaudeConfig;
}

/** Alias that preserves migration ergonomics for downstream packages. */
export type LLMClient = ClaudeClient;
