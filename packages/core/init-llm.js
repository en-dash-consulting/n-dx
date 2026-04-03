/**
 * LLM selection logic for `ndx init`.
 *
 * Extracted from cli.js to keep handleInit() focused on orchestration.
 * This module owns both the resolution logic (what's already known) and
 * the prompting orchestration (filling in missing values interactively).
 *
 * ## Tier
 *
 * Orchestration — same rules as cli.js: no package imports, only node: builtins.
 *
 * ## Precedence
 *
 * 1. Explicit CLI flags (--provider=, --model=)
 * 2. Existing project config (.n-dx.json)
 * 3. Interactive prompt (TTY only)
 * 4. Runtime default fallback (handled by caller)
 */

import { createInterface } from "node:readline/promises";

const SUPPORTED_PROVIDERS = ["codex", "claude"];

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
 * Default interactive provider prompt using readline.
 * Mirrors the existing promptInitProvider() in cli.js.
 *
 * @returns {Promise<string|undefined>}  Selected provider or undefined on cancel.
 */
async function defaultPromptProvider() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const abort = new AbortController();
  const onSigint = () => abort.abort();
  process.once("SIGINT", onSigint);

  try {
    console.log("Select active LLM provider:");
    for (let i = 0; i < SUPPORTED_PROVIDERS.length; i++) {
      console.log(`  ${i + 1}) ${SUPPORTED_PROVIDERS[i]}`);
    }
    console.log("");

    while (true) {
      const answer = (
        await rl.question("Enter choice [1-2]: ", { signal: abort.signal })
      )
        .trim()
        .toLowerCase();

      if (!answer) return undefined;

      const idx = parseInt(answer, 10);
      if (idx >= 1 && idx <= SUPPORTED_PROVIDERS.length) {
        return SUPPORTED_PROVIDERS[idx - 1];
      }
      if (SUPPORTED_PROVIDERS.includes(answer)) {
        return answer;
      }

      console.error(
        `Invalid selection. Choose ${SUPPORTED_PROVIDERS.map((p) => `'${p}'`).join(" or ")}.`,
      );
    }
  } catch (err) {
    if (err && typeof err === "object" && err.name === "AbortError") {
      return undefined;
    }
    throw err;
  } finally {
    process.removeListener("SIGINT", onSigint);
    rl.close();
  }
}

/**
 * Default model prompt — placeholder until the model catalog epic lands.
 *
 * Returns undefined so the caller falls back to runtime defaults.
 * The model catalog epic will replace this with a keyboard-driven selector.
 *
 * @param {string} _provider  The resolved provider (unused until model catalog exists).
 * @returns {Promise<undefined>}
 */
async function defaultPromptModel(_provider) {
  return undefined;
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
 * - Provider prompt: readline-based numeric/text selector.
 * - Model prompt: no-op (returns undefined) until the model catalog epic lands.
 *
 * @param {object} resolution                       Output of resolveInitLLMSelection()
 * @param {object} [options]
 * @param {() => Promise<string|undefined>}         [options.promptProvider]  Override provider prompt
 * @param {(provider: string) => Promise<string|undefined>}  [options.promptModel]  Override model prompt
 * @returns {Promise<{ provider?: string, model?: string, providerSource?: string, modelSource?: string }>}
 */
export async function promptLLMSelection(resolution, options = {}) {
  let { provider, model, providerSource, modelSource } = resolution;
  const { needsProviderPrompt, needsModelPrompt } = resolution;

  if (needsProviderPrompt) {
    const promptFn = options.promptProvider ?? defaultPromptProvider;
    const selected = await promptFn();
    if (selected) {
      provider = selected;
      providerSource = "prompt";
    }
  }

  if (needsModelPrompt && provider) {
    const promptFn = options.promptModel ?? defaultPromptModel;
    const selected = await promptFn(provider);
    if (selected) {
      model = selected;
      modelSource = "prompt";
    }
  }

  return { provider, model, providerSource, modelSource };
}

export { SUPPORTED_PROVIDERS };
