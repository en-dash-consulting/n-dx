/**
 * Curated LLM model catalog for `ndx init`.
 *
 * This is a static, local catalog — intentionally small and not derived from
 * live vendor discovery. The catalog is used during interactive init to present
 * a keyboard-driven model selector after the user picks a provider.
 *
 * ## Tier
 *
 * Orchestration — same rules as cli.js: no domain-package imports.
 * The catalog duplicates a small amount of model metadata by design.
 * Contract tests (in tests/unit/init-llm.test.js) assert recommended defaults
 * stay aligned with runtime defaults.
 *
 * ## Shape
 *
 * Each vendor entry is an array of model descriptors:
 * - `id`          — canonical model ID persisted to .n-dx.json
 * - `label`       — friendly display name shown in the selector
 * - `recommended` — boolean; the recommended model is pre-selected and visually marked
 *
 * Exactly one model per vendor should have `recommended: true`.
 */

/**
 * @typedef {Object} ModelEntry
 * @property {string} id          Canonical model ID (persisted to config)
 * @property {string} label       Friendly display label
 * @property {boolean} recommended    Whether this is the recommended default
 */

/** @type {Record<string, ModelEntry[]>} */
export const LLM_MODEL_CATALOG = {
  codex: [
    { id: "gpt-5.5", label: "GPT-5.5", recommended: true },
    { id: "gpt-5.4", label: "GPT-5.4", recommended: false },
    { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", recommended: false },
    { id: "gpt-5.3-codex", label: "GPT-5.3 Codex", recommended: false },
  ],
  claude: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", recommended: true },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", recommended: false },
    { id: "claude-haiku-4-20250414", label: "Claude Haiku 4", recommended: false },
  ],
};

/**
 * Get the model catalog for a specific vendor.
 *
 * @param {string} vendor  Provider key (e.g. "codex", "claude")
 * @returns {ModelEntry[] | undefined}  Model entries or undefined if vendor is unknown
 */
export function getModelsForVendor(vendor) {
  return LLM_MODEL_CATALOG[vendor];
}

/**
 * Get the recommended model for a specific vendor.
 *
 * @param {string} vendor  Provider key (e.g. "codex", "claude")
 * @returns {ModelEntry | undefined}  The recommended model entry, or undefined
 */
export function getRecommendedModel(vendor) {
  const models = LLM_MODEL_CATALOG[vendor];
  if (!models) return undefined;
  return models.find((m) => m.recommended);
}
