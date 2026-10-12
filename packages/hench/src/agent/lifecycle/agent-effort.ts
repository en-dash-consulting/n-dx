/**
 * Effort for hench's own agent loops.
 *
 * Both loops build their vendor call themselves rather than going through an
 * llm-client provider — the API loop assembles its own Anthropic request, and
 * the CLI loop assembles its own `claude` argv — so each resolves effort here
 * against the same `llm.effort` rule for the `agent.execute` class.
 *
 * The two differ in one respect, which is llm-client's rule rather than
 * hench's: the API path applies a per-model default when no rule matches
 * (Opus 5.5 → high), and the CLI path does not, because Claude Code picks its
 * own default. See `resolveClaudeCliEffort`.
 */

import {
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

/**
 * The `--effort` level a Claude Code spawn should carry, or undefined to pass
 * no flag.
 *
 * Only meaningful for the Claude CLI: other vendors' adapters ignore
 * `VendorSpawnOptions.effort`, and the model allowlist inside
 * `resolveClaudeCliEffort` drops a value aimed at a model that cannot take
 * one, so a Codex or Gemini model id resolves to nothing here.
 */
export function resolveAgentCliEffort(
  model: string | undefined,
  llmConfig: LLMConfig | undefined,
): ClaudeEffort | undefined {
  if (!model) return undefined;
  // Literal class name: tests/integration/task-class-registry.test.js finds
  // routed classes by scanning call sites for the string.
  const { effort } = resolveTaskModel("agent.execute", llmConfig);
  return resolveClaudeCliEffort(model, effort, "agent.execute");
}
