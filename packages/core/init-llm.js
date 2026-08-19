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

const SUPPORTED_PROVIDERS = ["codex", "claude", "google", "local"];

/**
 * Legacy model IDs treated as "known" during init so `validateInitFlags` does
 * not warn about model IDs shipped by prior versions.
 *
 * The `codex` list must stay in sync with the keys of `LEGACY_CODEX_MODEL_ALIASES`
 * in `packages/llm-client/src/config.ts` — that is where these IDs are actually
 * resolved to current models at runtime. This tier cannot import the foundation
 * layer, so the sets are duplicated by design.
 */
const LEGACY_CATALOG_MODEL_ALIASES = {
  codex: ["gpt-5-codex", "gpt-5.1-codex-max", "gpt-5.1-codex-mini"],
  claude: ["claude-sonnet-4-6"],
  google: [],
  local: [],
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
  google: "Gemini (Google)",
  local: "Local (LM Studio)",
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

  // Always offer provider + model prompts on TTY so the user can confirm or
  // switch. Suppressed by the respective flag (--provider= / --model=).
  if (result.provider && isTTY && !flags.provider) {
    result.needsProviderPrompt = true;
  }
  if (result.provider && isTTY && !flags.model) {
    result.needsModelPrompt = true;
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
 * @param {string} [existingProvider]  Currently configured provider — pre-selected as default.
 * @returns {Promise<string|undefined>}  Selected provider or undefined on cancel.
 */
async function defaultPromptProvider(existingProvider) {
  if (!isInteractiveTerminal()) {
    // Non-TTY environments should not reach here (resolveInitLLMSelection
    // sets needsProviderPrompt=false when isTTY is false). Safety fallback.
    return existingProvider ?? undefined;
  }

  try {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();

    const choices = SUPPORTED_PROVIDERS.map((p) => ({
      name: p,
      message: PROVIDER_LABELS[p] || p,
    }));

    const initialIndex = existingProvider
      ? SUPPORTED_PROVIDERS.indexOf(existingProvider)
      : 0;

    const response = await enquirer.prompt({
      type: "select",
      name: "provider",
      message: "Select LLM provider",
      choices,
      initial: initialIndex >= 0 ? initialIndex : 0,
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
 * @param {string} provider      The resolved provider (e.g. "codex", "claude").
 * @param {string} [existingModel]  Current model from config — pre-selected as default.
 * @returns {Promise<string|undefined>}  Selected model ID or undefined on cancel.
 */
async function defaultPromptModel(provider, existingModel) {
  const models = getModelsForVendor(provider);
  if (!models || models.length === 0) return undefined;

  // Single-model vendor: return the only option without prompting
  if (models.length === 1) return models[0].id;

  if (isInteractiveTerminal()) {
    return promptModelEnquirer(provider, models, existingModel);
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
 * When `existingModel` is provided (re-prompt on reinit), it is pre-selected
 * so the user can confirm with Enter or arrow to a different model.
 * Falls back to the recommended model, then the first entry.
 *
 * @param {string} provider
 * @param {import("./llm-model-catalog.js").ModelEntry[]} models
 * @param {string} [existingModel]  Currently configured model (pre-selected default).
 * @returns {Promise<string|undefined>}
 */
async function promptModelEnquirer(provider, models, existingModel) {
  try {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();

    const recommended = getRecommendedModel(provider);
    // Pre-select the existing model when re-prompting; fall back to recommended.
    const initialIndex = (() => {
      if (existingModel) {
        const idx = models.findIndex((m) => m.id === existingModel);
        if (idx >= 0) return idx;
      }
      if (recommended) {
        const idx = models.findIndex((m) => m.id === recommended.id);
        if (idx >= 0) return idx;
      }
      return 0;
    })();

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

/**
 * Fetch available models from a running local LLM server (LM Studio / Ollama).
 *
 * Sends a GET to /v1/models — the OpenAI-compatible endpoint all local servers
 * expose. Returns sorted model IDs on success, or an empty array when the server
 * is unreachable, times out, or returns an unexpected response.
 *
 * Pure I/O — no prompting; caller decides how to present the list.
 *
 * @param {string} [host]  Server hostname (default: "localhost")
 * @param {number} [port]  Server port (default: 1234)
 * @returns {Promise<string[]>}  Sorted model IDs, or [] on failure.
 */
async function fetchLocalModels(host = "localhost", port = 1234) {
  try {
    const { default: http } = await import("http");
    return await new Promise((resolve) => {
      let body = "";
      const req = http.get(
        {
          host,
          port,
          path: "/v1/models",
          headers: { Accept: "application/json" },
        },
        (res) => {
          if (res.statusCode !== 200) { res.resume(); resolve([]); return; }
          res.setEncoding("utf-8");
          res.on("data", (chunk) => { body += chunk; });
          res.on("end", () => {
            try {
              const data = JSON.parse(body);
              const ids = (data?.data ?? [])
                .map((m) => m.id)
                .filter(Boolean)
                .sort();
              resolve(ids);
            } catch {
              resolve([]);
            }
          });
        },
      );
      // 3-second timeout — init should not stall waiting for a slow server.
      req.setTimeout(3000, () => { req.destroy(); resolve([]); });
      req.on("error", () => resolve([]));
    });
  } catch {
    return [];
  }
}

/** Sentinel returned by the select prompt when the user picks "No preference". */
const LOCAL_NO_PREFERENCE = "__local_no_preference__";

/**
 * Interactive model selector for the local vendor — fetches the live model list
 * from the running LM Studio / Ollama server and presents them as a select prompt.
 *
 * "No preference" is always the first choice; selecting it leaves the model unset
 * so LM Studio uses whichever model is currently loaded. If the server is not
 * running (empty model list), the prompt is skipped — model stays unset.
 *
 * @param {string|undefined} existingModel  Current model from config (pre-selected if in list).
 * @param {string} [host]  Local server host (default: "localhost")
 * @param {number} [port]  Local server port (default: 1234)
 * @returns {Promise<string|undefined>}  Selected model ID, or undefined for "no preference" / server down.
 */
async function promptLocalModelFromServer(existingModel, host = "localhost", port = 1234) {
  if (!isInteractiveTerminal()) return existingModel ?? undefined;

  const models = await fetchLocalModels(host, port);

  if (models.length === 0) {
    // Server not running or no models available — skip silently.
    // Write to stderr so it doesn't disrupt Enquirer's rendering.
    process.stderr.write(
      `  ℹ  No models found at http://${host}:${port}/v1/models — model will remain unset.\n`,
    );
    return undefined;
  }

  // Build choices: "No preference" sentinel first, then the live model list.
  const choices = [
    { name: LOCAL_NO_PREFERENCE, message: "No preference — use whatever is currently loaded" },
    ...models.map((id) => ({ name: id, message: id })),
  ];

  // Pre-select the existing model if it's in the live list; otherwise "No preference".
  const initialIndex = (() => {
    if (existingModel) {
      const idx = choices.findIndex((c) => c.name === existingModel);
      if (idx >= 0) return idx;
    }
    return 0;
  })();

  try {
    const { default: Enquirer } = await import("enquirer");
    const enquirer = new Enquirer();
    const response = await enquirer.prompt({
      type: "select",
      name: "model",
      message: `Select local model (${models.length} available at ${host}:${port})`,
      choices,
      initial: initialIndex,
    });
    return response.model === LOCAL_NO_PREFERENCE ? undefined : (response.model || undefined);
  } catch (err) {
    // Ctrl+C or Esc — local model is optional, don't cancel init.
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
 * - Model prompt (non-local): enquirer Select (TTY) or auto-select recommended (non-TTY), driven by llm-model-catalog.js.
 * - Model prompt (local): live fetch from /v1/models then enquirer Select; skips silently if server is down.
 *
 * @param {object} resolution                       Output of resolveInitLLMSelection()
 * @param {object} [options]
 * @param {() => Promise<string|undefined>}         [options.promptProvider]  Override provider prompt
 * @param {(provider: string) => Promise<string|undefined>}  [options.promptModel]  Override model prompt (non-local)
 * @param {(existing: string|undefined) => Promise<string|undefined>}  [options.promptLocalModel]  Override local model prompt
 * @param {string}  [options.localHost]  Local LLM server hostname (default: "localhost")
 * @param {number}  [options.localPort]  Local LLM server port (default: 1234)
 * @returns {Promise<{ provider?: string, model?: string, providerSource?: string, modelSource?: string, cancelled: boolean }>}
 */
export async function promptLLMSelection(resolution, options = {}) {
  let { provider, model, providerSource, modelSource } = resolution;
  const { needsProviderPrompt, needsModelPrompt } = resolution;
  let cancelled = false;

  if (needsProviderPrompt) {
    const promptFn = options.promptProvider ?? defaultPromptProvider;
    const selected = await promptFn(provider);  // pass existing for pre-selection
    if (selected) {
      if (selected !== provider) {
        // Vendor changed — old model belongs to the old vendor, reset it so
        // the model prompt starts fresh for the new vendor.
        model = undefined;
        modelSource = undefined;
      }
      provider = selected;
      providerSource = "prompt";
    } else if (providerSource !== "config") {
      // Esc/Ctrl+C with no prior provider → abort.
      // If provider was already in config, Esc means "keep existing".
      cancelled = true;
    }
  }

  // Local vendor: fetch available models live from the server, show as a select
  // prompt. "No preference" / server-down both return undefined — model stays
  // unset so LM Studio uses whatever is currently loaded. No cancellation: local
  // model is always optional.
  if (needsModelPrompt && provider === "local") {
    const promptFn = options.promptLocalModel
      ?? ((existing) => promptLocalModelFromServer(existing, options.localHost, options.localPort));
    const selected = await promptFn(model);
    if (selected) {
      model = selected;
      modelSource = "prompt";
    } else {
      // "No preference" selected or server down: clear any previously set model
      // so config stays clean.
      model = undefined;
      modelSource = undefined;
    }
  }

  // Non-local vendors: catalog-driven select prompt.
  // Pass the existing model so it is pre-selected (confirm with Enter or change).
  // Cancellation (Ctrl+C/Esc) keeps the existing config model and does NOT mark
  // the selection as cancelled — Esc means "keep what I had", not "abort init".
  // Only mark cancelled when there was no existing model to fall back to.
  if (needsModelPrompt && provider && provider !== "local") {
    const promptFn = options.promptModel ?? defaultPromptModel;
    const selected = await promptFn(provider, model);
    if (selected) {
      model = selected;
      modelSource = "prompt";
    } else if (modelSource !== "config") {
      // No prior model in config — treat cancellation as an abort.
      cancelled = true;
    }
    // else: model stays as the existing config value; cancelled stays false.
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
 * @param {string} [flags.googleModel]   --google-model= value
 * @param {string} [flags.googleLightModel]  --google-light-model= value
 *
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function validateInitFlags({ provider, model, claudeModel, codexModel, googleModel, googleLightModel }) {
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
  if (googleModel && model) {
    errors.push("Cannot set both --google-model and --model. Use one or the other.");
  }

  // Note: --claude-model + --codex-model is valid (configure both vendors).
  // Note: --provider=codex + --claude-model is valid (set active vendor to codex,
  //        configure claude model independently). Same for cross-vendor combinations.

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

    if (googleModel) {
      const catalog = getModelsForVendor("google");
      if (catalog && !isKnownModel("google", googleModel)) {
        warnings.push(
          `Unknown model "${googleModel}" for google. ` +
          `Known models: ${catalog.map((m) => m.id).join(", ")}. Proceeding anyway.`,
        );
      }
    }

    if (googleLightModel) {
      const catalog = getModelsForVendor("google");
      if (catalog && !isKnownModel("google", googleLightModel)) {
        warnings.push(
          `Unknown light model "${googleLightModel}" for google. ` +
          `Known models: ${catalog.map((m) => m.id).join(", ")}. Proceeding anyway.`,
        );
      }
    }

    // Check --model against the effective provider (flag or implied).
    if (model) {
      const effectiveProvider = provider || (claudeModel ? "claude" : codexModel ? "codex" : googleModel ? "google" : undefined);
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
