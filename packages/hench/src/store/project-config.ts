/**
 * Project-level configuration loading for hench.
 *
 * Core utilities (deepMerge, loadProjectOverrides, mergeWithOverrides) are
 * shared from @n-dx/claude-client. This module re-exports them and adds
 * the thin configDir→projectDir adapter for Claude config that hench consumers
 * expect.
 */

import { dirname } from "node:path";
import {
  loadClaudeConfig as loadClaudeConfigFromDir,
  resolveApiKey as sharedResolveApiKey,
  resolveCliPath as sharedResolveCliPath,
} from "@n-dx/claude-client";
import type { ClaudeConfig } from "@n-dx/claude-client";

// Re-export the shared ClaudeConfig type so existing consumers keep working
export type { ClaudeConfig } from "@n-dx/claude-client";

// Re-export shared project config utilities — previously duplicated here.
export { loadProjectOverrides, mergeWithOverrides } from "@n-dx/claude-client";

/**
 * Load the "claude" section from .n-dx.json.
 * Returns an empty object if the file doesn't exist, is invalid, or has no claude section.
 *
 * Delegates to @n-dx/claude-client's loadClaudeConfig, adapting the hench
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
