/**
 * Anthropic prompt-cache breakpoint placement for the API agent loop.
 *
 * The API loop re-sends the system prompt, every tool definition and the whole
 * conversation on every turn. Without `cache_control` markers the entire prompt
 * is billed at full input rate each time, which for a 20-turn run means the
 * stable prefix is paid for 20 times.
 *
 * Two ephemeral breakpoints fix that:
 *
 * 1. **Stable prefix** — a marker on the system block. Anthropic orders the
 *    cacheable prompt as `tools` → `system` → `messages`, and a breakpoint
 *    caches everything from the start of the prompt up to and including the
 *    marked block. A single marker on the system block therefore covers the
 *    tool definitions as well; a second marker on the tools would consume one
 *    of the four available breakpoints for no gain. When there is no system
 *    prompt the marker moves to the last tool so the tool block is still cached.
 * 2. **Trailing conversation boundary** — a marker on the last block of the last
 *    message. Each turn writes a cache entry covering the whole conversation so
 *    far, and the following turn reads the longest matching cached prefix rather
 *    than re-sending it. This is Anthropic's documented incremental-conversation
 *    pattern: the breakpoint moves forward each turn.
 *
 * Callers pass their own conversation array untouched — every function here is
 * copy-on-write. That matters for two reasons: the run's message history stays
 * free of transport-level markers, and the bytes of already-sent messages never
 * change, which is what makes the next turn's cache read hit.
 *
 * This module is Anthropic-only. The Gemini, OpenAI-compatible and CLI paths in
 * `loop.ts` / `cli-loop.ts` do not call into it.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { AnthropicToolDef } from "../../prd/llm-gateway.js";

/**
 * A fresh ephemeral `cache_control` marker.
 *
 * Returned per call rather than shared so no two blocks alias one object.
 */
function ephemeral(): Anthropic.CacheControlEphemeral {
  return { type: "ephemeral" };
}

/** Inputs needed to build one cached Anthropic request. */
export interface CachedRequestInput {
  model: string;
  /** Response token ceiling (`config.maxTokens`). */
  maxTokens: number;
  /** System prompt; an empty or absent prompt moves the prefix marker to the tools. */
  systemPrompt: string | undefined;
  tools: readonly AnthropicToolDef[];
  /** Conversation so far. Never mutated. */
  messages: readonly Anthropic.MessageParam[];
}

/**
 * Build the system field carrying the stable-prefix breakpoint.
 *
 * Returns `undefined` for an absent or empty prompt so the request omits the
 * field entirely rather than sending an empty block.
 */
export function buildCachedSystem(
  systemPrompt: string | undefined,
): Anthropic.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;
  return [{ type: "text", text: systemPrompt, cache_control: ephemeral() }];
}

/**
 * Copy the tool definitions, optionally marking the last one.
 *
 * `markLast` is only set when there is no system block to carry the
 * stable-prefix breakpoint — see the module header.
 */
export function buildCachedTools(
  tools: readonly AnthropicToolDef[],
  markLast: boolean,
): Anthropic.ToolUnion[] {
  const copied: Anthropic.ToolUnion[] = [...tools];
  if (!markLast || copied.length === 0) return copied;

  const lastIndex = copied.length - 1;
  copied[lastIndex] = { ...tools[lastIndex], cache_control: ephemeral() };
  return copied;
}

/**
 * Normalize string content to a single text block.
 *
 * This is what keeps the cache prefix byte-stable, and it is the reason the
 * normalization applies to *every* message rather than only the marked one.
 * `content: "text"` and `content: [{ type: "text", text: "text" }]` are the same
 * prompt, but they are not the same bytes. If only the trailing message were
 * expanded into block form, then on the next turn — when that message is no
 * longer the trailing one — it would revert to its string form, the prefix would
 * differ from what was cached, and the read would miss. Expanding all of them
 * means a message's serialized shape never changes once it has been sent, so
 * each turn genuinely extends the previous turn's cached prefix.
 *
 * An empty string is left alone: the API rejects empty text blocks.
 */
function normalizeContent(
  message: Anthropic.MessageParam,
): Anthropic.MessageParam {
  if (typeof message.content !== "string" || message.content.length === 0) {
    return message;
  }
  return {
    role: message.role,
    content: [{ type: "text", text: message.content }],
  };
}

/**
 * Copy the conversation with a cache breakpoint on the trailing boundary.
 *
 * The marker goes on the last cacheable block of the last message. Hench only
 * ever ends a request with a user message whose content is either the brief /
 * reminder text or an array of tool results, so `text` and `tool_result` are the
 * shapes handled here. Anything else (notably `thinking` blocks, which the API
 * rejects a `cache_control` on) is left unmarked: the stable-prefix breakpoint
 * still applies, so the worst case is the pre-caching cost, not an API error.
 */
export function withTrailingCacheBreakpoint(
  messages: readonly Anthropic.MessageParam[],
): Anthropic.MessageParam[] {
  const copied = messages.map(normalizeContent);
  if (copied.length === 0) return copied;

  const lastIndex = copied.length - 1;
  const last = copied[lastIndex];
  if (typeof last.content === "string") return copied;

  const blocks = [...last.content];
  for (let i = blocks.length - 1; i >= 0; i--) {
    const block = blocks[i];
    if (block.type === "text") {
      blocks[i] = { ...block, cache_control: ephemeral() };
    } else if (block.type === "tool_result") {
      blocks[i] = { ...block, cache_control: ephemeral() };
    } else {
      continue;
    }
    copied[lastIndex] = { role: last.role, content: blocks };
    return copied;
  }

  return copied;
}

/**
 * Assemble a non-streaming Anthropic request with both cache breakpoints.
 *
 * The returned object is what `client.messages.create` is called with; the
 * caller's `tools` and `messages` inputs are left untouched.
 */
export function buildCachedMessageRequest(
  input: CachedRequestInput,
): Anthropic.MessageCreateParamsNonStreaming {
  const system = buildCachedSystem(input.systemPrompt);

  const params: Anthropic.MessageCreateParamsNonStreaming = {
    model: input.model,
    max_tokens: input.maxTokens,
    tools: buildCachedTools(input.tools, system === undefined),
    messages: withTrailingCacheBreakpoint(input.messages),
  };
  if (system !== undefined) params.system = system;

  return params;
}
