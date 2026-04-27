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
import type { LLMVendor, LLMConfig, TaskWeight } from "./llm-types.js";

const PROJECT_CONFIG_FILE = ".n-dx.json";
const LOCAL_CONFIG_FILE = ".n-dx.local.json";

/**
 * Default Claude model ID used when no model is explicitly configured.
 *
 * This constant is the single source of truth for the Claude default within
 * the foundation layer. The orchestration-tier model catalog
 * (`packages/core/llm-model-catalog.js`) has a corresponding `recommended`
 * entry that must stay aligned — enforced by the catalog-runtime contract
 * test in `tests/e2e/catalog-runtime-contract.test.js`.
 */
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

/**
 * Canonical 'newest model' per vendor.
 *
 * This is the single place to update when a vendor releases a new model.
 * All call sites that need a default model string derive it from here
 * via `resolveVendorModel()`.
 */
export const NEWEST_MODELS: Record<LLMVendor, string> = {
  claude: "claude-sonnet-4-6",
  codex: "gpt-5.5",
};

/**
 * Per-tier model mapping for task-weight-aware model selection.
 *
 * The `standard` tier always equals NEWEST_MODELS for backward compatibility —
 * existing code that omits the weight parameter continues to use the default model.
 * The `light` tier maps to cheaper/faster models for simple tasks.
 *
 * Invariant: TIER_MODELS[vendor].standard === NEWEST_MODELS[vendor]
 */
export const TIER_MODELS: Record<LLMVendor, Record<TaskWeight, string>> = {
  claude: {
    light: "claude-haiku-4-20250414",
    standard: NEWEST_MODELS.claude,
  },
  codex: {
    light: "gpt-5.4-mini",
    standard: NEWEST_MODELS.codex,
  },
};

const LEGACY_CODEX_MODEL_ALIASES: Record<string, string> = {
  "gpt-5-codex": NEWEST_MODELS.codex,
  "gpt-5.4mini": TIER_MODELS.codex.light,
  "gpt-5.1-codex-max": NEWEST_MODELS.codex,
  "gpt-5.1-codex-mini": TIER_MODELS.codex.light,
};

/**
 * Maximum safe prompt size per vendor (in characters).
 *
 * Used by the CLI loop to bound the brief text before sending to the
 * vendor CLI, preventing prompts that exceed the vendor's context window.
 * Values are conservative — set well below the true context window limit
 * to leave room for the system prompt, retry notices, and model overhead.
 *
 * Approximate derivation (~4 chars per token):
 *   claude  200K-token window → ~800K chars; cap at 640K (80% utilisation)
 *   codex   128K-token window → ~512K chars; cap at 400K (78% utilisation)
 */
export const VENDOR_CONTEXT_CHAR_LIMITS: Record<LLMVendor, number> = {
  claude: 640_000,
  codex: 400_000,
};

/**
 * Map of shorthand model aliases to full Anthropic API model IDs.
 * The Claude CLI resolves these internally, but the API requires full IDs.
 */
const MODEL_ALIASES: Record<string, string> = {
  sonnet: NEWEST_MODELS.claude,
  opus: "claude-opus-4-7",
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

export function normalizeCodexModel(model: string): string {
  return LEGACY_CODEX_MODEL_ALIASES[model] ?? model;
}

/**
 * Resolve the canonical model string for a given vendor, consulting the
 * project config first and falling back to the tier-appropriate model.
 *
 * This is the single authoritative resolver for vendor/model selection. Use
 * this instead of hardcoding or independently deriving model strings.
 *
 * Resolution order:
 * 1. Config tier-specific model (`llm.claude.lightModel` when weight='light')
 * 2. Vendor-specific model from config (`llm.claude.model` / `llm.codex.model`)
 * 3. Tier-appropriate model from `TIER_MODELS` based on `weight` parameter
 *
 * The `weight` parameter enables task-weight-aware model tiering:
 * - `'light'` — resolves to cheaper/faster models (haiku, gpt-5.4-mini)
 * - `'standard'` or omitted — resolves to full-capability models (sonnet, gpt-5)
 *
 * For the 'light' weight, if `lightModel` is configured, it takes precedence
 * over both `model` and `TIER_MODELS`. This allows users to customize which
 * model serves the light tier without affecting the standard tier.
 *
 * For Claude, the result is also passed through `resolveModel()` so that
 * shorthand aliases (e.g. "sonnet") are expanded to full API model IDs.
 *
 * @param vendor  The LLM vendor ("claude" | "codex").
 * @param config  Optional `LLMConfig` loaded from `.n-dx.json`.
 * @param weight  Optional task weight for tier-based selection. Defaults to 'standard'.
 * @returns       A fully-qualified model string ready for use in API calls.
 */
export function resolveVendorModel(
  vendor: LLMVendor,
  config?: LLMConfig,
  weight: TaskWeight = "standard",
): string {
  if (vendor === "claude") {
    if (weight === "light") {
      // Light tier: only lightModel can override, then fall back to TIER_MODELS.light
      if (config?.claude?.lightModel) {
        return resolveModel(config.claude.lightModel);
      }
      return resolveModel(TIER_MODELS.claude.light);
    }
    // Standard tier: model can override, then fall back to TIER_MODELS.standard
    if (config?.claude?.model) {
      return resolveModel(config.claude.model);
    }
    return resolveModel(TIER_MODELS.claude.standard);
  }
  if (vendor === "codex") {
    if (weight === "light") {
      // Light tier: only lightModel can override, then fall back to TIER_MODELS.light
      if (config?.codex?.lightModel) {
        return normalizeCodexModel(config.codex.lightModel);
      }
      return TIER_MODELS.codex.light;
    }
    // Standard tier: model can override, then fall back to TIER_MODELS.standard
    if (config?.codex?.model) {
      return normalizeCodexModel(config.codex.model);
    }
    return TIER_MODELS.codex.standard;
  }
  // Unknown vendor: return whatever is registered, or empty string as a
  // safe sentinel (callers should not reach this branch in practice).
  return (NEWEST_MODELS as Record<string, string>)[vendor] ?? "";
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
  if (typeof claude.lightModel === "string" && claude.lightModel) {
    result.lightModel = claude.lightModel;
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
