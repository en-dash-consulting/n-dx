/**
 * Unified configuration loading for Claude settings from .n-dx.json.
 *
 * Consolidates the three identical copies of loadClaudeConfig that existed
 * in hench, rex, and sourcevision into a single shared implementation.
 */

import { join } from "node:path";
import { readFile, access } from "node:fs/promises";
import { deepMerge } from "./project-config.js";
import type { ClaudeConfig } from "./types.js";

const PROJECT_CONFIG_FILE = ".n-dx.json";
const LOCAL_CONFIG_FILE = ".n-dx.local.json";

/**
 * Map of shorthand model aliases to full Anthropic API model IDs.
 * The Claude CLI resolves these internally, but the API requires full IDs.
 */
const MODEL_ALIASES: Record<string, string> = {
  sonnet: "claude-sonnet-4-6",
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
 * Load and parse a JSON file, returning null on failure.
 */
async function loadJSONFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    // File doesn't exist or is invalid
  }
  return null;
}

/**
 * Extract a ClaudeConfig from a raw config object's "claude" section.
 */
function extractClaudeConfig(data: Record<string, unknown>): ClaudeConfig | null {
  if (!data.claude || typeof data.claude !== "object") return null;
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
  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Load the "claude" section from .n-dx.json in the given directory,
 * with .n-dx.local.json overrides merged on top (local wins).
 * Returns an empty object if neither file exists, is invalid, or has
 * no claude section.
 *
 * @param dir  The directory containing .n-dx.json (project root)
 */
export async function loadClaudeConfig(dir: string): Promise<ClaudeConfig> {
  const projectData = await loadJSONFile(join(dir, PROJECT_CONFIG_FILE));
  const localData = await loadJSONFile(join(dir, LOCAL_CONFIG_FILE));

  // Merge project and local configs (local wins)
  let merged: Record<string, unknown> | null = projectData;
  if (projectData && localData) {
    merged = deepMerge(projectData, localData);
  } else if (localData) {
    merged = localData;
  }

  if (merged) {
    return extractClaudeConfig(merged) ?? {};
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
