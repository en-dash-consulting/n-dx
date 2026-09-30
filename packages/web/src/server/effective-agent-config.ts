/**
 * What `ndx work` will actually run, with no flags.
 *
 * The dashboard's Robot Wrangler page has to answer one question — "if I press
 * Run, which vendor, provider and model does the agent loop use?" — and that
 * answer is assembled from three files that no single route read: `llm.vendor`
 * and the `llm.*` model fields in `.n-dx.json`, and `provider` / `models` in
 * `.hench/config.json`. Showing the configured keys instead, as the LLM
 * Provider view did, shows the inputs to a resolution and leaves the reader to
 * perform it — which is exactly the step that goes wrong, because the rungs
 * are not in the order anyone guesses.
 *
 * ## This is a twin, and it is deliberate
 *
 * Web cannot import hench: hench is the execution tier, above the domain
 * packages web depends on. So the two functions below are separately
 * maintained copies of hench's own resolution —
 * `resolveAgentModel` (`packages/hench/src/cli/commands/agent-model.ts`) and
 * the provider gate in `cmdRun` driven by `isProviderSupported`
 * (`packages/hench/src/cli/commands/provider-support.ts`).
 * `tests/integration/effective-agent-config-contract.test.js` runs a fixture
 * matrix through both sides and fails when they disagree, the same
 * one-directional pattern `VENDOR_PROVIDERS` already uses in
 * `hench-config-fields.ts`.
 *
 * Only the *chain* is copied. Every rung's actual computation —
 * `resolveTaskModel`, `resolveModel`'s alias expansion, the vendor defaults —
 * is called from `@n-dx/llm-client`, the foundation tier both packages share,
 * so a change to what a tier resolves to cannot make the two disagree. What
 * could drift is the ordering, and that is what the contract test pins.
 *
 * ## This reports a resolution, not a verdict
 *
 * Two configurations resolve here but would refuse to run: `vendor=codex` with
 * `provider=api` (hench throws — codex has no API loop), and a model pinned for
 * a vendor that cannot run it (hench throws from `assertModelVendorCompatible`).
 * Neither throws here, because a settings page that 500s on a bad saved value
 * is a settings page you cannot use to fix it. The caller reports what the
 * config resolves to; `validateProviderForVendor` (`hench-config-fields.ts`)
 * and `isModelCompatibleWithVendor` (`@n-dx/llm-client`) are how the UI marks
 * that resolution as one `ndx work` would reject.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_LLM_VENDOR,
  LLM_VENDOR,
  isLLMVendor,
  loadLLMConfig,
  resolveLayout,
  resolveModel,
  resolveTaskModel,
} from "@n-dx/llm-client";
import type { LLMConfig, LLMVendor, ModelSource } from "@n-dx/llm-client";
import { VENDOR_PROVIDERS } from "./hench-config-fields.js";

/** The two ways hench can drive a vendor. Mirrors hench's `HenchProvider`. */
export type HenchProvider = "cli" | "api";

/**
 * The model sources reachable from a route.
 *
 * Derived from llm-client's own `ModelSource` union rather than restated as
 * string literals, so a new rung cannot be added on hench's side without this
 * type widening too. `cli-override` is excluded by construction: an HTTP
 * request carries no `--model` flag, so the route can never observe that rung.
 */
export type EffectiveModelSource = Exclude<ModelSource, "cli-override">;

/** The `effective` block of `GET /api/llm/config`. */
export interface EffectiveAgentConfig {
  /** Active vendor: `llm.vendor`, defaulting to claude. */
  vendor: LLMVendor;
  /** `hench.provider`, switched to one the vendor accepts where hench switches. */
  provider: HenchProvider;
  /** The model the agent loop runs, with any shorthand alias expanded. */
  model: string;
  /** Which rung of the chain supplied {@link EffectiveAgentConfig.model}. */
  modelSource: EffectiveModelSource;
}

/**
 * The provider hench would run this vendor on.
 *
 * Mirrors `cmdRun`'s gate: a vendor that rejects `"cli"` always accepts
 * `"api"`, so an unsupported `"cli"` silently auto-switches. An unsupported
 * `"api"` — codex only, which has no API loop — has no such fallback and hench
 * fails loudly instead. There is nothing to switch it *to*, so it is reported
 * unchanged; see the note on verdicts in this file's header for who flags it.
 */
export function resolveEffectiveProvider(
  vendor: LLMVendor,
  configured: HenchProvider,
): HenchProvider {
  if (VENDOR_PROVIDERS[vendor].includes(configured)) return configured;
  return configured === "cli" ? "api" : configured;
}

/**
 * The model slot hench treats as "configured" for this vendor.
 *
 * `local` is absent on purpose, matching hench: `llm.local.model` still selects
 * the model through `resolveTaskModel`, it is just labelled `default`. Copied
 * rather than simplified so no project's reported source changes wording.
 */
function hasConfiguredModel(vendor: LLMVendor, llmConfig?: LLMConfig): boolean {
  if (llmConfig?.model) return true;
  if (vendor === LLM_VENDOR.CLAUDE) return !!llmConfig?.claude?.model;
  if (vendor === LLM_VENDOR.CODEX) return !!llmConfig?.codex?.model;
  return !!llmConfig?.google?.model;
}

/**
 * The model `ndx work` resolves with no `--model`, and which rung supplied it.
 *
 * Twin of hench's `resolveAgentModel` with the `cli-override` rung removed.
 * Rung order, highest first: `hench.models.<vendor>`, then the `llm.*` task-model
 * resolution for the `agent.execute` class, then the vendor default.
 */
export function resolveEffectiveAgentModel(
  vendor: LLMVendor,
  henchModels: Partial<Record<LLMVendor, string>> | undefined,
  llmConfig: LLMConfig | undefined,
): { model: string; source: EffectiveModelSource } {
  // Trimmed-empty counts as absent: an empty string in config reads as
  // "unset", not as a pin to the empty model. Same rule hench applies.
  const override = henchModels?.[vendor]?.trim();
  if (override) {
    return { model: resolveModel(override), source: "hench-override" };
  }

  // The agent loop is the `agent.execute` task class — routable, so
  // `llm.routes["agent.execute"] = "heavy"` moves it without a code change.
  const configured = resolveTaskModel("agent.execute", llmConfig, { vendor });
  return {
    model: configured.model,
    source: hasConfiguredModel(vendor, llmConfig) ? "configured" : "default",
  };
}

/**
 * `provider` and `models` from `.hench/config.json`, with hench's own defaults
 * applied to anything absent or malformed.
 *
 * A file that is missing, unparseable, or holds a `provider` outside
 * `cli`/`api` yields hench's `DEFAULT_HENCH_CONFIG` value of `"cli"` — hench
 * loads its config with `onInvalid: "use-defaults"`, so a bad field degrades
 * to the default there too rather than refusing the run.
 */
function readHenchAgentSettings(projectDir: string): {
  provider: HenchProvider;
  models: Partial<Record<LLMVendor, string>>;
} {
  let raw: Record<string, unknown>;
  try {
    const path = join(resolveLayout(projectDir).henchDir, "config.json");
    raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return { provider: "cli", models: {} };
  }

  const provider = raw["provider"] === "api" || raw["provider"] === "cli" ? raw["provider"] : "cli";

  return { provider, models: readAgentModels(raw["models"]) };
}

/**
 * The `models` map, or `{}` when hench would refuse it.
 *
 * **Any invalid entry discards the whole map**, which looks over-strict until
 * you follow what hench does with the same file. `HenchConfigSchema`'s
 * `models` is `.strict()` with `z.string().min(1)` values, so one unknown
 * vendor key fails validation for the field — and `loadConfig`'s
 * `onInvalid: "use-defaults"` salvage replaces *each invalid top-level field*
 * with its default, dropping optional ones the defaults do not carry.
 * `models` is exactly such a field, so hench ends up with no override at all,
 * not with the valid entries kept.
 *
 * Filtering the bad key and keeping the rest — the obvious reading — makes
 * this route disagree with the run on a plausible typo: `ndx config
 * hench.models.gemini …` (the vendor is `google`; its models are Gemini) is
 * accepted by the CLI, and the dashboard would then report that model as the
 * agent's while `ndx work` warns and runs the `llm.*` one instead.
 *
 * Whitespace-only is deliberately *not* rejected here: `.min(1)` accepts it,
 * so hench validates it and then `resolveAgentModel`'s own `trim()` reads it
 * as unset — which is what {@link resolveEffectiveAgentModel} also does.
 */
function readAgentModels(rawModels: unknown): Partial<Record<LLMVendor, string>> {
  if (rawModels === undefined) return {};
  if (!rawModels || typeof rawModels !== "object" || Array.isArray(rawModels)) return {};

  const models: Partial<Record<LLMVendor, string>> = {};
  for (const [vendor, value] of Object.entries(rawModels as Record<string, unknown>)) {
    if (!isLLMVendor(vendor)) return {};
    if (typeof value !== "string" || value.length < 1) return {};
    models[vendor] = value;
  }
  return models;
}

/**
 * Assemble the `effective` block: what `ndx work` runs in this project with no
 * flags. Reads `.n-dx.json` (+ the `.n-dx.local.json` overlay, local wins) via
 * `loadLLMConfig` — the same loader hench uses — and `.hench/config.json`.
 */
export async function resolveEffectiveAgentConfig(
  projectDir: string,
): Promise<EffectiveAgentConfig> {
  const llmConfig = await loadLLMConfig(projectDir);
  const vendor = llmConfig.vendor ?? DEFAULT_LLM_VENDOR;
  const hench = readHenchAgentSettings(projectDir);
  const { model, source } = resolveEffectiveAgentModel(vendor, hench.models, llmConfig);

  return {
    vendor,
    provider: resolveEffectiveProvider(vendor, hench.provider),
    model,
    modelSource: source,
  };
}
