/**
 * Resolve execution/review effort rules. Claude uses the shared validator here;
 * Codex's caller must check the selected binary's model catalog before spawning.
 * API effort here is Claude-only: OpenAI requests use the llm-client provider.
 */

import {
  isModelCompatibleWithVendor,
  LLM_VENDOR,
  resolveClaudeApiEffort,
  resolveClaudeCliEffort,
  resolveTaskModel,
  type ClaudeEffort,
  type LLMConfig,
} from "../../prd/llm-gateway.js";

export function resolveAgentApiEffort(
  model: string,
  llmConfig: LLMConfig | undefined,
): ClaudeEffort | undefined {
  // Literal class name: tests/integration/task-class-registry.test.js finds
  // routed classes by scanning call sites for the string.
  const { effort } = resolveTaskModel("agent.execute", llmConfig);
  return resolveClaudeApiEffort(model, effort, "agent.execute");
}

/** Resolve a rule for execution or review; the Codex adapter validates its dialect. */
export function resolveAgentCliEffort(
  model: string | undefined,
  llmConfig: LLMConfig | undefined,
  taskClass = "agent.execute",
): string | undefined {
  const { effort } = resolveTaskModel(taskClass, llmConfig);
  if (model && isModelCompatibleWithVendor(LLM_VENDOR.CODEX, model)) return effort;
  if (!model || !isModelCompatibleWithVendor(LLM_VENDOR.CLAUDE, model)) return undefined;
  return resolveClaudeCliEffort(model, effort, taskClass);
}
