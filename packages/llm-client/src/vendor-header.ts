/**
 * Vendor/model header output — surfaces the active vendor and resolved model
 * at the start of every LLM-invoked ndx command.
 *
 * Provides a consistent, single-line prefix showing:
 *   Vendor: claude  Model: claude-sonnet-4-6 (default)
 *
 * "configured" means the user explicitly set the model in .n-dx.json;
 * "default" means it fell back to the newest model for that vendor.
 *
 * Operators can use this to confirm what is being used without inspecting
 * config files, and spot unexpected model changes between runs.
 */

import type { LLMVendor, LLMConfig, TaskWeight } from "./llm-types.js";
import { resolveVendorModel, resolveModel } from "./config.js";
import { info, warn } from "./output.js";
import { yellow } from "./help-format.js";

export interface VendorModelHeaderOptions {
  /**
   * When set to "json", the header is suppressed to avoid polluting
   * machine-readable output.
   */
  format?: string;
  /**
   * Model string from the most recent run artifact.
   * When provided and different from the current resolved model (after
   * expanding shorthand aliases), a warning is emitted.
   */
  lastModel?: string;
  /**
   * The final resolved model after applying all overrides (CLI flag > .n-dx.json > default).
   * When provided, this is displayed instead of resolving from config alone.
   */
  resolvedModel?: string;
  /**
   * Source of the resolved model: "cli-override", "configured", or "default".
   * Used to label the model display appropriately.
   */
  modelSource?: "cli-override" | "configured" | "default";
  /**
   * Task weight tier being used. When provided, includes tier label in output:
   * - "light" → "(light tier)" or "(light tier, configured)"
   * - "standard" → "(standard tier)"
   *
   * When modelSource is "cli-override", tier label is omitted (explicit model
   * takes precedence over tier semantics).
   *
   * When not provided, falls back to legacy format for backward compatibility.
   */
  tier?: TaskWeight;
}

/**
 * Print a single line showing the active vendor, resolved model, and whether
 * the model was explicitly configured or defaulted to the newest available.
 *
 * Suppressed in quiet mode (via info/warn which respect setQuiet()) and when
 * format is "json". Call this at the start of any command that invokes an LLM.
 *
 * @param vendor   The active LLM vendor ("claude" | "codex").
 * @param config   The loaded LLM config; used to detect configured vs default.
 * @param options  Optional: format flag (skip in json mode) and last run model
 *                 (enables model-change detection).
 */
export function printVendorModelHeader(
  vendor: LLMVendor,
  config: LLMConfig | undefined,
  options?: VendorModelHeaderOptions,
): void {
  if (options?.format === "json") return;

  // Use provided resolved model if available, otherwise resolve from config
  const resolved = options?.resolvedModel || resolveVendorModel(vendor, config);

  // Identify which config slot supplied the model so we can annotate the
  // header with the exact source path. Top-level `llm.model` wins over
  // vendor-pinned `llm.{vendor}.model` (matches resolveVendorModel).
  const vendorPinnedModel = vendor === "claude"
    ? config?.claude?.model
    : vendor === "codex"
      ? config?.codex?.model
      : vendor === "google"
        ? config?.google?.model
        : undefined;
  const configuredFrom: "top-level" | "vendor-pinned" | undefined = config?.model
    ? "top-level"
    : vendorPinnedModel
      ? "vendor-pinned"
      : undefined;

  // Use provided source if available, otherwise determine from config
  let source: "cli-override" | "configured" | "default" = options?.modelSource || "default";
  if (!options?.modelSource && configuredFrom) {
    source = "configured";
  }

  // Format label based on tier and source
  // - When tier is provided and source is not cli-override, show tier-aware label
  // - When tier is not provided or source is cli-override, use legacy format
  let label: string;
  if (options?.tier && source !== "cli-override") {
    const tierLabel = options.tier === "light" ? "light tier" : "standard tier";
    label = source === "configured" ? `${tierLabel}, configured` : tierLabel;
  } else {
    label = source;
  }

  // When the model came from config, append the exact source key so users
  // can see which `.n-dx.json` field is winning (helps debug stale duplicates).
  let sourceSuffix = "";
  if (source === "configured" && configuredFrom) {
    sourceSuffix =
      configuredFrom === "top-level"
        ? " from llm.model"
        : ` from llm.${vendor}.model`;
  }

  info(`${yellow(`Vendor: ${vendor}`)}  ${yellow(`Model: ${resolved}`)} (${label}${sourceSuffix})`);

  if (options?.lastModel) {
    const resolvedLast = resolveModel(options.lastModel);
    if (resolvedLast !== resolved) {
      warn(`Warning: model changed since last run (was: ${resolvedLast}, now: ${resolved})`);
    }
  }
}
