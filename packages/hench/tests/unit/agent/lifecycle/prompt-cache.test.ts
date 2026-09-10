/**
 * Prompt-cache breakpoint placement for the Anthropic API agent loop.
 *
 * The load-bearing assertion is "prefix bytes are reused": turn N+1's request
 * must repeat turn N's stable prefix and message history verbatim, or the cache
 * read misses and the caching is worthless.
 */

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildCachedMessageRequest,
  buildCachedSystem,
  buildCachedTools,
  withTrailingCacheBreakpoint,
} from "../../../../src/agent/lifecycle/prompt-cache.js";
import type { AnthropicToolDef } from "../../../../src/prd/llm-gateway.js";

const TOOLS: AnthropicToolDef[] = [
  {
    name: "read_file",
    description: "Read a file.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "write_file",
    description: "Write a file.",
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

const SYSTEM = "You are an autonomous engineer.";
const BRIEF = "Implement the task described below.";

/** Count `cache_control` markers anywhere in a request body. */
function countBreakpoints(params: Anthropic.MessageCreateParamsNonStreaming): number {
  return JSON.stringify(params).split('"cache_control"').length - 1;
}

/** Strip every `cache_control` marker so two requests' content can be compared. */
function withoutMarkers(value: unknown): string {
  return JSON.stringify(value, (key, val) => (key === "cache_control" ? undefined : val));
}

function build(messages: Anthropic.MessageParam[]) {
  return buildCachedMessageRequest({
    model: "claude-sonnet-4-6",
    maxTokens: 4096,
    systemPrompt: SYSTEM,
    tools: TOOLS,
    messages,
  });
}

describe("buildCachedSystem", () => {
  it("marks the system block as an ephemeral cache breakpoint", () => {
    const system = buildCachedSystem(SYSTEM);

    expect(system).toEqual([
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ]);
  });

  it("omits the system field when there is no prompt", () => {
    expect(buildCachedSystem(undefined)).toBeUndefined();
    expect(buildCachedSystem("")).toBeUndefined();
  });
});

describe("buildCachedTools", () => {
  it("leaves tools unmarked when the system block carries the prefix breakpoint", () => {
    const tools = buildCachedTools(TOOLS, false);

    expect(withoutMarkers(tools)).toBe(JSON.stringify(TOOLS));
    expect(JSON.stringify(tools)).not.toContain("cache_control");
  });

  it("marks the last tool when there is no system block to carry the breakpoint", () => {
    const tools = buildCachedTools(TOOLS, true);

    expect(tools[0]).not.toHaveProperty("cache_control");
    expect(tools[1]).toHaveProperty("cache_control", { type: "ephemeral" });
  });

  it("does not mutate the caller's tool definitions", () => {
    const snapshot = JSON.stringify(TOOLS);
    buildCachedTools(TOOLS, true);

    expect(JSON.stringify(TOOLS)).toBe(snapshot);
  });
});

describe("withTrailingCacheBreakpoint", () => {
  it("marks the trailing text block and normalizes string content", () => {
    const marked = withTrailingCacheBreakpoint([{ role: "user", content: BRIEF }]);

    expect(marked).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: BRIEF, cache_control: { type: "ephemeral" } }],
      },
    ]);
  });

  it("marks the last tool_result block of a tool-result turn", () => {
    const marked = withTrailingCacheBreakpoint([
      { role: "user", content: BRIEF },
      { role: "assistant", content: [{ type: "text", text: "working" }] },
      {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "a", content: "first" },
          { type: "tool_result", tool_use_id: "b", content: "second" },
        ],
      },
    ]);

    const blocks = marked[2].content as Anthropic.ContentBlockParam[];
    expect(blocks[0]).not.toHaveProperty("cache_control");
    expect(blocks[1]).toHaveProperty("cache_control", { type: "ephemeral" });
  });

  it("skips uncacheable trailing blocks and marks the last cacheable one", () => {
    const marked = withTrailingCacheBreakpoint([
      {
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          { type: "thinking", thinking: "reasoning", signature: "sig" },
        ],
      },
    ]);

    const blocks = marked[0].content as Anthropic.ContentBlockParam[];
    expect(blocks[0]).toHaveProperty("cache_control", { type: "ephemeral" });
    expect(blocks[1]).not.toHaveProperty("cache_control");
  });

  it("does not mutate the caller's conversation", () => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: BRIEF }];
    withTrailingCacheBreakpoint(messages);

    expect(messages).toEqual([{ role: "user", content: BRIEF }]);
  });

  it("returns an empty array unchanged", () => {
    expect(withTrailingCacheBreakpoint([])).toEqual([]);
  });
});

describe("buildCachedMessageRequest", () => {
  it("carries exactly two breakpoints: the stable prefix and the trailing turn", () => {
    const params = build([{ role: "user", content: BRIEF }]);

    expect(countBreakpoints(params)).toBe(2);
    expect(params.system).toEqual([
      { type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } },
    ]);
    const trailing = params.messages[0].content as Anthropic.ContentBlockParam[];
    expect(trailing[0]).toHaveProperty("cache_control", { type: "ephemeral" });
  });

  it("passes model and max_tokens through", () => {
    const params = build([{ role: "user", content: BRIEF }]);

    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.max_tokens).toBe(4096);
  });

  it("reuses the same prefix bytes on the next turn", () => {
    // Turn 1: brief only.
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: BRIEF }];
    const turn1 = build(messages);

    // The loop appends the assistant reply and the tool results, then re-sends.
    messages.push({ role: "assistant", content: [{ type: "text", text: "reading" }] });
    messages.push({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "a", content: "file body" }],
    });
    const turn2 = build(messages);

    // The stable prefix is byte-identical, markers included.
    expect(JSON.stringify(turn2.system)).toBe(JSON.stringify(turn1.system));
    expect(JSON.stringify(turn2.tools)).toBe(JSON.stringify(turn1.tools));

    // Turn 1's conversation is repeated verbatim as the head of turn 2's, so the
    // cache entry written at turn 1's boundary is what turn 2 reads back.
    const head = turn2.messages.slice(0, turn1.messages.length);
    expect(withoutMarkers(head)).toBe(withoutMarkers(turn1.messages));

    // The trailing breakpoint moved forward rather than accumulating.
    expect(countBreakpoints(turn2)).toBe(2);
    const oldTrailing = head[0].content as Anthropic.ContentBlockParam[];
    expect(oldTrailing[0]).not.toHaveProperty("cache_control");
    const newTrailing = turn2.messages[2].content as Anthropic.ContentBlockParam[];
    expect(newTrailing[0]).toHaveProperty("cache_control", { type: "ephemeral" });
  });

  it("falls back to a tools breakpoint when there is no system prompt", () => {
    const params = buildCachedMessageRequest({
      model: "claude-sonnet-4-6",
      maxTokens: 4096,
      systemPrompt: undefined,
      tools: TOOLS,
      messages: [{ role: "user", content: BRIEF }],
    });

    expect(params.system).toBeUndefined();
    expect(params.tools?.[1]).toHaveProperty("cache_control", { type: "ephemeral" });
    expect(countBreakpoints(params)).toBe(2);
  });
});
