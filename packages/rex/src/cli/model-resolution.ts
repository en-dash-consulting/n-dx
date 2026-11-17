import { isModelCompatibleWithVendor, type LLMConfig, type LLMVendor } from "@n-dx/llm-client";

/**
 * The `modelSource` a rex command passes to `printVendorModelHeader`: an
 * explicit `--model` flag, a model configured for any vendor (its
 * `lightModel` when the command runs on the light tier), or the vendor
 * default.
 */
export function headerModelSource(
  flagModel: string | undefined,
  llmConfig: LLMConfig,
  tier?: "light",
): "cli-override" | "configured" | "default" {
  if (flagModel) return "cli-override";
  const configured = tier === "light"
    ? llmConfig.claude?.lightModel || llmConfig.codex?.lightModel || llmConfig.google?.lightModel
    : llmConfig.claude?.model || llmConfig.codex?.model || llmConfig.google?.model;
  return configured ? "configured" : "default";
}

/**
 * Legacy `.rex/config.json` may contain a model string from an older
 * single-vendor setup. Only reuse it when it still matches the active vendor.
 */
export function resolveVendorCompatibleRexModel(
  vendor: LLMVendor,
  model: string | undefined,
): string | undefined {
  return isModelCompatibleWithVendor(vendor, model) ? model?.trim() : undefined;
}
