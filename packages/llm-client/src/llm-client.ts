/**
 * Vendor-neutral client factory.
 *
 * Current support:
 * - Claude: dual provider stack (API + CLI)
 * - Codex: CLI provider (`codex exec`)
 */

import { createClient, detectAuthMode } from "./create-client.js";
import type { AuthMode, ClaudeClient } from "./types.js";
import type { CreateLLMClientOptions, LLMVendor } from "./llm-types.js";
import { createCodexCliClient } from "./codex-cli-provider.js";

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
