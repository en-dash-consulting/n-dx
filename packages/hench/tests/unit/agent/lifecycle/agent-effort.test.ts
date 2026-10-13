/**
 * hench's Claude API turn loop builds its own Anthropic request, so it must
 * send the same `output_config.effort` the llm-client API provider sends for
 * the same model and config. Both sides are driven here and compared.
 *
 * The CLI loop builds its own argv for the same reason, and is held to the
 * same validation — minus the per-model default, which belongs to the API.
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
import { resolveAgentApiEffort, resolveAgentCliEffort } from "../../../../src/agent/lifecycle/agent-effort.js";
import { buildClaudeCliArgs } from "../../../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
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

describe("hench CLI loop effort", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    resetClaudeEffortWarnings();
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => stderr.mockRestore());

  it("passes a matching rule through", () => {
    expect(resolveAgentCliEffort("claude-opus-5-5", { effort: { "agent.*": "xhigh" } })).toBe(
      "xhigh",
    );
  });

  it("applies no default when no rule matches, unlike the API path", () => {
    // Claude Code picks its own per-model default. Sending ours unasked would
    // override that on every run nobody configured.
    expect(resolveAgentCliEffort("claude-opus-5-5", {})).toBeUndefined();
    expect(resolveAgentApiEffort("claude-opus-5-5", {})).toBe("high");
  });

  it("drops an invalid level with the same warning as the API path", () => {
    expect(
      resolveAgentCliEffort("claude-sonnet-5-5", { effort: { "agent.execute": "lots" } }),
    ).toBeUndefined();
    expect(stderr.mock.calls.flat().join(" ")).toContain('"lots"');
  });

  it("drops a rule aimed at a model that does not accept effort", () => {
    expect(resolveAgentCliEffort("claude-haiku-4-5", { effort: { "*": "max" } })).toBeUndefined();
    expect(stderr.mock.calls.flat().join(" ")).toContain("does not accept an effort setting");
  });

  it("resolves to nothing for a non-Claude model id, and says nothing about it", () => {
    // The silence is the point, and is what the returned undefined alone does
    // not pin: the allowlist check warns that the model "does not accept an
    // effort setting", which on a Codex project with llm.effort set fired on
    // every run. llm.effort is a Claude setting, and a Codex model is not
    // failing to honour it. The Claude-model case above still warns.
    expect(resolveAgentCliEffort("gpt-5-codex", { effort: { "*": "high" } })).toBeUndefined();
    expect(stderr.mock.calls.flat().join(" ")).not.toContain("does not accept an effort setting");
  });

  it("resolves to nothing when no model was given", () => {
    expect(resolveAgentCliEffort(undefined, { effort: { "*": "high" } })).toBeUndefined();
  });
});

describe("buildClaudeCliArgs --effort", () => {
  const base = {
    systemPrompt: "system",
    promptText: "brief",
    allowedTools: ["Read"],
  };

  it("emits --effort <level> when one was resolved", () => {
    const { args } = buildClaudeCliArgs({ ...base, effort: "xhigh" }, "linux");
    expect(args).toContain("--effort");
    expect(args[args.indexOf("--effort") + 1]).toBe("xhigh");
  });

  it("emits no --effort at all when none was resolved", () => {
    const { args } = buildClaudeCliArgs(base, "linux");
    expect(args).not.toContain("--effort");
  });

  it("emits it on Windows too, where the system prompt moves to stdin", () => {
    const { args } = buildClaudeCliArgs({ ...base, effort: "high" }, "win32");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
  });

  it("sits after --model, so neither shadows the other", () => {
    const { args } = buildClaudeCliArgs(
      { ...base, modelOverride: "claude-opus-5-5", effort: "low" },
      "linux",
    );
    expect(args.indexOf("--model")).toBeLessThan(args.indexOf("--effort"));
  });
});
