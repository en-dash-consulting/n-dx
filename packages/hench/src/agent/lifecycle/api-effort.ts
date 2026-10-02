/**
 * Effort for hench's Claude Messages API turn loop.
 *
 * The agent loop builds its own Anthropic requests instead of going through
 * the llm-client API provider, so it resolves effort here with the same
 * `resolveClaudeApiEffort` rule: `llm.effort` for the `agent.execute` class,
 * validated against the model, else the model's default (Opus 5.5 → high).
 */

import {
  resolveClaudeApiEffort,
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
