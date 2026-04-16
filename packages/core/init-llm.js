/**
 * LLM selection logic for `ndx init`.
 *
 * Extracted from cli.js to keep handleInit() focused on orchestration.
 * This module owns both the resolution logic (what's already known) and
 * the prompting orchestration (filling in missing values interactively).
 *
 * ## Tier
 *
 * Orchestration — same rules as cli.js: no domain-package imports.
 * Uses enquirer for interactive terminal prompts with a non-TTY fallback.
 *
 * ## Precedence
 *
 * 1. Explicit CLI flags (--provider=, --model=)
 * 2. Existing project config (.n-dx.json)
 * 3. Interactive prompt (TTY only)
 * 4. Runtime default fallback (handled by caller)
 */

import { getModelsForVendor, getRecommendedModel } from "./llm-model-catalog.js";

const SUPPORTED_PROVIDERS = ["codex", "claude"];
const LEGACY_CATALOG_MODEL_ALIASES = {
  codex: ["gpt-5-codex"],
  claude: [],
};

/**
 * Friendly display labels for each supported provider.
 * Used by the enquirer Select prompt during interactive init.
 *
 * @type {Record<string, string>}
 */
const PROVIDER_LABELS = {
  codex: "Codex (OpenAI)",
  claude: "Claude (Anthropic)",
};

/**
 * Check whether the current environment supports interactive terminal prompts.
 *
 * Returns false for non-TTY stdin (piped input, CI, test harnesses).
 * Use this to choose between enquirer (requires TTY for keyboard navigation)
 * and a readline fallback (works with piped input). This does NOT control
 * whether to prompt at all — that decision is made by
 * resolveInitLLMSelection() via the isTTY parameter.
 *
 * @returns {boolean}
 */
export function isInteractiveTerminal() {
  if (!process.stdin.isTTY) return false;
  if (process.env.CI) return false;
  return true;
}

/**
 * Resolve LLM provider and model selection for `ndx init`.
 *
 * Pure decision logic — no I/O, no prompting. Returns what is known and
 * signals what still needs prompting so the caller can drive the UI.
 *
 * @param {object} options
 * @param {object} options.flags             Parsed CLI flags
 * @param {string} [options.flags.provider]  --provider= value
 * @param {string} [options.flags.model]     --model= value
 * @param {object} options.existingConfig    Values read from .n-dx.json
 * @param {string} [options.existingConfig.vendor]  llm.vendor
 * @param {string} [options.existingConfig.model]   llm.<vendor>.model
 * @param {boolean} options.isTTY            Whether stdin is a TTY (prompts allowed)
 *
 * @returns {{
 *   provider?: string,
 *   model?: string,
 *   providerSource?: "flag" | "config",
 *   modelSource?: "flag" | "config",
 *   needsProviderPrompt: boolean,
 *   needsModelPrompt: boolean,
 * }}
 */
export function resolveInitLLMSelection({ flags, existingConfig, isTTY }) {
  const result = {
    provider: undefined,
    model: undefined,
    providerSource: undefined,
    modelSource: undefined,
    needsProviderPrompt: false,
    needsModelPrompt: false,
  };

  // ── Step 1: Resolve provider ───────────────────────────────────────────

  if (flags.provider) {
    result.provider = flags.provider;
    result.providerSource = "flag";
  } else if (existingConfig.vendor) {
    result.provider = existingConfig.vendor;
    result.providerSource = "config";
  }
  // else: provider unknown — may need prompting

  // ── Step 2: Resolve model ──────────────────────────────────────────────

  if (flags.model) {
    result.model = flags.model;
    result.modelSource = "flag";
  } else if (result.provider && existingConfig.model && existingConfig.vendor === result.provider) {
    // Only carry over existing model when the provider hasn't changed.
    // Switching vendors (e.g. flag says codex but config had claude) means
    // the old model is irrelevant.
    result.model = existingConfig.model;
    result.modelSource = "config";
  }
  // else: model unknown — may need prompting

  // ── Step 3: Determine what still needs prompting ───────────────────────

  if (!result.provider) {
    result.needsProviderPrompt = isTTY;
    // If we don't know the provider, we also don't know the model
    result.needsModelPrompt = isTTY;
  } else if (!result.model) {
    result.needsModelPrompt = isTTY;
  }

  return result;
}

// ── Internal prompt helpers ──────────────────────────────────────────────────

/**
 * Default interactive provider prompt using enquirer's Select prompt.
 *
 * Displays supported providers as a keyboard-navigable list. Arrow keys
 * navigate, Enter confirms. Provider names are shown with friendly labels
 * (e.g. "Claude (Anthropic)") while the returned value is the canonical
 * provider key (e.g. "claude").
 *
 * This function is only called when resolveInitLLMSelection() determines
 * a provider prompt is needed (i.e. isTTY is true). The non-TTY safety
 * fallback returns undefined, which the caller treats as cancellation.
 *
 * @returns {Promise<string|undefined>}  Selected provider or undefined on cancel.
 */
async function defaultPromptProvider() {
  if (!isInteractiveTerminal()) {
    // Non-TTY environments should not reach here (resolveInitLLMSelection
    // sets needsProviderPrompt=false when isTTY is false). Safety fallback.
    return undefined;
  }

  try {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();

    const choices = SUPPORTED_PROVIDERS.map((p) => ({
      name: p,
      message: PROVIDER_LABELS[p] || p,
    }));

    const response = await enquirer.prompt({
      type: "select",
      name: "provider",
      message: "Select LLM provider",
      choices,
    });

    return response.provider || undefined;
  } catch (err) {
    // Ctrl+C or Esc — treat as cancellation
    if (err === "" || (err && err.message === "")) return undefined;
    throw err;
  }
}

/**
 * Default model prompt using enquirer's Select prompt in TTY environments.
 *
 * Displays the curated model list for the chosen vendor. Shows friendly labels
 * (e.g. "Claude Sonnet 4.6") while returning canonical model IDs (e.g.
 * "claude-sonnet-4-6"). The recommended model is visually marked with a
 * "★ recommended" hint and pre-selected.
 *
 * In non-TTY environments (piped input, CI, test harnesses), auto-selects the
 * recommended model without prompting. Explicit model selection in scripted
 * flows requires the --model= flag.
 *
 * @param {string} provider  The resolved provider (e.g. "codex", "claude").
 * @returns {Promise<string|undefined>}  Selected model ID or undefined on cancel.
 */
async function defaultPromptModel(provider) {
  const models = getModelsForVendor(provider);
  if (!models || models.length === 0) return undefined;

  // Single-model vendor: return the only option without prompting
  if (models.length === 1) return models[0].id;

  if (isInteractiveTerminal()) {
    return promptModelEnquirer(provider, models);
  }

  // Non-interactive environment (piped input, CI, test harnesses):
  // auto-select the recommended model without prompting. Readline-based
  // model selection is unreliable in non-TTY environments because stdin
  // may be at EOF or closed. The recommended model is the sensible default
  // for scripted flows; explicit model selection requires --model= flag.
  const recommended = getRecommendedModel(provider);
  return recommended ? recommended.id : models[0].id;
}

/**
 * Enquirer-based model selector — keyboard-driven, TTY-only.
 *
 * @param {string} provider
 * @param {import("./llm-model-catalog.js").ModelEntry[]} models
 * @returns {Promise<string|undefined>}
 */
async function promptModelEnquirer(provider, models) {
  try {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();

    const recommended = getRecommendedModel(provider);
    const initialIndex = recommended
      ? models.findIndex((m) => m.id === recommended.id)
      : 0;

    const choices = models.map((m) => ({
      name: m.id,
      message: m.recommended ? `${m.label} ★ recommended` : m.label,
    }));

    const response = await enquirer.prompt({
      type: "select",
      name: "model",
      message: "Select model",
      choices,
      initial: initialIndex >= 0 ? initialIndex : 0,
    });

    return response.model || undefined;
  } catch (err) {
    // Ctrl+C or Esc — treat as cancellation
    if (err === "" || (err && err.message === "")) return undefined;
    throw err;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Run interactive prompts for any missing LLM selections.
 *
 * Takes the resolution from resolveInitLLMSelection() and fills in gaps
 * through terminal prompts.  Returns the final normalized selection without
 * the internal prompting signals (needsProviderPrompt / needsModelPrompt).
 *
 * Prompt functions can be injected for testability.  Defaults:
 * - Provider prompt: enquirer Select with arrow-key navigation (TTY only).
 * - Model prompt: enquirer Select (TTY) or auto-select recommended (non-TTY), driven by llm-model-catalog.js.
 *
 * @param {object} resolution                       Output of resolveInitLLMSelection()
 * @param {object} [options]
 * @param {() => Promise<string|undefined>}         [options.promptProvider]  Override provider prompt
 * @param {(provider: string) => Promise<string|undefined>}  [options.promptModel]  Override model prompt
 * @returns {Promise<{ provider?: string, model?: string, providerSource?: string, modelSource?: string, cancelled: boolean }>}
 */
export async function promptLLMSelection(resolution, options = {}) {
  let { provider, model, providerSource, modelSource } = resolution;
  const { needsProviderPrompt, needsModelPrompt } = resolution;
  let cancelled = false;

  if (needsProviderPrompt) {
    const promptFn = options.promptProvider ?? defaultPromptProvider;
    const selected = await promptFn();
    if (selected) {
      provider = selected;
      providerSource = "prompt";
    } else {
      cancelled = true;
    }
  }

  if (needsModelPrompt && provider) {
    const promptFn = options.promptModel ?? defaultPromptModel;
    const selected = await promptFn(provider);
    if (selected) {
      model = selected;
      modelSource = "prompt";
    } else {
      cancelled = true;
    }
  }

  return { provider, model, providerSource, modelSource, cancelled };
}

/**
 * Validate CLI flag combinations for `ndx init` LLM configuration.
 *
 * Pure decision logic — no I/O. Returns arrays of errors (fatal, should exit
 * non-zero) and warnings (informational, should not block init).
 *
 * Called by handleInit() after flag extraction and before resolution/prompting.
 *
 * @param {object} flags
 * @param {string} [flags.provider]      --provider= value
 * @param {string} [flags.model]         --model= value
 * @param {string} [flags.claudeModel]   --claude-model= value
 * @param {string} [flags.codexModel]    --codex-model= value
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateInitFlags({ provider, model, claudeModel, codexModel }) {
  const errors = [];
  const warnings = [];
  const isKnownModel = (vendor, value) => {
    const catalog = getModelsForVendor(vendor);
    if (!catalog) return false;
    if (catalog.some((m) => m.id === value)) return true;
    return (LEGACY_CATALOG_MODEL_ALIASES[vendor] ?? []).includes(value);
  };

  // ── Incompatible flag combinations ──────────────────────────────────────

  // Vendor-specific model + generic --model (ambiguous — which vendor does --model target?)
  if (claudeModel && model) {
    errors.push("Cannot set both --claude-model and --model. Use one or the other.");
  }
  if (codexModel && model) {
    errors.push("Cannot set both --codex-model and --model. Use one or the other.");
  }

  // Note: --claude-model + --codex-model is valid (configure both vendors).
  // Note: --provider=codex + --claude-model is valid (set active vendor to codex,
  //        configure claude model independently). Same for --provider=claude + --codex-model.

  // ── Unknown model warnings ─────────────────────────────────────────────

  // Check each vendor-specific model against its own catalog independently.
  if (errors.length === 0) {
    if (claudeModel) {
      const catalog = getModelsForVendor("claude");
      if (catalog && !isKnownModel("claude", claudeModel)) {
        warnings.push(
          `Unknown model "${claudeModel}" for claude. ` +
          `Known models: ${catalog.map((m) => m.id).join(", ")}. Proceeding anyway.`,
        );
      }
    }

    if (codexModel) {
      const catalog = getModelsForVendor("codex");
      if (catalog && !isKnownModel("codex", codexModel)) {
        warnings.push(
          `Unknown model "${codexModel}" for codex. ` +
          `Known models: ${catalog.map((m) => m.id).join(", ")}. Proceeding anyway.`,
        );
      }
    }

    // Check --model against the effective provider (flag or implied).
    if (model) {
      const effectiveProvider = provider || (claudeModel ? "claude" : codexModel ? "codex" : undefined);
      if (effectiveProvider) {
        const catalog = getModelsForVendor(effectiveProvider);
        if (catalog && !isKnownModel(effectiveProvider, model)) {
          warnings.push(
            `Unknown model "${model}" for ${effectiveProvider}. ` +
            `Known models: ${catalog.map((m) => m.id).join(", ")}. Proceeding anyway.`,
          );
        }
      }
    }
  }

  return { errors, warnings };
}

export { SUPPORTED_PROVIDERS, PROVIDER_LABELS };
export { LLM_MODEL_CATALOG, getModelsForVendor, getRecommendedModel } from "./llm-model-catalog.js";
