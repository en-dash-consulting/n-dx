/**
 * Project-level configuration loading for hench.
 *
 * Core utilities (deepMerge, loadProjectOverrides, mergeWithOverrides) are
 * shared from @n-dx/llm-client. This module re-exports them and adds
 * the thin configDir→projectDir adapter for Claude config that hench consumers
 * expect.
 */

import {
  loadClaudeConfig as loadClaudeConfigFromDir,
  loadLLMConfig as loadLLMConfigFromDir,
  DEFAULT_LLM_VENDOR,
  LLM_VENDOR,
  projectRootOf,
  resolveApiKey as sharedResolveApiKey,
  resolveCliPath as sharedResolveCliPath,
  resolveVendorCliEnv as sharedResolveVendorCliEnv,
} from "../prd/llm-gateway.js";
import type { ClaudeConfig, LLMConfig, LLMVendor } from "../prd/llm-gateway.js";
import type { HenchConfig } from "../schema/index.js";
import type { EnvPolicyConfig } from "../prd/llm-gateway.js";

// Re-export the shared ClaudeConfig type so existing consumers keep working
export type { ClaudeConfig, LLMConfig, LLMVendor } from "../prd/llm-gateway.js";

// Re-export shared project config utilities — previously duplicated here.
export {
  deepMerge,
  loadProjectOverrides,
  loadProjectOverrideSources,
  mergeWithOverrides,
  PROJECT_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "../prd/llm-gateway.js";
export type { ProjectOverrideSource } from "../prd/llm-gateway.js";

/**
 * Load the "claude" section from .n-dx.json.
 * Returns an empty object if the file doesn't exist, is invalid, or has no claude section.
 *
 * Delegates to @n-dx/llm-client's loadClaudeConfig, adapting the hench
 * convention of passing a configDir (`/project/.hench` or
 * `/project/.ndx/hench`) instead of the project root directory. The root is
 * recovered by the resolver, which knows to step over the `.ndx/` container.
 *
 * @param configDir The package config directory (e.g., /project/.hench)
 */
export async function loadClaudeConfig(
  configDir: string,
): Promise<ClaudeConfig> {
  return loadClaudeConfigFromDir(projectRootOf(configDir));
}

/**
 * Load the vendor-neutral llm section from .n-dx.json.
 *
 * @param configDir The package config directory (e.g., /project/.hench)
 */
export async function loadLLMConfig(
  configDir: string,
): Promise<LLMConfig> {
  return loadLLMConfigFromDir(projectRootOf(configDir));
}

export function resolveLLMVendor(llmConfig: LLMConfig): LLMVendor {
  return llmConfig.vendor ?? DEFAULT_LLM_VENDOR;
}

/**
 * Resolve active vendor CLI binary.
 *
 * Priority for Claude:
 *  1. llm.claude.cli_path (or legacy claude.cli_path) from .n-dx.json
 *  2. henchConfig.claudePath — discovered path persisted by ndx init
 *  3. "claude" (system PATH fallback)
 *
 * For Codex: llm.codex.cli_path or "codex".
 */
export function resolveVendorCliPath(llmConfig: LLMConfig, henchConfig?: HenchConfig): string {
  const vendor = resolveLLMVendor(llmConfig);
  if (vendor === LLM_VENDOR.CODEX) {
    return llmConfig.codex?.cli_path ?? "codex";
  }
  // Google and local use the REST API — no CLI binary. Return empty string so
  // callers that check cli availability will surface a clear "vendor has no CLI" error.
  if (vendor === LLM_VENDOR.GOOGLE || vendor === LLM_VENDOR.LOCAL) {
    return "";
  }
  const configured = sharedResolveCliPath(llmConfig.claude ?? {});
  if (configured !== "claude") return configured; // explicit user config wins
  // Fall back to persisted discovered path from .hench/config.json
  return henchConfig?.claudePath ?? "claude";
}

/**
 * Build the environment object to pass to the vendor CLI subprocess.
 *
 * Injects the vendor-specific API key from project config so that binaries
 * receive it even when it is not set in the system environment:
 * - codex: llm.codex.api_key → OPENAI_API_KEY
 * - claude: llm.claude.api_key → ANTHROPIC_API_KEY
 *
 * Applies the guard policy while retaining the active vendor's authentication.
 */
export function resolveVendorCliEnv(
  llmConfig: LLMConfig,
  envConfig?: EnvPolicyConfig,
  onStripped?: (names: string[]) => void,
): NodeJS.ProcessEnv {
  return sharedResolveVendorCliEnv(llmConfig, envConfig, process.env, onStripped);
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
