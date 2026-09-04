/**
 * Prompt-cache breakpoint placement for the Anthropic agent loop.
 *
 * The Messages API renders a request as `tools` → `system` → `messages` and
 * caches by exact prefix match, so a breakpoint on the last system block
 * covers the tool definitions too. Without any breakpoint the whole prefix —
 * every tool schema and the full system prompt — is re-sent at full input
 * price on every turn of the loop, which is where most of a long run's input
 * spend goes.
 *
 * Two breakpoints are placed, well inside the API's limit of four:
 *
 *  - **system** — tools plus the system prompt. Byte-identical for the life of
 *    a run, so it is written once and read on every subsequent turn.
 *  - **rolling** — the last content block of the most recent user turn, so each
 *    turn extends the previous turn's cached prefix instead of re-reading it.
 *
 * A third breakpoint sits on the first message (the task brief). It is the one
 * point in the history that {@link pruneWithSummary} never removes, so it keeps
 * serving reads even on the turn after a prune has reset the tail.
 *
 * Marker placement is not part of the cached bytes: moving the rolling
 * breakpoint forward does not invalidate the entry written at its previous
 * position, which stays readable for its TTL. Only a change to the *content*
 * of the prefix invalidates.
 *
 * @module hench/agent/lifecycle/prompt-cache
 */

import type Anthropic from "@anthropic-ai/sdk";

/** Ephemeral (5-minute TTL) cache breakpoint. */
export const EPHEMERAL_CACHE_CONTROL = { type: "ephemeral" } as const;

/** A content block that may carry a cache breakpoint. */
type CacheableBlock = { cache_control?: { type: "ephemeral" } | null };

/**
 * Render the system prompt as a single cached text block.
 *
 * A bare string and a one-element text block render to the same bytes, so
 * wrapping changes nothing about the prefix — it only creates somewhere to
 * hang the breakpoint. Returns `undefined` for an absent or empty prompt so
 * the caller can omit `system` entirely rather than send an empty block.
 */
export function buildCachedSystem(
  systemPrompt: string | undefined,
): Anthropic.TextBlockParam[] | undefined {
  if (!systemPrompt) return undefined;
  return [{ type: "text", text: systemPrompt, cache_control: { ...EPHEMERAL_CACHE_CONTROL } }];
}

/** Strip any breakpoint from every block of a message. */
function clearBreakpoints(message: Anthropic.MessageParam): void {
  if (typeof message.content === "string") return;
  for (const block of message.content as CacheableBlock[]) {
    if (block.cache_control) delete block.cache_control;
  }
}

/**
 * Put a breakpoint on a message's last content block, promoting string content
 * to a single text block so there is a block to mark. Returns false when the
 * message has no block to mark (empty content array).
 */
function markLastBlock(message: Anthropic.MessageParam): boolean {
  if (typeof message.content === "string") {
    message.content = [
      { type: "text", text: message.content, cache_control: { ...EPHEMERAL_CACHE_CONTROL } },
    ];
    return true;
  }
  const blocks = message.content as CacheableBlock[];
  const last = blocks[blocks.length - 1];
  if (!last) return false;
  last.cache_control = { ...EPHEMERAL_CACHE_CONTROL };
  return true;
}

/**
 * Place the message-array breakpoints for one request, in place.
 *
 * Existing markers are cleared first so repeated calls across a loop leave at
 * most two breakpoints in `messages` — the brief and the rolling one — rather
 * than accumulating one per turn and tripping the four-breakpoint limit.
 *
 * @returns how many breakpoints ended up in the message array.
 */
export function applyMessageCacheBreakpoints(messages: Anthropic.MessageParam[]): number {
  if (messages.length === 0) return 0;
  for (const message of messages) clearBreakpoints(message);

  let placed = 0;
  if (markLastBlock(messages[0])) placed++;

  // Rolling breakpoint: the most recent user turn. In a tool loop that is the
  // tool_result message just appended, so the next request reads everything up
  // to and including the results of the turn before it.
  for (let i = messages.length - 1; i >= 1; i--) {
    if (messages[i].role !== "user") continue;
    if (markLastBlock(messages[i])) placed++;
    break;
  }
  return placed;
}
