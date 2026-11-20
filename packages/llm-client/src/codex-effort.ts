/**
 * Explicit effort overrides only: omission preserves user/profile/client defaults.
 * API validation uses verified model capabilities; CLI validation uses live metadata.
 * Verified 2026-11-16 against the config reference and API reasoning guide:
 * https://learn.chatgpt.com/docs/config-file/config-reference
 * https://developers.openai.com/api/docs/guides/reasoning
 * Per-model values: https://developers.openai.com/api/docs/models/<model-id>
 * Unknown models are deliberately not inferred from a gpt-* prefix.
 */
import { listCodexModels, type CodexModelListOptions } from "./codex-model-list.js";
import { warn } from "./output.js";

const STANDARD = ["low", "medium", "high"];
const EXTENDED = [...STANDARD, "xhigh"];
const MAX = [...EXTENDED, "max"];
const MODELS: Readonly<Record<string, readonly string[]>> = {
  "gpt-6.1-sol": MAX,
  "gpt-6.1-terra": ["none", ...MAX],
  "gpt-6-astra": MAX,
  "gpt-6-sol": ["none", ...MAX],
  "gpt-6-luna": ["none", ...MAX],
  "gpt-5.5": ["none", ...EXTENDED],
  "gpt-5.4": ["none", ...EXTENDED],
  "gpt-5.4-mini": ["none", ...EXTENDED],
  "gpt-5.4-nano": ["none", ...EXTENDED],
  "gpt-5.2": ["none", ...EXTENDED],
  "gpt-5.1": ["none", ...STANDARD],
  "gpt-5": ["minimal", ...STANDARD],
  "gpt-5-mini": ["minimal", ...STANDARD],
  "gpt-5-nano": ["minimal", ...STANDARD],
  "o3": STANDARD,
  "o3-mini": STANDARD,
  "o4-mini": STANDARD,
  "o1": STANDARD,
};

/** Models whose Chat Completions limit includes reasoning and visible output. */
export function usesOpenAiCompletionTokenLimit(model: string): boolean {
  return Object.hasOwn(MODELS, model.replace(/-\d{4}-\d{2}-\d{2}$/, ""));
}

/** Validate a configured pin for the selected model and client dialect. */
export function resolveOpenAiEffort(
  model: string | undefined,
  configured: string | undefined,
  taskClass?: string,
): string | undefined {
  if (configured === undefined) return undefined;
  const id = model?.replace(/-\d{4}-\d{2}-\d{2}$/, "");
  const levels = id && Object.hasOwn(MODELS, id) ? MODELS[id] : undefined;
  if (levels?.includes(configured)) return configured;
  warn(`llm.effort "${configured}"${taskClass ? ` for task class "${taskClass}"` : ""} was not sent: ` +
    `${model || "the unspecified model"} on the OpenAI API ` +
    (levels ? `supports ${levels.join(", ")}.` : "has no verified effort capability; leaving the client default unchanged."));
  return undefined;
}

/** Probe the selected binary in the same cwd/environment; never infer account access. */
export async function resolveCodexCliEffort(
  model: string | undefined,
  configured: string | undefined,
  options: CodexModelListOptions,
  taskClass?: string,
): Promise<string | undefined> {
  if (configured === undefined) return undefined;
  const catalog = await listCodexModels(options);
  const efforts = catalog.ok ? catalog.reasoningEfforts : undefined;
  const levels = model && efforts && Object.hasOwn(efforts, model) ? efforts[model] : undefined;
  if (levels?.includes(configured)) return configured;
  warn(`llm.effort "${configured}"${taskClass ? ` for task class "${taskClass}"` : ""} was not sent: ` +
    `the selected Codex CLI does not advertise it for ${model || "the unspecified model"}. ` +
    (catalog.ok ? `Advertised efforts: ${levels?.join(", ") || "unavailable"}.` : catalog.reason));
  return undefined;
}

/** Serialize an effort already checked against the selected client's catalog. */
export function codexEffortFlags(effort: string | undefined): string[] {
  return effort === undefined ? [] : ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`];
}
