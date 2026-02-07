/**
 * Claude client integration — uses @n-dx/claude-client for unified API/CLI access.
 */

import type { ClaudeConfig, ClaudeClient, AuthMode, CompletionResult } from "@n-dx/claude-client";
import { createClient, detectAuthMode, ClaudeClientError } from "@n-dx/claude-client";
import type { TokenUsage } from "../schema/index.js";

export { ClaudeClientError } from "@n-dx/claude-client";

export const DEFAULT_MODEL = "claude-sonnet-4-20250514";

// ── Module-level state ────────────────────────────────────────────────────────

let _claudeConfig: ClaudeConfig | undefined;
let _claudeClient: ClaudeClient | undefined;

/**
 * Set the module-level Claude configuration (CLI path, API key, etc.).
 * Call this at CLI entry points before any LLM operations.
 * Resets the cached client so the next call creates a fresh one.
 */
export function setClaudeConfig(config: ClaudeConfig): void {
  _claudeConfig = config;
  _claudeClient = undefined;
}

/**
 * Get the current authentication mode being used for LLM calls.
 * Returns "api" when using direct API key authentication, "cli" when
 * using the Claude Code CLI binary. Returns undefined if no config
 * has been set yet.
 */
export function getAuthMode(): AuthMode | undefined {
  if (_claudeClient) return _claudeClient.mode;
  if (_claudeConfig) return detectAuthMode({ claudeConfig: _claudeConfig });
  return undefined;
}

/**
 * Get or lazily create the module-level Claude client.
 * Falls back to CLI mode when no configuration is available.
 */
function getClient(): ClaudeClient {
  if (_claudeClient) return _claudeClient;
  const config = _claudeConfig ?? {};
  _claudeClient = createClient({ claudeConfig: config });
  return _claudeClient;
}

// ── Public call interface ────────────────────────────────────────────────────

export interface CallClaudeResult {
  text: string;
  tokenUsage?: TokenUsage;
}

/**
 * Send a prompt to Claude using the unified client abstraction.
 * Throws ClaudeClientError on failure instead of returning a result object.
 *
 * @param prompt  The prompt to send to Claude
 * @param model   The model to use (defaults to DEFAULT_MODEL)
 */
export async function callClaude(prompt: string, model?: string): Promise<CallClaudeResult> {
  const client = getClient();
  const result: CompletionResult = await client.complete({
    prompt,
    model: model ?? _claudeConfig?.model ?? DEFAULT_MODEL,
  });
  return {
    text: result.text,
    tokenUsage: result.tokenUsage,
  };
}
