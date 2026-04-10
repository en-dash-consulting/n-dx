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

import type { LLMVendor, LLMConfig } from "./llm-types.js";
import { resolveVendorModel, resolveModel } from "./config.js";
import { info, warn } from "./output.js";

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

  const resolved = resolveVendorModel(vendor, config);
  const isConfigured = vendor === "claude"
    ? !!config?.claude?.model
    : !!config?.codex?.model;
  const source = isConfigured ? "configured" : "default";

  info(`Vendor: ${vendor}  Model: ${resolved} (${source})`);

  if (options?.lastModel) {
    const resolvedLast = resolveModel(options.lastModel);
    if (resolvedLast !== resolved) {
      warn(`Warning: model changed since last run (was: ${resolvedLast}, now: ${resolved})`);
    }
  }
}
