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

/**
 * The `--effort` level a Claude Code spawn should carry, or undefined to pass
 * no flag.
 *
 * Only meaningful for the Claude CLI: other vendors' adapters ignore
 * `VendorSpawnOptions.effort`.
 *
 * A non-Claude model returns before the allowlist is consulted, because that
 * check does not merely drop the value — it warns that the model "does not
 * accept an effort setting". That reads as a misconfiguration, and on a Codex
 * project with `llm.effort` set it fired on every run, where before this path
 * existed nothing was sent and nothing was printed. `llm.effort` is a Claude
 * setting; a Codex model is not failing to honour it, it is simply not its
 * audience. A Claude model that cannot take effort still warns, which is the
 * case the warning is for.
 */
export function resolveAgentCliEffort(
  model: string | undefined,
  llmConfig: LLMConfig | undefined,
): ClaudeEffort | undefined {
  if (!model) return undefined;
  if (!isModelCompatibleWithVendor(LLM_VENDOR.CLAUDE, model)) return undefined;
  // Literal class name: tests/integration/task-class-registry.test.js finds
  // routed classes by scanning call sites for the string.
  const { effort } = resolveTaskModel("agent.execute", llmConfig);
  return resolveClaudeCliEffort(model, effort, "agent.execute");
}
