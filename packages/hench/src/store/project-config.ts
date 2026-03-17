/**
 * Project-level configuration loading for hench.
 *
 * Core utilities (deepMerge, loadProjectOverrides, mergeWithOverrides) are
 * shared from @n-dx/llm-client. This module re-exports them and adds
 * the thin configDir→projectDir adapter for Claude config that hench consumers
 * expect.
 */

import { dirname } from "node:path";
import {
  loadClaudeConfig as loadClaudeConfigFromDir,
  loadLLMConfig as loadLLMConfigFromDir,
  resolveApiKey as sharedResolveApiKey,
  resolveCliPath as sharedResolveCliPath,
} from "../prd/llm-gateway.js";
import type { ClaudeConfig, LLMConfig, LLMVendor } from "../prd/llm-gateway.js";

// Re-export the shared ClaudeConfig type so existing consumers keep working
export type { ClaudeConfig, LLMConfig, LLMVendor } from "../prd/llm-gateway.js";

// Re-export shared project config utilities — previously duplicated here.
export { loadProjectOverrides, mergeWithOverrides } from "../prd/llm-gateway.js";

/**
 * Load the "claude" section from .n-dx.json.
 * Returns an empty object if the file doesn't exist, is invalid, or has no claude section.
 *
 * Delegates to @n-dx/llm-client's loadClaudeConfig, adapting the hench
 * convention of passing a configDir (e.g., /project/.hench) instead of the
 * project root directory.
 *
 * @param configDir The package config directory (e.g., /project/.hench)
 */
export async function loadClaudeConfig(
  configDir: string,
): Promise<ClaudeConfig> {
  const projectDir = dirname(configDir);
  return loadClaudeConfigFromDir(projectDir);
}

/**
 * Load the vendor-neutral llm section from .n-dx.json.
 *
 * @param configDir The package config directory (e.g., /project/.hench)
 */
export async function loadLLMConfig(
  configDir: string,
): Promise<LLMConfig> {
  const projectDir = dirname(configDir);
  return loadLLMConfigFromDir(projectDir);
}

export function resolveLLMVendor(llmConfig: LLMConfig): LLMVendor {
  return llmConfig.vendor ?? "claude";
}

/**
 * Resolve active vendor CLI binary.
 * - codex: llm.codex.cli_path or "codex"
 * - claude: llm.claude.cli_path / legacy claude.cli_path or "claude"
 */
export function resolveVendorCliPath(llmConfig: LLMConfig): string {
  const vendor = resolveLLMVendor(llmConfig);
  if (vendor === "codex") {
    return llmConfig.codex?.cli_path ?? "codex";
  }
  return sharedResolveCliPath(llmConfig.claude ?? {});
}

/**
 * Build the environment object to pass to the vendor CLI subprocess.
 *
 * Injects the vendor-specific API key from project config so that binaries
 * receive it even when it is not set in the system environment:
 * - codex: llm.codex.api_key → OPENAI_API_KEY
 * - claude: llm.claude.api_key → ANTHROPIC_API_KEY
 *
 * Falls back to process.env unchanged when no config-supplied key is present.
 */
export function resolveVendorCliEnv(llmConfig: LLMConfig): NodeJS.ProcessEnv {
  // Strip CLAUDECODE so spawned claude processes don't think they're nested
  // inside an interactive Claude Code session (breaks background/server usage).
  const { CLAUDECODE: _, ...baseEnv } = process.env;
  const vendor = resolveLLMVendor(llmConfig);
  if (vendor === "codex") {
    const apiKey = llmConfig.codex?.api_key;
    if (apiKey) {
      return { ...baseEnv, OPENAI_API_KEY: apiKey };
    }
  } else {
    const apiKey = llmConfig.claude?.api_key;
    if (apiKey) {
      return { ...baseEnv, ANTHROPIC_API_KEY: apiKey };
    }
  }
  return baseEnv;
}

/**
 * Resolve the API key with the following priority:
 * 1. claude.api_key from unified config (.n-dx.json)
 * 2. Environment variable specified by config.apiKeyEnv (default: ANTHROPIC_API_KEY)
 *
 * @returns The resolved API key, or undefined if not found.
 */
export function resolveApiKey(
  claudeConfig: ClaudeConfig,
  apiKeyEnv: string,
): string | undefined {
  return sharedResolveApiKey(claudeConfig, apiKeyEnv);
}

/**
 * Resolve the Claude CLI binary path with the following priority:
 * 1. claude.cli_path from unified config (.n-dx.json)
 * 2. "claude" (found on PATH)
 *
 * @returns The resolved binary path.
 */
export function resolveCliPath(claudeConfig: ClaudeConfig): string {
  return sharedResolveCliPath(claudeConfig);
}
