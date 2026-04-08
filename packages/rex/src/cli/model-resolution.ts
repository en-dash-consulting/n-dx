import type { LLMVendor } from "@n-dx/llm-client";
import { resolveModel } from "@n-dx/llm-client";

/**
 * Legacy `.rex/config.json` may contain a model string from an older
 * single-vendor setup. Only reuse it when it still matches the active vendor.
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

  return /^(gpt-|o\d|codex)/i.test(trimmed);
}

export function resolveVendorCompatibleRexModel(
  vendor: LLMVendor,
  model: string | undefined,
): string | undefined {
  return isModelCompatibleWithVendor(vendor, model) ? model?.trim() : undefined;
}
