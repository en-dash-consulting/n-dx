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
import { LLM_VENDOR, type LLMVendor, type LLMConfig, type TaskWeight } from "./llm-types.js";

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
export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";

/**
 * Canonical 'newest model' per vendor.
 *
 * This is the single place to update when a vendor releases a new model.
 * All call sites that need a default model string derive it from here
 * via `resolveVendorModel()`.
 */
export const NEWEST_MODELS: Record<LLMVendor, string> = {
  [LLM_VENDOR.CLAUDE]: "claude-sonnet-5",
  [LLM_VENDOR.CODEX]: "gpt-5.6-terra",
  // Google: newest *stable* Pro model. `gemini-3.1-pro-preview` is newer but
  // is a preview release — preview IDs can be renamed or withdrawn, so it is
  // not shipped as a default. Users can still select it via llm.google.model.
  [LLM_VENDOR.GOOGLE]: "gemini-2.5-pro",
  // Local (LM Studio): no canonical model — depends on whatever is loaded.
  [LLM_VENDOR.LOCAL]: "",
};

/**
 * Google Gemini model catalog — maps task weight tiers to canonical Gemini model IDs.
 *
 * Three models span the cost/capability spectrum:
 *   light    — fast and cheap for simple classification and lightweight tasks
 *   standard — balanced for multi-turn agents and general analysis
 *   heavy    — highest capability for complex reasoning and long-horizon tasks
 *
 * NEWEST_MODELS.google points to the heavy (most capable) tier model. Callers that
 * want the recommended balanced model for interactive use should resolve via
 * resolveVendorModel("google", config, "standard").
 */
export const GOOGLE_MODELS: Record<TaskWeight, string> = {
  light: "gemini-3.5-flash-lite",
  standard: "gemini-3.7-flash",
  heavy: "gemini-2.5-pro",
};

/**
 * Per-tier model mapping for task-weight-aware model selection.
 *
 * The `standard` tier equals NEWEST_MODELS for claude and codex (backward
 * compatibility). For Google, the heavy tier equals NEWEST_MODELS.google —
 * the most capable model — while standard is a balanced mid-tier.
 *
 * Invariant: TIER_MODELS.claude.standard === NEWEST_MODELS.claude
 *            TIER_MODELS.codex.standard  === NEWEST_MODELS.codex
 */
export const TIER_MODELS: Record<LLMVendor, Record<TaskWeight, string>> = {
  [LLM_VENDOR.CLAUDE]: {
    light: "claude-haiku-4-5",
    standard: NEWEST_MODELS.claude,
    heavy: "claude-opus-5",
  },
  [LLM_VENDOR.CODEX]: {
    light: "gpt-5.6-luna",
    standard: NEWEST_MODELS.codex, // gpt-5.6-terra
    heavy: "gpt-5.6-sol",
  },
  [LLM_VENDOR.GOOGLE]: GOOGLE_MODELS,
  // Local: no catalog — model is whatever LM Studio has loaded.
  [LLM_VENDOR.LOCAL]: { light: "", standard: "", heavy: "" },
};

/**
 * Legacy Codex model IDs that map to current canonical models.
 *
 * Keys are model IDs shipped by prior versions (the old `gpt-5-codex` /
 * `gpt-5.1-codex-*` brand names) or since retired by OpenAI; values are the
 * current model they resolve to. `normalizeCodexModel()` applies this mapping
 * when reading config, so an existing `.n-dx.json` pinned to a dead model keeps
 * working after an upgrade instead of failing at request time.
 *
 * `gpt-5.4` and `gpt-5.4-mini` retire from Codex on 2026-08-31 for
 * ChatGPT-authenticated sessions (they remain on the OpenAI API and on Codex
 * sessions authenticated with an API key). OpenAI's documented replacements are
 * `gpt-5.6-terra` and `gpt-5.6-luna` respectively. `gpt-5.3-codex` and
 * `gpt-5.2` are already unavailable when signing in with ChatGPT.
 *
 * `gpt-5.5` is deliberately absent — it is still supported and remains a
 * selectable catalog entry rather than being silently rewritten.
 *
 * Keep in sync with the orchestration-tier legacy list in
 * `packages/core/init-llm.js` (`LEGACY_CATALOG_MODEL_ALIASES.codex`), which
 * treats these same IDs as "known" during `ndx init`. The two tiers cannot
 * import each other, so the sets are duplicated by design.
 */
const LEGACY_CODEX_MODEL_ALIASES: Record<string, string> = {
  "gpt-5-codex": NEWEST_MODELS.codex,
  "gpt-5.1-codex-max": NEWEST_MODELS.codex,
  "gpt-5.1-codex-mini": TIER_MODELS.codex.light,
  // Retired / retiring from Codex — remap to OpenAI's stated replacements.
  "gpt-5.4": NEWEST_MODELS.codex,
  "gpt-5.4-mini": TIER_MODELS.codex.light,
  "gpt-5.3-codex": NEWEST_MODELS.codex,
  "gpt-5.2": NEWEST_MODELS.codex,
};

/**
 * Maximum safe prompt size per vendor (in characters).
 *
 * Used by the CLI loop to bound the brief text before sending to the
 * vendor CLI, preventing prompts that exceed the vendor's context window.
 * Values are conservative — set well below the true context window limit
 * to leave room for the system prompt, retry notices, and model overhead.
 *
 * These caps are deliberately conservative and are NOT derived from the current
 * models' context windows — current Claude, Codex, and Gemini models all expose
 * 1M+ token windows (see MODEL_CONTEXT_WINDOWS). The caps bound CLI prompt size
 * for cost and latency reasons, so raising a model's window does not
 * automatically raise the cap here.
 */
export const VENDOR_CONTEXT_CHAR_LIMITS: Record<LLMVendor, number> = {
  [LLM_VENDOR.CLAUDE]: 640_000,
  [LLM_VENDOR.CODEX]: 400_000,
  // Gemini models have 1M+ token context windows; cap conservatively to
  // leave room for system prompt, tool definitions, and model overhead.
  [LLM_VENDOR.GOOGLE]: 800_000,
  // Local (LM Studio): conservative default — actual limit depends on the
  // loaded model. Users running large context models can set a higher cap
  // via llm.local.model config if needed.
  [LLM_VENDOR.LOCAL]: 128_000,
};

/**
 * Per-model context window sizes in tokens.
 *
 * Used by budget preflight to estimate whether a prompt fits within a model's
 * context window. Values are conservative minimums — actual limits may be higher
 * depending on the API tier or region.
 *
 * ~4 chars per token is the standard approximation for English prose.
 */
export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  // Google Gemini
  "gemini-3.7-flash": 1_000_000,
  "gemini-3.5-flash-lite": 1_000_000,
  "gemini-2.5-flash": 1_000_000,
  "gemini-2.5-pro": 1_000_000,
  // Claude
  "claude-haiku-4-5": 200_000,
  "claude-fable-5": 1_000_000,
  "claude-opus-5": 1_000_000,
  "claude-opus-4-8": 1_000_000,
  "claude-sonnet-5": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-opus-4-7": 1_000_000,
  // Codex / OpenAI
  "gpt-5.6-sol": 1_050_000,
  "gpt-5.6-terra": 1_050_000,
  "gpt-5.6-luna": 1_050_000,
  "gpt-5.4-mini": 128_000,
  "gpt-5.5": 200_000,
};

/**
 * Per-model cost constants (USD per million tokens).
 *
 * Used by budget preflight to estimate request cost. Values are approximate
 * public list pricing as of 2026-08 and should be updated when vendors change
 * rates. Gemini Pro and Claude Sonnet 5 have tiered/introductory rates; the
 * values here are the standard (higher) tier so estimates never under-report.
 */
export const MODEL_COSTS: Readonly<
  Record<string, { inputPerMToken: number; outputPerMToken: number }>
> = {
  // Google Gemini
  "gemini-3.7-flash": { inputPerMToken: 0.75, outputPerMToken: 3.75 },
  "gemini-3.5-flash-lite": { inputPerMToken: 0.30, outputPerMToken: 2.50 },
  "gemini-2.5-flash": { inputPerMToken: 0.30, outputPerMToken: 2.50 },
  "gemini-2.5-pro": { inputPerMToken: 1.25, outputPerMToken: 10.00 },
  // Claude
  "claude-haiku-4-5": { inputPerMToken: 1.00, outputPerMToken: 5.00 },
  "claude-fable-5": { inputPerMToken: 10.00, outputPerMToken: 50.00 },
  "claude-opus-5": { inputPerMToken: 5.00, outputPerMToken: 25.00 },
  "claude-opus-4-8": { inputPerMToken: 5.00, outputPerMToken: 25.00 },
  "claude-sonnet-5": { inputPerMToken: 3.00, outputPerMToken: 15.00 },
  "claude-sonnet-4-6": { inputPerMToken: 3.00, outputPerMToken: 15.00 },
  "claude-opus-4-7": { inputPerMToken: 5.00, outputPerMToken: 25.00 },
  // Codex / OpenAI
  "gpt-5.6-sol": { inputPerMToken: 4.00, outputPerMToken: 20.00 },
  "gpt-5.6-terra": { inputPerMToken: 2.00, outputPerMToken: 12.00 },
  "gpt-5.6-luna": { inputPerMToken: 0.20, outputPerMToken: 1.20 },
  "gpt-5.4-mini": { inputPerMToken: 0.40, outputPerMToken: 1.60 },
  "gpt-5.5": { inputPerMToken: 7.00, outputPerMToken: 21.00 },
};

/**
 * Map of shorthand model aliases to full Anthropic API model IDs.
 * The Claude CLI resolves these internally, but the API requires full IDs.
 */
const MODEL_ALIASES: Record<string, string> = {
  sonnet: NEWEST_MODELS.claude,
  opus: "claude-opus-5",
  haiku: "claude-haiku-4-5",
  fable: "claude-fable-5",
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
 * - `'light'` — cheaper/faster models (haiku, gemini-flash-lite, gpt-5.6-luna)
 * - `'standard'` or omitted — full-capability balanced models (sonnet, gemini-3.7-flash, gpt-5.6-terra)
 * - `'heavy'` — most capable models (opus, gemini-2.5-pro, gpt-5.6-sol); always uses TIER_MODELS.heavy
 *
 * For the 'light' weight, if `lightModel` is configured, it takes precedence
 * over both `model` and `TIER_MODELS`. This allows users to customize which
 * model serves the light tier without affecting the standard tier.
 *
 * For Claude, the result is also passed through `resolveModel()` so that
 * shorthand aliases (e.g. "sonnet") are expanded to full API model IDs.
 *
 * @param vendor  The LLM vendor ("claude" | "codex" | "google").
 * @param config  Optional `LLMConfig` loaded from `.n-dx.json`.
 * @param weight  Optional task weight for tier-based selection. Defaults to 'standard'.
 * @returns       A fully-qualified model string ready for use in API calls.
 */
export function resolveVendorModel(
  vendor: LLMVendor,
  config?: LLMConfig,
  weight: TaskWeight = "standard",
): string {
  if (vendor === LLM_VENDOR.CLAUDE) {
    if (weight === "light") {
      // Light tier: only lightModel can override, then fall back to TIER_MODELS.light
      if (config?.claude?.lightModel) {
        return resolveModel(config.claude.lightModel);
      }
      return resolveModel(TIER_MODELS.claude.light);
    }
    if (weight === "heavy") {
      // Heavy tier: always uses the most capable model; no config override path.
      return resolveModel(TIER_MODELS.claude.heavy);
    }
    // Standard tier precedence: top-level llm.model > llm.claude.model > tier default.
    if (config?.model) {
      return resolveModel(config.model);
    }
    if (config?.claude?.model) {
      return resolveModel(config.claude.model);
    }
    return resolveModel(TIER_MODELS.claude.standard);
  }
  if (vendor === LLM_VENDOR.CODEX) {
    if (weight === "light") {
      // Light tier: only lightModel can override, then fall back to TIER_MODELS.light
      if (config?.codex?.lightModel) {
        return normalizeCodexModel(config.codex.lightModel);
      }
      return TIER_MODELS.codex.light;
    }
    if (weight === "heavy") {
      // Heavy tier: always uses the most capable model; no config override path.
      return TIER_MODELS.codex.heavy;
    }
    // Standard tier precedence: top-level llm.model > llm.codex.model > tier default.
    if (config?.model) {
      return normalizeCodexModel(config.model);
    }
    if (config?.codex?.model) {
      return normalizeCodexModel(config.codex.model);
    }
    return TIER_MODELS.codex.standard;
  }
  if (vendor === LLM_VENDOR.GOOGLE) {
    if (weight === "light") {
      if (config?.google?.lightModel) {
        return config.google.lightModel;
      }
      return TIER_MODELS.google.light;
    }
    if (weight === "heavy") {
      // Heavy tier: always uses the most capable model; no config override path.
      return TIER_MODELS.google.heavy;
    }
    // Standard tier precedence: top-level llm.model > llm.google.model > tier default.
    if (config?.model) {
      return config.model;
    }
    if (config?.google?.model) {
      return config.google.model;
    }
    return TIER_MODELS.google.standard;
  }
  if (vendor === LLM_VENDOR.LOCAL) {
    // Light tier: prefer lightModel, then fall back to model, then "".
    if (weight === "light" && config?.local?.lightModel) {
      return config.local.lightModel;
    }
    // Standard/heavy: prefer top-level model > llm.local.model > "" (use whatever is loaded).
    if (config?.model) return config.model;
    if (config?.local?.model) return config.local.model;
    return ""; // LM Studio uses whichever model is currently loaded
  }

  // Unknown vendor: return whatever is registered, or empty string as a
  // safe sentinel (callers should not reach this branch in practice).
  return (NEWEST_MODELS as Record<string, string>)[vendor] ?? "";
}

/**
 * Recommended model per vendor for the adversarial review pass.
 *
 * ## Why review gets its own tier
 *
 * Review is a different workload from execution. It is read-heavy and
 * judgment-dense — the reviewer must construct a failure trigger, then try to
 * refute its own finding — but it is *short*: one diff, one pass, no
 * multi-hour tool loop. That inverts the usual cost calculus. The token volume
 * is a fraction of the implementation run it audits, so paying a higher
 * per-token rate for stronger reasoning costs little in absolute terms while
 * buying the thing review exists for: catching the defect the implementer
 * could not see.
 *
 * A weaker reviewer fails in the expensive direction. A missed critical
 * finding ships; a fabricated one costs a human triage cycle and erodes trust
 * in the whole pass. Neither is worth the few cents saved.
 *
 * ## Per-vendor rationale
 *
 * - **claude → `claude-opus-5`** ($5/$25 per MTok, 1M context). Opus-tier
 *   reasoning at the same input price as Opus 4.8/4.7 and ~1.67x the input
 *   price of the Sonnet 5 execution default. `claude-fable-5` is stronger
 *   still but costs 2x Opus ($10/$50) — available via override, not worth it
 *   as the default for a single-pass review.
 * - **codex → `gpt-5.6-terra`** (`NEWEST_MODELS.codex`). The review model
 *   equals the execution model. `gpt-5.6-sol` is the heavy tier ($4/$20 vs
 *   terra's $2/$12) — available via override or `reviewModel` config, but not
 *   the default pending evidence its review quality justifies 2x the price.
 * - **google → `gemini-2.5-pro`.** The heavy tier; `gemini-3.7-flash` is the
 *   balanced execution default.
 * - **local → `""`.** LM Studio serves whichever model is loaded; there is no
 *   second model to escalate to.
 *
 * Override precedence is handled by {@link resolveReviewModel}.
 */
export const REVIEW_MODELS: Record<LLMVendor, string> = {
  [LLM_VENDOR.CLAUDE]: "claude-opus-5",
  [LLM_VENDOR.CODEX]: NEWEST_MODELS.codex,
  [LLM_VENDOR.GOOGLE]: TIER_MODELS.google.heavy,
  [LLM_VENDOR.LOCAL]: "",
};

/**
 * Resolve the model the adversarial review pass should run on.
 *
 * Precedence, highest first:
 * 1. `override` — the `--review-model=…` CLI flag.
 * 2. `llm.<vendor>.reviewModel` — vendor-pinned project config.
 * 3. `llm.reviewModel` — vendor-neutral project config.
 * 4. {@link REVIEW_MODELS} — the recommended default for the vendor.
 *
 * Note what is deliberately *absent*: `llm.model` and `llm.<vendor>.model`.
 * Those pin the execution model, and silently reusing them for review would
 * defeat the point of a separate tier — a project that pins Haiku for cheap
 * execution would get a Haiku reviewer without ever asking for one. Reviewers
 * only ever come from a review-specific setting or the recommended default.
 *
 * For the local vendor every branch may legitimately yield `""`, meaning
 * "whatever LM Studio has loaded" — callers must treat empty as "send no
 * model flag", not as an error.
 *
 * @param vendor    Active LLM vendor.
 * @param config    Optional `LLMConfig` loaded from `.n-dx.json`.
 * @param override  Optional explicit model (the `--review-model` flag value).
 * @returns         A model string, alias-expanded for Claude; `""` for local.
 */
export function resolveReviewModel(
  vendor: LLMVendor,
  config?: LLMConfig,
  override?: string,
): string {
  const expand = (model: string): string =>
    vendor === LLM_VENDOR.CLAUDE
      ? resolveModel(model)
      : vendor === LLM_VENDOR.CODEX
        ? normalizeCodexModel(model)
        : model;

  if (override) return expand(override);

  const vendorPinned =
    vendor === LLM_VENDOR.CLAUDE
      ? config?.claude?.reviewModel
      : vendor === LLM_VENDOR.CODEX
        ? config?.codex?.reviewModel
        : vendor === LLM_VENDOR.GOOGLE
          ? config?.google?.reviewModel
          : config?.local?.reviewModel;
  if (vendorPinned) return expand(vendorPinned);

  if (config?.reviewModel) return expand(config.reviewModel);

  return (REVIEW_MODELS as Record<string, string>)[vendor] ?? "";
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
