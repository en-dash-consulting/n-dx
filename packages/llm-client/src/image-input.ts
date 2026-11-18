/**
 * Whether a configured vendor and model take image input.
 *
 * The dashboard offers to attach images to a new PRD change only when the
 * model that will work on it can look at them. This is the one place that
 * answers that, so the button and any later consumer agree.
 *
 * Deliberately conservative where it cannot know: a hosted vendor whose
 * current models are all multimodal answers yes unless the model id names a
 * known text-only family, and a local model answers yes only when its name
 * says it is a vision model. A wrong "no" hides a button; a wrong "yes" sends
 * images to a model that drops or refuses them.
 */

import type { LLMVendor } from "./provider-interface.js";

/** Text-only families a hosted vendor still serves, by model-id prefix. */
const TEXT_ONLY_PREFIXES: Partial<Record<LLMVendor, readonly string[]>> = {
  claude: ["claude-instant", "claude-2"],
  codex: ["gpt-3.5", "o1-mini", "o3-mini", "codex-mini"],
};

/** Local model names that mark a vision model (llava, qwen2.5vl, llama3.2-vision, minicpm-v, …). */
const LOCAL_VISION_NAME = /llava|vision|moondream|minicpm-v|(?:^|[^a-z])vl(?:[^a-z]|$)|qwen[\d.]*-?vl|gemma3|pixtral|granite3\.2-vision/i;

/**
 * Whether `vendor` with `model` (the configured id; absent when the vendor
 * picks its own default) accepts images alongside text.
 */
export function acceptsImageInput(vendor: string | null | undefined, model?: string | null): boolean {
  const id = (model ?? "").trim().toLowerCase();
  switch (vendor) {
    case "claude":
    case "codex":
    case "google":
      return !(TEXT_ONLY_PREFIXES[vendor] ?? []).some((prefix) => id.startsWith(prefix));
    case "local":
      return id !== "" && LOCAL_VISION_NAME.test(id);
    default:
      return false;
  }
}
