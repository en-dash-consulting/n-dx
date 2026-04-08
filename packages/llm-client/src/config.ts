/**
 * Unified configuration loading for Claude settings from .n-dx.json.
 *
 * Consolidates the three identical copies of loadClaudeConfig that existed
 * in hench, rex, and sourcevision into a single shared implementation.
 */

import { join } from "node:path";
import { readFile, access } from "node:fs/promises";
import type { ClaudeConfig } from "./types.js";
import type { LLMVendor, LLMConfig } from "./llm-types.js";

const PROJECT_CONFIG_FILE = ".n-dx.json";

/**
 * Canonical 'newest model' per vendor.
 *
 * This is the single place to update when a vendor releases a new model.
 * All call sites that need a default model string derive it from here
 * via `resolveVendorModel()`.
 */
export const NEWEST_MODELS: Record<LLMVendor, string> = {
  claude: "claude-sonnet-4-6",
  codex: "gpt-5",
};

/**
 * Map of shorthand model aliases to full Anthropic API model IDs.
 * The Claude CLI resolves these internally, but the API requires full IDs.
 */
const MODEL_ALIASES: Record<string, string> = {
  sonnet: NEWEST_MODELS.claude,
  opus: "claude-opus-4-20250514",
  haiku: "claude-haiku-4-20250414",
};

/**
 * Resolve a model string to a full Anthropic API model ID.
 *
 * Shorthand names like "sonnet", "opus", "haiku" are expanded to their full
 * model IDs. Strings that already look like full model IDs (contain "claude-")
 * are returned as-is.
 */
export function resolveModel(model: string): string {
  return MODEL_ALIASES[model] ?? model;
}

/**
 * Resolve the canonical model string for a given vendor, consulting the
 * project config first and falling back to the newest model for that vendor.
 *
 * This is the single authoritative resolver for vendor/model selection. Use
 * this instead of hardcoding or independently deriving model strings.
 *
 * Resolution order:
 * 1. Vendor-specific model from config (`llm.claude.model` / `llm.codex.model`)
 * 2. Newest model fallback from `NEWEST_MODELS`
 *
 * For Claude, the result is also passed through `resolveModel()` so that
 * shorthand aliases (e.g. "sonnet") are expanded to full API model IDs.
 *
 * @param vendor  The LLM vendor ("claude" | "codex").
 * @param config  Optional `LLMConfig` loaded from `.n-dx.json`.
 * @returns       A fully-qualified model string ready for use in API calls.
 */
export function resolveVendorModel(vendor: LLMVendor, config?: LLMConfig): string {
  if (vendor === "claude") {
    const raw = config?.claude?.model ?? NEWEST_MODELS.claude;
    return resolveModel(raw);
  }
  if (vendor === "codex") {
    return config?.codex?.model ?? NEWEST_MODELS.codex;
  }
  // Unknown vendor: return whatever is registered, or empty string as a
  // safe sentinel (callers should not reach this branch in practice).
  return (NEWEST_MODELS as Record<string, string>)[vendor] ?? "";
}

/**
 * Load the "claude" section from .n-dx.json in the given directory.
 * Returns an empty object if the file doesn't exist, is invalid, or has
 * no claude section.
 *
 * @param dir  The directory containing .n-dx.json (project root)
 */
export async function loadClaudeConfig(dir: string): Promise<ClaudeConfig> {
  const configPath = join(dir, PROJECT_CONFIG_FILE);
  try {
    await access(configPath);
    const raw = await readFile(configPath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && data.claude && typeof data.claude === "object") {
      const claude = data.claude as Record<string, unknown>;
      const result: ClaudeConfig = {};
      if (typeof claude.cli_path === "string" && claude.cli_path) {
        result.cli_path = claude.cli_path;
      }
      if (typeof claude.api_key === "string" && claude.api_key) {
        result.api_key = claude.api_key;
      }
      if (typeof claude.api_endpoint === "string" && claude.api_endpoint) {
        result.api_endpoint = claude.api_endpoint;
      }
      if (typeof claude.model === "string" && claude.model) {
        result.model = claude.model;
      }
      return result;
    }
  } catch {
    // File doesn't exist or is invalid — no claude config
  }
  return {};
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
  return claudeConfig.api_key ?? process.env[apiKeyEnv];
}

/**
 * Resolve the Claude CLI binary path with the following priority:
 * 1. claude.cli_path from unified config (.n-dx.json)
 * 2. "claude" (found on PATH)
 *
 * @returns The resolved binary path.
 */
export function resolveCliPath(claudeConfig: ClaudeConfig): string {
  return claudeConfig.cli_path ?? "claude";
}
