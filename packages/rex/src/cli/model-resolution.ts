import { LLM_VENDOR, resolveModel, type LLMConfig, type LLMVendor } from "@n-dx/llm-client";

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
export function isModelCompatibleWithVendor(
  vendor: LLMVendor,
  model: string | undefined,
): boolean {
  const trimmed = model?.trim();
  if (!trimmed) return false;

  if (vendor === LLM_VENDOR.CLAUDE) {
    return resolveModel(trimmed).startsWith("claude-");
  }

  if (vendor === LLM_VENDOR.GOOGLE) {
    return trimmed.startsWith("gemini-");
  }

  if (vendor === LLM_VENDOR.LOCAL) {
    // Local vendor accepts any non-empty model string — LM Studio will validate
    // against its own loaded model list. Empty string means "use whatever is loaded".
    return true;
  }

  return /^(gpt-|o\d|codex)/i.test(trimmed);
}

export function resolveVendorCompatibleRexModel(
  vendor: LLMVendor,
  model: string | undefined,
): string | undefined {
  return isModelCompatibleWithVendor(vendor, model) ? model?.trim() : undefined;
}
