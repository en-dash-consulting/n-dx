/**
 * hench's Claude API turn loop builds its own Anthropic request, so it must
 * send the same `output_config.effort` the llm-client API provider sends for
 * the same model and config. Both sides are driven here and compared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
    models = { list: vi.fn() };
  },
}));

import { createApiClient, resetClaudeEffortWarnings } from "@n-dx/llm-client";
import type { LLMConfig } from "@n-dx/llm-client";
import { resolveTaskModel } from "../../../../src/prd/llm-gateway.js";
import { resolveAgentApiEffort } from "../../../../src/agent/lifecycle/api-effort.js";
import { buildCachedMessageRequest } from "../../../../src/agent/lifecycle/prompt-cache.js";

const CASES: Array<{ name: string; model: string; config: LLMConfig }> = [
  { name: "opus 5.5 default", model: "claude-opus-5-5", config: {} },
  { name: "sonnet 5.5 default", model: "claude-sonnet-5-5", config: {} },
  { name: "agent rule", model: "claude-sonnet-5-5", config: { effort: { "agent.*": "xhigh" } } },
  { name: "rule on opus 5.5", model: "claude-opus-5-5", config: { effort: { "*": "low" } } },
  { name: "haiku drops rule", model: "claude-haiku-4-5", config: { effort: { "*": "max" } } },
  { name: "invalid rule", model: "claude-sonnet-5-5", config: { effort: { "agent.execute": "lots" } } },
];

function agentRequest(model: string, config: LLMConfig) {
  return buildCachedMessageRequest({
    model,
    maxTokens: 1024,
    systemPrompt: "system",
    tools: [],
    messages: [{ role: "user", content: "brief" }],
    effort: resolveAgentApiEffort(model, config),
  });
}

async function providerRequest(model: string, config: LLMConfig) {
  const { effort } = resolveTaskModel("agent.execute", config);
  const client = createApiClient({ claudeConfig: { api_key: "sk-ant-test" } });
  await client.complete({ prompt: "brief", model, effort, taskClass: "agent.execute" });
  return create.mock.calls.at(-1)![0];
}

describe("hench API loop effort parity with the llm-client provider", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({ content: [], usage: { input_tokens: 1, output_tokens: 1 } });
    resetClaudeEffortWarnings();
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => stderr.mockRestore());

  for (const { name, model, config } of CASES) {
    it(`sends the same output_config: ${name}`, async () => {
      const provider = await providerRequest(model, config);
      const agent = agentRequest(model, config);
      expect(agent.output_config).toEqual(provider.output_config);
    });
  }

  it("sends high on Opus 5.5 and nothing on Haiku", () => {
    expect(agentRequest("claude-opus-5-5", {}).output_config).toEqual({ effort: "high" });
    expect(agentRequest("claude-haiku-4-5", { effort: { "*": "max" } })).not.toHaveProperty("output_config");
  });

  it("keeps effort when prompt caching is off", () => {
    const params = buildCachedMessageRequest({
      model: "claude-opus-5-5",
      maxTokens: 1024,
      systemPrompt: "system",
      tools: [],
      messages: [],
      promptCache: false,
      effort: "high",
    });
    expect(params.output_config).toEqual({ effort: "high" });
  });
});
