/**
 * Vendor-neutral client factory.
 *
 * Current support:
 * - Claude: dual provider stack (API + CLI)
 * - Codex: CLI provider (`codex exec`)
 */

import { createClient, detectAuthMode, type CreateClientOptions } from "./create-client.js";
import type { AuthMode, ClaudeClient, ClaudeConfig } from "./types.js";
import type { LLMVendor, LLMConfig } from "./llm-types.js";
import { createCodexCliClient } from "./codex-cli-provider.js";

/**
 * Vendor-neutral client creation options.
 *
 * Extends {@link CreateClientOptions} (minus the required `claudeConfig`) with
 * vendor selection and a unified LLM config bag. Lives here — alongside the
 * factory it parameterises — rather than in `llm-types.ts`, keeping that
 * module free of implementation-layer dependencies.
 */
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

function resolveVendor(options: CreateLLMClientOptions): LLMVendor {
  return options.vendor ?? options.llmConfig?.vendor ?? "claude";
}

/**
 * Detect auth mode for the resolved vendor.
 *
 * For now this delegates to Claude's auth-mode detection. Codex returns `cli`
 * as a conservative default until its provider adapters are implemented.
 */
export function detectLLMAuthMode(options: CreateLLMClientOptions): AuthMode {
  const vendor = resolveVendor(options);
  if (vendor === "codex") return "cli";

  const claudeConfig = options.claudeConfig ?? options.llmConfig?.claude ?? {};
  return detectAuthMode({
    claudeConfig,
    apiKeyEnv: options.apiKeyEnv,
  });
}

/**
 * Create a vendor-neutral LLM client.
 *
 * Claude uses the production-ready dual provider implementation.
 * Codex currently uses a CLI provider adapter.
 */
export function createLLMClient(options: CreateLLMClientOptions): ClaudeClient {
  const vendor = resolveVendor(options);

  if (vendor === "codex") {
    return createCodexCliClient({
      codexConfig: options.llmConfig?.codex,
    });
  }

  const claudeConfig = options.claudeConfig ?? options.llmConfig?.claude ?? {};
  return createClient({
    ...options,
    claudeConfig,
  });
}
