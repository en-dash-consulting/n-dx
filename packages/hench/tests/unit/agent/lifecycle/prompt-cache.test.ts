/**
 * Unit tests for prompt-cache breakpoint placement in the Anthropic agent loop.
 *
 * Without breakpoints the tool schemas and system prompt are re-sent at full
 * input price on every turn. These tests pin the two properties that make
 * caching actually pay: the system block carries a breakpoint (which covers
 * the tools rendered ahead of it), and the message array ends up with exactly
 * two — the brief and a rolling one on the newest user turn — however many
 * turns the loop has run.
 */

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  applyMessageCacheBreakpoints,
  buildCachedSystem,
} from "../../../../src/agent/lifecycle/prompt-cache.js";

/** Count blocks carrying a cache breakpoint across the whole array. */
function countBreakpoints(messages: Anthropic.MessageParam[]): number {
  let n = 0;
  for (const message of messages) {
    if (typeof message.content === "string") continue;
    for (const block of message.content as Array<{ cache_control?: unknown }>) {
      if (block.cache_control) n++;
    }
  }
  return n;
}

function indexOfBreakpoints(messages: Anthropic.MessageParam[]): number[] {
  const at: number[] = [];
  messages.forEach((message, i) => {
    if (typeof message.content === "string") return;
    const blocks = message.content as Array<{ cache_control?: unknown }>;
    if (blocks.some((b) => b.cache_control)) at.push(i);
  });
  return at;
}

describe("buildCachedSystem", () => {
  it("wraps the system prompt in a cached text block", () => {
    const system = buildCachedSystem("You are an agent.");
    expect(system).toEqual([
      { type: "text", text: "You are an agent.", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("returns undefined for an absent or empty prompt so system can be omitted", () => {
    expect(buildCachedSystem(undefined)).toBeUndefined();
    expect(buildCachedSystem("")).toBeUndefined();
  });
});

describe("applyMessageCacheBreakpoints", () => {
  it("marks the brief and the most recent user turn", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "brief" },
      { role: "assistant", content: [{ type: "text", text: "thinking" }] },
      { role: "user", content: [{ type: "text", text: "tool result" }] },
    ];

    expect(applyMessageCacheBreakpoints(messages)).toBe(2);
    expect(indexOfBreakpoints(messages)).toEqual([0, 2]);
  });

  it("promotes string content to a text block so there is somewhere to mark", () => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "brief" }];

    applyMessageCacheBreakpoints(messages);

    expect(messages[0].content).toEqual([
      { type: "text", text: "brief", cache_control: { type: "ephemeral" } },
    ]);
  });

  it("marks the last block of a multi-block turn, not the first", () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: "brief" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      {
        role: "user",
        content: [
          { type: "text", text: "first" },
          { type: "text", text: "last" },
        ],
      },
    ];

    applyMessageCacheBreakpoints(messages);

    const blocks = messages[2].content as Array<{ text?: string; cache_control?: unknown }>;
    expect(blocks[0].cache_control).toBeUndefined();
    expect(blocks[1].cache_control).toEqual({ type: "ephemeral" });
  });

  it("stays at two breakpoints as the conversation grows", () => {
    // The API allows four per request. A marker left behind on every turn
    // would blow past that within three turns of a real run.
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "brief" }];
    applyMessageCacheBreakpoints(messages);

    for (let turn = 0; turn < 12; turn++) {
      messages.push({ role: "assistant", content: [{ type: "text", text: `turn ${turn}` }] });
      messages.push({ role: "user", content: [{ type: "text", text: `result ${turn}` }] });
      applyMessageCacheBreakpoints(messages);
      expect(countBreakpoints(messages)).toBe(2);
    }

    // The rolling breakpoint tracks the newest user turn.
    expect(indexOfBreakpoints(messages)).toEqual([0, messages.length - 1]);
  });

  it("leaves a single-message history with one breakpoint", () => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: "brief" }];
    expect(applyMessageCacheBreakpoints(messages)).toBe(1);
  });

  it("handles an empty history without throwing", () => {
    expect(applyMessageCacheBreakpoints([])).toBe(0);
  });
});
