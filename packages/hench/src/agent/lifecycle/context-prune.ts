/**
 * Summarizing history prune for the agent tool loops.
 *
 * The loops used to splice the oldest turns straight out of the message array
 * once the history passed a fixed cap. Two things were wrong with that. The
 * dropped turns were the record of what had already been tried — files read,
 * commands run, approaches ruled out — so the agent would rediscover them,
 * paying again for work it had already done. And an arbitrary cut could orphan
 * a `tool_result` whose `tool_use` had just been removed, which the Messages
 * API rejects outright.
 *
 * This module replaces the dropped span with a single summary message produced
 * by the `context.summarize` task class (light tier — a mechanical, single-shot
 * digest with no reasoning demand). What was learned survives; only the verbose
 * form of it is discarded.
 *
 * The cut point is snapped forward to an assistant turn so the retained window
 * never opens on a tool result whose call is gone.
 *
 * A prune does reset the cached prefix from the cut onward — that is inherent,
 * the bytes genuinely changed. It is why the cap is high enough that pruning is
 * rare, and why `prompt-cache.ts` keeps a breakpoint on the first message,
 * which a prune never touches.
 *
 * @module hench/agent/lifecycle/context-prune
 */

import { loadLLMConfig, resolveLLMVendor } from "../../store/project-config.js";
import { defaultRegistry, resolveTaskModel } from "../../prd/llm-gateway.js";
import { detail } from "../../types/output.js";

/** Prefix marking a message as a digest of pruned turns, not a real user turn. */
export const PRUNE_SUMMARY_PREFIX = "[pruned history]";

/**
 * Characters of rendered history sent to the summarizer.
 *
 * The span being summarized can be very large. Past this bound the middle is
 * elided rather than the tail: the oldest turns set up the task and the newest
 * carry the current state, while the middle is the most redundant part.
 */
export const PRUNE_RENDER_CHAR_LIMIT = 60_000;

export interface PruneResult {
  /** How many messages were removed from the array. */
  pruned: number;
  /** Whether the removed span was replaced by a summary. */
  summarized: boolean;
}

const NOT_PRUNED: PruneResult = { pruned: 0, summarized: false };

export interface PruneOptions<T> {
  /** Total messages to retain, including the always-kept leading messages. */
  maxKeep: number;
  /**
   * Leading messages never pruned — the task brief, preceded by a system
   * message in the shapes that carry one inline. Defaults to 1.
   */
  keepPrefix?: number;
  /** Directory holding the LLM config used to resolve the summarizer. */
  henchDir: string;
  /** Render one message as plain text for the summarizer. */
  render: (message: T) => string;
  /** Wrap the summary text as a message of the caller's own shape. */
  makeSummaryMessage: (summary: string) => T;
  /**
   * Role name marking an assistant turn in this message shape — `"assistant"`
   * for Anthropic and OpenAI, `"model"` for Gemini. The retained window is
   * snapped to start on one.
   */
  assistantRole?: string;
}

/** Keep the head and tail of an over-long render, eliding the middle. */
function boundRender(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const half = Math.floor((limit - 80) / 2);
  const omitted = text.length - half * 2;
  return `${text.slice(0, half)}\n\n… ${omitted} characters of middle history elided …\n\n${text.slice(-half)}`;
}

function buildSummaryPrompt(rendered: string): string {
  return [
    "Digest the following span of an autonomous coding agent's transcript into a compact",
    "hand-off note. It replaces those turns verbatim, so anything you leave out is lost to",
    "the agent and it will redo that work.",
    "",
    "Record, as terse bullets under these headings, omitting a heading with nothing under it:",
    "- Files read or modified, with what was established about each",
    "- Commands run and their outcomes (passed, failed, and how)",
    "- Decisions made and approaches already ruled out, with the reason",
    "- Unresolved problems and what was about to be tried next",
    "",
    "Facts only. No preamble, no advice, no restating the task.",
    "",
    "--- transcript span ---",
    rendered,
  ].join("\n");
}

/**
 * Summarize a rendered span via the `context.summarize` light-tier route.
 *
 * Returns null on any failure. A prune must never be the thing that fails a
 * run, so the caller degrades to a plain drop instead.
 */
async function summarizeSpan(rendered: string, henchDir: string): Promise<string | null> {
  try {
    const llmConfig = await loadLLMConfig(henchDir);
    const vendor = resolveLLMVendor(llmConfig);
    const resolution = resolveTaskModel("context.summarize", llmConfig, { vendor });
    const provider = defaultRegistry.getActiveProvider(llmConfig);
    const { text } = await provider.complete({
      prompt: buildSummaryPrompt(boundRender(rendered, PRUNE_RENDER_CHAR_LIMIT)),
      model: resolution.model,
    });
    const summary = text?.trim();
    if (!summary) return null;
    detail(`Pruned history summarized with ${resolution.model} (${resolution.tier} tier)`);
    return summary;
  } catch {
    return null;
  }
}

/**
 * Prune a message history down to `maxKeep`, replacing what is removed with a
 * summary. Mutates `messages` in place.
 *
 * The leading `keepPrefix` messages are always retained: they carry the task
 * brief, and the first of them anchors the cache breakpoint that survives the
 * prune.
 */
export async function pruneWithSummary<T extends { role: string }>(
  messages: T[],
  opts: PruneOptions<T>,
): Promise<PruneResult> {
  const { maxKeep, henchDir, render, makeSummaryMessage } = opts;
  const assistantRole = opts.assistantRole ?? "assistant";
  const keepPrefix = opts.keepPrefix ?? 1;
  if (messages.length <= maxKeep) return NOT_PRUNED;

  // Retain the leading prefix plus the last (maxKeep - keepPrefix) messages;
  // the span between is what gets summarized away.
  let end = messages.length - (maxKeep - keepPrefix);

  // Snap forward to an assistant turn so the retained window cannot open on a
  // tool result whose originating tool call was just removed. Never advance
  // past the last message — there must always be a live tail to send.
  while (end < messages.length - 1 && messages[end].role !== assistantRole) end++;
  if (end <= keepPrefix) return NOT_PRUNED;

  const span = messages.slice(keepPrefix, end);
  const summary = await summarizeSpan(span.map(render).join("\n\n"), henchDir);

  if (summary) {
    messages.splice(
      keepPrefix,
      span.length,
      makeSummaryMessage(`${PRUNE_SUMMARY_PREFIX}\n${summary}`),
    );
    detail(`Pruned ${span.length} messages into a summary to stay within the context budget`);
    return { pruned: span.length, summarized: true };
  }

  messages.splice(keepPrefix, span.length);
  detail(`Pruned ${span.length} messages to stay within the context budget (no summary available)`);
  return { pruned: span.length, summarized: false };
}
