/**
 * LLM client management bridge.
 *
 * Extracted from reason.ts to break the circular dependency between
 * reason.ts and extract.ts. Both modules can safely import from this
 * module without creating a cycle.
 *
 * Holds the module-level LLM configuration and client singleton, plus
 * the `spawnClaude()` function that sends prompts to the configured
 * LLM provider.
 *
 * @module rex/analyze/llm-bridge
 */

import type {
  ClaudeConfig,
  ClaudeClient,
  AuthMode,
  LLMConfig,
  LLMVendor,
} from "@n-dx/llm-client";
import {
  createLLMClient,
  detectLLMAuthMode,
} from "@n-dx/llm-client";

import { DEFAULT_MODEL, DEFAULT_CODEX_MODEL } from "./analyze-shared.js";
import type { ClaudeResult } from "./analyze-shared.js";

// ── Module-level LLM state ──

/**
 * Module-level Claude configuration. Set once at CLI entry points via
 * `setClaudeConfig()` so that all internal `spawnClaude()` calls inherit
 * the resolved CLI path without threading config through every function.
 */
let _llmConfig: LLMConfig | undefined;

/**
 * Module-level Claude client instance. Created lazily from the config
 * when the first LLM call is made, or set explicitly at CLI entry points.
 */
let _llmClient: ClaudeClient | undefined;

function resolveVendor(): LLMVendor {
  return _llmConfig?.vendor ?? "claude";
}

function resolveModel(model?: string): string {
  if (model) return model;
  const vendor = resolveVendor();
  if (vendor === "codex") {
    return _llmConfig?.codex?.model ?? DEFAULT_CODEX_MODEL;
  }
  return _llmConfig?.claude?.model ?? DEFAULT_MODEL;
}

// ── Public configuration API ──

export function setLLMConfig(config: LLMConfig): void {
  _llmConfig = config;
  _llmClient = undefined;
}

/**
 * Set the module-level Claude configuration (CLI path, API key, etc.).
 * Call this at CLI entry points before any LLM operations.
 * Also resets the cached client so the next call creates a fresh one
 * using the new configuration.
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
 * Set the module-level Claude client explicitly. This is useful when a
 * client has already been created at the CLI entry point.
 */
export function setClaudeClient(client: ClaudeClient): void {
  _llmClient = client;
}

/**
 * Get the current authentication mode being used for LLM calls.
 * Returns "api" when using direct API key authentication, "cli" when
 * using the Claude Code CLI binary. Returns undefined if no config
 * has been set yet.
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

export function getLLMVendor(): LLMVendor | undefined {
  if (_llmClient || _llmConfig) return resolveVendor();
  return undefined;
}

/**
 * Get or lazily create the module-level Claude client.
 * Falls back to CLI mode when no configuration is available.
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

// ── LLM interaction ──

/**
 * Send a prompt to Claude using the unified client abstraction.
 *
 * Uses the module-level `ClaudeClient` which supports both direct API
 * and CLI modes transparently. The client is configured via
 * `setClaudeConfig()` at CLI entry points. Retries are handled by the
 * underlying client provider.
 *
 * @param prompt  The prompt to send to Claude
 * @param model   The model to use (e.g., "claude-sonnet-4-20250514")
 * @param claudeConfig  Optional config override (creates a one-off client)
 */
export async function spawnClaude(prompt: string, model: string, claudeConfig?: ClaudeConfig): Promise<ClaudeResult> {
  // When an explicit config is passed, create a one-off client for it
  // instead of using the module-level client.
  const client = claudeConfig
    ? createLLMClient({
      vendor: resolveVendor(),
      llmConfig: {
        ...(_llmConfig ?? {}),
        claude: claudeConfig,
      },
    })
    : getClient();

  const result = await client.complete({ prompt, model: resolveModel(model) });
  return {
    text: result.text,
    tokenUsage: result.tokenUsage,
  };
}
