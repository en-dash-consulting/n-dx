/**
 * Agent model resolution for `ndx work`.
 *
 * Precedence, highest first:
 *
 *   1. `--model` / `--<vendor>-model`   → "cli-override"
 *   2. `hench.models.<active vendor>`   → "hench-override"
 *   3. `llm.*` task-model resolution    → "configured"
 *      (llm.routes, llm.tiers.<vendor>.<tier>, llm.model, llm.<vendor>.model)
 *   4. newest model for the vendor      → "default"
 *
 * Rung 2 is what makes the agent loop separable from the rest of the toolkit:
 * `analyze`, `plan` and the dashboard's Ask panel all resolve from `llm.*`
 * alone, so pinning `hench.models.claude` changes the executor without
 * changing what anything else runs.
 *
 * The legacy `hench.model` scalar is deliberately absent from this chain — it
 * has never been read, and honouring it now would change the model under every
 * existing project on upgrade. See its deprecation note in `schema/v1.ts`.
 *
 * Extracted from `run.ts` so the chain is testable without standing up a whole
 * run; `cmdRun` calls this and nothing else decides the agent's model.
 */

import {
  LLM_VENDOR,
  isModelCompatibleWithVendor,
  resolveModel,
  resolveTaskModel,
} from "../../prd/llm-gateway.js";
import type { LLMConfig, LLMVendor, VendorModelHeaderOptions } from "../../prd/llm-gateway.js";
import type { HenchAgentModels } from "../../schema/v1.js";
import { CLIError } from "../errors.js";

/**
 * Where the agent's model came from. Derived from the header's own union
 * rather than restated, so a new source cannot be added on one side only.
 */
export type AgentModelSource = NonNullable<VendorModelHeaderOptions["modelSource"]>;

/**
 * The `llm.*` key `resolveTaskModel` reports. Derived from the function rather
 * than re-exported through the gateway, so it cannot drift from llm-client's
 * definition and costs the gateway no export.
 */
type ModelSourceKey = ReturnType<typeof resolveTaskModel>["source"];

/**
 * The config key that supplied the model: `cli-flag`, `hench.models.<vendor>`,
 * or whichever `llm.*` key {@link resolveTaskModel} reports (`llm.routes`,
 * `llm.tiers.<vendor>.<tier>`, `llm.model`, `llm.<vendor>.model`, …,
 * `vendor-default`). Finer than {@link AgentModelSource}, which only labels
 * the header; this is what `ndx work --resolve` reports.
 */
export type AgentModelRung = "cli-flag" | `hench.models.${string}` | Exclude<ModelSourceKey, "explicit">;

export interface AgentModelResolution {
  /** The model to run, with any shorthand alias already expanded. */
  model: string;
  /** Which rung of the chain supplied it; printed in the vendor/model header. */
  source: AgentModelSource;
  /** The config key behind {@link source} — see {@link AgentModelRung}. */
  rung: AgentModelRung;
}

/** {@link AgentModelResolution} plus the vendor mismatch a run would refuse on. */
export interface CheckedAgentModelResolution extends AgentModelResolution {
  /** Set when the winning configured model cannot run on the vendor. */
  mismatch?: CLIError;
}

export interface ResolveAgentModelParams {
  /** The active vendor, already resolved from config/flags. */
  vendor: LLMVendor;
  /** Raw `--model` / `--<vendor>-model` value, if the user passed one. */
  cliModelOverride?: string;
  /** `hench.models` — only the entry for `vendor` is consulted. */
  henchModels?: HenchAgentModels;
  /** The project's `llm.*` config. */
  llmConfig?: LLMConfig;
}

/**
 * The actionable vendor-mismatch error for a model that cannot run on the
 * active vendor, or undefined when it can.
 *
 * One function for every origin (a pinned `llm.model`, a `hench.models` entry)
 * so the two cannot drift into differently-worded advice for the same mistake.
 * `local` is absent by design: LM Studio serves whatever is loaded, so any
 * non-empty string is legitimate there.
 */
function modelVendorMismatch(vendor: LLMVendor, model: string): CLIError | undefined {
  if (vendor === LLM_VENDOR.CLAUDE && !isModelCompatibleWithVendor(LLM_VENDOR.CLAUDE, model)) {
    return new CLIError(
      `Configured model "${model}" is not compatible with vendor="claude".`,
      `Either use a Claude model (e.g., sonnet, opus) or switch vendor: 'n-dx config llm.vendor codex'`,
    );
  }
  if (vendor === LLM_VENDOR.CODEX && !isModelCompatibleWithVendor(LLM_VENDOR.CODEX, model)) {
    return new CLIError(
      `Configured model "${model}" is not compatible with vendor="codex".`,
      `Either use a Codex/GPT model (e.g., gpt-5.6-terra, gpt-5.6-luna) or switch vendor: 'n-dx config llm.vendor claude'`,
    );
  }
  if (vendor === LLM_VENDOR.GOOGLE && !isModelCompatibleWithVendor(LLM_VENDOR.GOOGLE, model)) {
    return new CLIError(
      `Configured model "${model}" is not compatible with vendor="google".`,
      `Either use a Gemini model (e.g., gemini-2.5-pro, gemini-3.7-flash) or switch vendor: 'n-dx config llm.vendor claude'`,
    );
  }
  return undefined;
}

/**
 * The model slot `resolveVendorModel` would pick for this vendor: the
 * top-level `llm.model` wins over the vendor-pinned `llm.<vendor>.model`.
 * Used for the compatibility check, which must fire on the value that will
 * actually be sent rather than on whichever slot happens to be populated.
 */
function activeConfiguredModel(vendor: LLMVendor, llmConfig?: LLMConfig): string | undefined {
  return (
    llmConfig?.model
    ?? (vendor === LLM_VENDOR.CLAUDE
      ? llmConfig?.claude?.model
      : vendor === LLM_VENDOR.CODEX
        ? llmConfig?.codex?.model
        : vendor === LLM_VENDOR.GOOGLE
          ? llmConfig?.google?.model
          : llmConfig?.local?.model)
  );
}

/**
 * Resolve the model the agent loop will run, and the label the vendor/model
 * header should print for it.
 *
 * @throws {CLIError} When the winning configured or overridden model cannot
 *   run on the active vendor. An explicit `--model` is never checked — the
 *   flag is taken as the user overruling the toolkit on purpose, which is the
 *   behaviour that predates this function.
 */
export function resolveAgentModel(params: ResolveAgentModelParams): AgentModelResolution {
  const { mismatch, ...resolution } = checkAgentModel(params);
  if (mismatch) throw mismatch;
  return resolution;
}

/**
 * {@link resolveAgentModel} without the throw: the same resolution, with the
 * vendor mismatch a run would refuse on returned rather than raised. For
 * callers that report a refusal instead of stopping (`ndx work --resolve`).
 */
export function checkAgentModel(params: ResolveAgentModelParams): CheckedAgentModelResolution {
  const { vendor, cliModelOverride, henchModels, llmConfig } = params;

  if (cliModelOverride) {
    return { model: resolveModel(cliModelOverride), source: "cli-override", rung: "cli-flag" };
  }

  // Agent-only override. Trimmed-empty counts as absent: an empty string in
  // config reads as "unset", not as a pin to the empty model.
  const henchOverride = henchModels?.[vendor]?.trim();
  if (henchOverride) {
    return {
      model: resolveModel(henchOverride),
      source: "hench-override",
      rung: `hench.models.${vendor}`,
      mismatch: modelVendorMismatch(vendor, henchOverride),
    };
  }

  // The agent loop is the `agent.execute` task class: standard tier by
  // default, but routable — `llm.routes["agent.execute"] = "heavy"` reaches
  // the heavy tier with no code change.
  const configured = resolveTaskModel("agent.execute", llmConfig, { vendor });

  const pinned = activeConfiguredModel(vendor, llmConfig);
  const mismatch = pinned ? modelVendorMismatch(vendor, pinned) : undefined;

  // `local` is intentionally missing from this test, matching the header's own
  // notion of "configured": llm.local.model still selects the model through
  // resolveTaskModel above, it is just labelled "default". Kept as-is so no
  // project's header changes wording on upgrade.
  const hasConfiguredModel =
    !!llmConfig?.model
    || (vendor === LLM_VENDOR.CLAUDE
      ? !!llmConfig?.claude?.model
      : vendor === LLM_VENDOR.CODEX
        ? !!llmConfig?.codex?.model
        : !!llmConfig?.google?.model);

  return {
    model: configured.model,
    source: hasConfiguredModel ? "configured" : "default",
    // No explicit model is passed to resolveTaskModel, so "explicit" cannot
    // come back; narrowed rather than cast so a change there fails here.
    rung: configured.source === "explicit" ? "vendor-default" : configured.source,
    ...(mismatch ? { mismatch } : {}),
  };
}
