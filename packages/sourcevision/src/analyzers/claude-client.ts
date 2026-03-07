/**
 * Sourcevision LLM bridge — uses @n-dx/llm-client for vendor-aware access.
 */

import type {
  ClaudeConfig,
  ClaudeClient,
  AuthMode,
  CompletionResult,
  LLMConfig,
  LLMVendor,
} from "@n-dx/llm-client";
import {
  createLLMClient,
  detectLLMAuthMode,
  ClaudeClientError,
} from "@n-dx/llm-client";
import type { TokenUsage } from "../schema/index.js";

export { ClaudeClientError } from "@n-dx/llm-client";

export const DEFAULT_MODEL = "claude-sonnet-4-6";
export const DEFAULT_CODEX_MODEL = "gpt-5-codex";

// ── Module-level state ────────────────────────────────────────────────────────

let _llmConfig: LLMConfig | undefined;
let _llmClient: ClaudeClient | undefined;

function resolveVendor(): LLMVendor {
  return _llmConfig?.vendor ?? "claude";
}

function resolveModel(override?: string): string {
  if (override) return override;
  const vendor = resolveVendor();
  if (vendor === "codex") {
    return _llmConfig?.codex?.model ?? DEFAULT_CODEX_MODEL;
  }
  return _llmConfig?.claude?.model ?? DEFAULT_MODEL;
}

/**
 * Set the module-level LLM configuration.
 * Call this at CLI entry points before any LLM operations.
 * Resets the cached client so the next call creates a fresh one.
 */
export function setLLMConfig(config: LLMConfig): void {
  _llmConfig = config;
  _llmClient = undefined;
}

/**
 * Legacy compatibility setter for call-sites still passing only claude config.
 */
export function setClaudeConfig(config: ClaudeConfig): void {
  _llmConfig = {
    ...(_llmConfig ?? {}),
    claude: config,
    vendor: _llmConfig?.vendor ?? "claude",
  };
  _llmClient = undefined;
}

/**
 * Set the module-level LLM client explicitly. This is useful when a
 * client has already been created at the CLI entry point, or for testing.
 */
export function setLLMClient(client: ClaudeClient): void {
  _llmClient = client;
}

/** Legacy compatibility alias. */
export function setClaudeClient(client: ClaudeClient): void {
  setLLMClient(client);
}

/**
 * Get the current authentication mode being used for LLM calls.
 * Returns "api" when using direct API key authentication, "cli" when
 * using CLI execution. Returns undefined if no config has been set yet.
 */
export function getAuthMode(): AuthMode | undefined {
  if (_llmClient) return _llmClient.mode;
  if (_llmConfig) {
    return detectLLMAuthMode({
      vendor: resolveVendor(),
      llmConfig: _llmConfig,
    });
  }
  return undefined;
}

/** Return the active LLM vendor for enrichment/classification calls. */
export function getLLMVendor(): LLMVendor | undefined {
  if (_llmClient) return resolveVendor();
  if (_llmConfig) return resolveVendor();
  return undefined;
}

/**
 * Get or lazily create the module-level LLM client.
 * Falls back to Claude CLI mode when no configuration is available.
 */
function getClient(): ClaudeClient {
  if (_llmClient) return _llmClient;
  const llmConfig = _llmConfig ?? {};
  _llmClient = createLLMClient({
    vendor: resolveVendor(),
    llmConfig,
  });
  return _llmClient;
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
    model: resolveModel(model),
  });
  return {
    text: result.text,
    tokenUsage: result.tokenUsage,
  };
}

/** Vendor-neutral alias for call sites migrating away from Claude naming. */
export const callLLM = callClaude;
