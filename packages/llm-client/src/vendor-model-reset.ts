/**
 * Vendor-change detection and stale model reset.
 *
 * When a user changes the LLM vendor (e.g., claude → codex), any previously
 * configured model value becomes stale. This module detects such changes and
 * clears invalid model strings before config is persisted.
 *
 * Model compatibility is vendor-specific:
 * - Claude: model must resolve to start with "claude-"
 * - Codex: model must match /^(gpt-|o\d|codex)/i (GPT models, O1/O3, Codex brand)
 */

import { resolveModel } from "./config.js";
import type { LLMVendor } from "./llm-types.js";

/**
 * Check if a model string is compatible with a given vendor.
 *
 * @param vendor  The target vendor ("claude" | "codex")
 * @param model   The model string to validate
 * @returns       true if the model is compatible with the vendor
 */
export function isModelCompatibleWithVendor(
  vendor: LLMVendor,
  model: string | undefined,
): boolean {
  const trimmed = model?.trim();
  if (!trimmed) return false;

  if (vendor === "claude") {
    return resolveModel(trimmed).startsWith("claude-");
  }

  // Codex: GPT models (gpt-*), O-series (o1, o3, etc), or explicit "codex" brand
  return /^(gpt-|o\d|codex)/i.test(trimmed);
}

/**
 * Detect whether the vendor is changing.
 *
 * @param oldVendor  The previous vendor (undefined if not set)
 * @param newVendor  The new vendor being set
 * @returns          true if vendor is changing (different or was undefined)
 */
export function detectVendorChange(
  oldVendor: LLMVendor | undefined,
  newVendor: LLMVendor,
): boolean {
  return oldVendor !== newVendor;
}

/**
 * Result of a vendor-change model reset operation.
 */
export interface VendorModelResetResult {
  /** Whether the model was actually reset (incompatible + vendor changed). */
  changed: boolean;
  /** The previous model string (undefined if none was set). */
  oldModel: string | undefined;
  /** The new model string (undefined if reset, same as oldModel if compatible). */
  newModel: string | undefined;
  /** Human-readable reason for the reset (undefined if no reset occurred). */
  reason: string | undefined;
}

/**
 * Determine if a model reset is needed and return the result.
 *
 * If the vendor is changing and the old model is incompatible with the new
 * vendor, the reset result indicates that the model should be cleared.
 *
 * @param oldVendor  The previous vendor (undefined if not set)
 * @param oldModel   The previously configured model (undefined if not set)
 * @param newVendor  The new vendor being set
 * @returns          Result describing what happened
 */
export function resetStaleModel(
  oldVendor: LLMVendor | undefined,
  oldModel: string | undefined,
  newVendor: LLMVendor,
): VendorModelResetResult {
  const vendorChanged = detectVendorChange(oldVendor, newVendor);

  // If vendor isn't changing, no reset needed
  if (!vendorChanged) {
    return {
      changed: false,
      oldModel,
      newModel: oldModel,
      reason: undefined,
    };
  }

  // Vendor is changing. Check if old model is compatible with new vendor.
  const modelIsCompatible = isModelCompatibleWithVendor(newVendor, oldModel);

  if (modelIsCompatible) {
    // Old model works with new vendor, no reset needed
    return {
      changed: false,
      oldModel,
      newModel: oldModel,
      reason: undefined,
    };
  }

  // Old model is incompatible with new vendor, reset it
  return {
    changed: true,
    oldModel,
    newModel: undefined,
    reason:
      oldVendor && oldModel
        ? `Vendor changed from "${oldVendor}" to "${newVendor}". Model "${oldModel}" is not compatible with ${newVendor}.`
        : `Vendor changed to "${newVendor}".`,
  };
}

/**
 * Format a vendor-change warning message for display.
 *
 * @param result     The reset result from resetStaleModel()
 * @param newDefault The default model for the new vendor (for recommendation)
 * @returns          Formatted warning message, or undefined if no warning needed
 */
export function formatVendorChangeWarning(
  result: VendorModelResetResult,
  newDefault: string,
): string | undefined {
  if (!result.changed || !result.reason) {
    return undefined;
  }

  const lines = [result.reason];
  if (result.oldModel) {
    lines.push(`  Old model: ${result.oldModel}`);
  }
  lines.push(`  New default: ${newDefault}`);

  return lines.join("\n");
}
