/**
 * Project-level configuration loading for rex.
 *
 * Core utilities (deepMerge, loadProjectOverrides, mergeWithOverrides) are
 * shared from @n-dx/llm-client. This module re-exports them and adds
 * the thin configDir→projectDir adapter for Claude config that rex consumers
 * expect.
 */

import { dirname } from "node:path";
import {
  loadClaudeConfig as loadClaudeConfigFromDir,
  loadLLMConfig as loadLLMConfigFromDir,
  resolveApiKey as sharedResolveApiKey,
  resolveCliPath as sharedResolveCliPath,
} from "@n-dx/llm-client";
import type { ClaudeConfig, LLMConfig } from "@n-dx/llm-client";

// Re-export the shared ClaudeConfig type so existing consumers keep working
export type { ClaudeConfig, LLMConfig } from "@n-dx/llm-client";

// Re-export shared project config utilities — previously duplicated here.
export { loadProjectOverrides, mergeWithOverrides } from "@n-dx/llm-client";

/**
 * Load the "claude" section from .n-dx.json.
 * Returns an empty object if the file doesn't exist, is invalid, or has no claude section.
 *
 * Delegates to @n-dx/llm-client's loadClaudeConfig, adapting the rex
 * convention of passing a configDir (e.g., /project/.rex) instead of the
 * project root directory.
 *
 * @param configDir The package config directory (e.g., /project/.rex)
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
 * @param configDir The package config directory (e.g., /project/.rex)
 */
export async function loadLLMConfig(
  configDir: string,
): Promise<LLMConfig> {
  const projectDir = dirname(configDir);
  return loadLLMConfigFromDir(projectDir);
}

/**
 * Resolve the API key with the following priority:
 * 1. claude.api_key from unified config (.n-dx.json)
 * 2. Environment variable specified by apiKeyEnv (default: ANTHROPIC_API_KEY)
 *
 * @returns The resolved API key, or undefined if not found.
 */
export function resolveApiKey(
  claudeConfig: ClaudeConfig,
  apiKeyEnv = "ANTHROPIC_API_KEY",
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
