import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create };
    models = { list: vi.fn() };
  },
}));

import { createApiClient } from "../../src/api-provider.js";
import { resolveTaskModel } from "../../src/config.js";
import {
  CLAUDE_DEFAULT_EFFORT,
  EFFORT_CAPABLE_CLAUDE_MODELS,
  resetClaudeEffortWarnings,
  resolveClaudeApiEffort,
  supportsClaudeEffort,
} from "../../src/claude-effort.js";
import type { LLMConfig } from "../../src/llm-types.js";

const RESPONSE = { content: [{ type: "text", text: "ok" }], usage: { input_tokens: 1, output_tokens: 1 } };

/** Send one completion for a task class and return the params the SDK got. */
async function sentParams(taskClass: string, config: LLMConfig, model?: string) {
  const resolution = resolveTaskModel(taskClass, config, { model });
  const client = createApiClient({ claudeConfig: { api_key: "sk-ant-test" } });
  await client.complete({
    prompt: "hi",
    model: resolution.model,
    effort: resolution.effort,
    taskClass,
  });
  return create.mock.calls.at(-1)![0];
}

describe("Claude API effort", () => {
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(RESPONSE);
    resetClaudeEffortWarnings();
    stderr = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    stderr.mockRestore();
  });

  it("sends a matching llm.effort rule on an effort-capable model", async () => {
    const params = await sentParams("prd.smart-add", { effort: { "prd.*": "low" } });
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.output_config).toEqual({ effort: "low" });
  });

  it("sends high on claude-opus-5-5 when no rule matches", async () => {
    const params = await sentParams("prd.smart-add", {}, "claude-opus-5-5");
    expect(params.output_config).toEqual({ effort: "high" });
  });

  it("sends no output_config on claude-sonnet-5-5 when no rule matches", async () => {
    const params = await sentParams("prd.smart-add", {}, "claude-sonnet-5-5");
    expect(params).not.toHaveProperty("output_config");
  });

  it("never sends effort to claude-haiku-4-5, and warns naming class and model", async () => {
    const params = await sentParams("code.classify", { effort: { "*": "max" } });
    expect(params.model).toBe("claude-haiku-4-5");
    expect(params).not.toHaveProperty("output_config");
    expect(stderr).toHaveBeenCalledTimes(1);
    const message = String(stderr.mock.calls[0][0]);
    expect(message).toContain('"code.classify"');
    expect(message).toContain("claude-haiku-4-5");
  });

  it("drops an invalid llm.effort value with a warning", async () => {
    const params = await sentParams("prd.smart-add", { effort: { "prd.*": "extreme" } });
    expect(params).not.toHaveProperty("output_config");
    expect(String(stderr.mock.calls[0][0])).toContain('"extreme"');
  });

  it("warns once for repeated calls with the same dropped value", async () => {
    await sentParams("code.classify", { effort: { "*": "low" } });
    await sentParams("code.classify", { effort: { "*": "low" } });
    expect(stderr).toHaveBeenCalledTimes(1);
  });
});

describe("resolveClaudeApiEffort", () => {
  beforeEach(() => resetClaudeEffortWarnings());

  it("matches dated snapshots of capable models", () => {
    expect(supportsClaudeEffort("claude-opus-4-7-20260115")).toBe(true);
    expect(supportsClaudeEffort("claude-haiku-4-5-20251001")).toBe(false);
    expect(resolveClaudeApiEffort("claude-opus-5-5-20260930", undefined)).toBe("high");
  });

  it("falls back to the model default when the configured value is invalid", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(resolveClaudeApiEffort("claude-opus-5-5", "turbo")).toBe("high");
  });

  it("only defaults models that accept effort", () => {
    for (const model of Object.keys(CLAUDE_DEFAULT_EFFORT)) {
      expect(EFFORT_CAPABLE_CLAUDE_MODELS).toContain(model);
    }
  });
});
