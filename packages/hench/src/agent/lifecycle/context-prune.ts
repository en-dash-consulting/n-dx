/**
 * Summarizing conversation prune for the hench agent loops.
 *
 * ## What was wrong with splicing from the front
 *
 * Every agent loop used to prune with `messages.splice(head, n)` — drop the
 * oldest turns, keep the newest, no record of what left. That is wrong twice
 * over.
 *
 * 1. **It destroys the prompt cache.** Anthropic caches a *prefix*: turn N+1
 *    reads the longest byte-identical prefix of turn N's prompt. The old prune
 *    fired on every turn once the conversation crossed the threshold (each turn
 *    adds two messages, so each turn dropped two), so every request had a
 *    different prefix from the one before it and every cache read missed. The
 *    breakpoints placed by `prompt-cache.ts` bought nothing after turn 20.
 * 2. **It loses information silently.** The dropped turns hold the run's only
 *    record of which files were touched, which commands failed, and what was
 *    ruled out. Dropping them makes the agent re-derive facts it already knew,
 *    which costs more tokens than keeping a summary would have.
 *
 * ## What this does instead
 *
 * The array is treated as three regions:
 *
 * ```
 *   [ head ][ summaries ][ live tail ]
 *     ^        ^            ^
 *     |        |            recent turns, verbatim
 *     |        one or two messages per prune, append-only
 *     system prompt / task brief — never touched
 * ```
 *
 * A prune replaces the span between the summaries and the retained tail with
 * the summary, appended to the summary region. Nothing already in
 * the head or the summary region is ever rewritten or moved, so the prefix the
 * provider cached stays byte-identical across turns — that is why summaries
 * accumulate rather than being re-summarized into a single rolling message: a
 * rolling message would have to be rewritten on every prune, mutating the
 * cached prefix and defeating the whole exercise. Each summary is capped
 * ({@link SUMMARY_CHAR_LIMIT}) and a run's turn cap bounds how many there can
 * be, so the region stays small.
 *
 * Pruning is also *batched*: it triggers at the same threshold as before
 * ({@link PRUNE_TRIGGER_PAIRS}) but cuts back to {@link PRUNE_RETAIN_PAIRS},
 * so it fires roughly once every ten turns instead of every turn. Peak context
 * is unchanged; between prunes the prompt grows by pure append, which is
 * exactly the shape the cache rewards.
 *
 * The retained tail is the one region a prune may rewrite, and it does: editing
 * the middle of the history invalidates any signature in the tail that was
 * bound to the old prefix, so a shape may supply
 * {@link PruneShape.sanitizeRetained} to repair it. Anthropic's preserved
 * thinking is the case that forces this — see that field.
 *
 * The summary itself is a mechanical, single-shot, machine-checked call, so it
 * routes through the `context.summarize` task class (light tier by default).
 * If it fails — no credentials, provider down, empty answer — the prune
 * degrades to the old drop behavior. A prune is a context-window necessity;
 * losing the summary must not lose the run.
 *
 * This module is vendor-neutral: {@link ConversationPruner} is generic over the
 * message type and each loop supplies a {@link PruneShape} describing its own
 * message format. The Anthropic shape lives here because its type is a package
 * import; the OpenAI-compatible and Gemini shapes live beside their message
 * types in `loop.ts`.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { isLLMVendor, resolveTaskModel } from "../../prd/llm-gateway.js";
import type { LLMConfig, LLMProvider } from "../../prd/llm-gateway.js";
import type { TokenUsage } from "../../schema/index.js";
import { detail } from "../../types/output.js";

/**
 * Turn-pairs tolerated before a prune fires. Unchanged from the pre-summary
 * prune so peak context does not grow.
 */
export const PRUNE_TRIGGER_PAIRS = 20;

/**
 * Turn-pairs retained verbatim after a prune. Lower than the trigger on
 * purpose: the gap between the two is how many turns of append-only,
 * cache-friendly growth follow each prune.
 */
export const PRUNE_RETAIN_PAIRS = 10;

/** Hard cap on a single summary. Roughly 400 tokens. */
export const SUMMARY_CHAR_LIMIT = 1600;

/** Per-message cap when rendering the dropped span for the summarizer. */
export const TRANSCRIPT_MESSAGE_CHAR_LIMIT = 800;

/** Overall cap on the rendered span. */
export const TRANSCRIPT_CHAR_LIMIT = 20_000;

/**
 * Assistant turn that bridges the brief and the summary on formats that
 * require strictly alternating roles.
 *
 * Deliberately claims nothing. It exists to occupy an assistant slot, and a
 * model reading its own transcript must not find a turn where it appears to
 * have reported progress it never made. Kept short for the same reason it
 * exists at all: it is protocol padding, not context.
 */
export const PRUNE_BRIDGE_TEXT = "Understood. Continuing from the compacted context that follows.";

/**
 * One summarizer call's result: the summary, and what producing it cost.
 *
 * The cost is part of the contract because compaction is a real provider call —
 * up to {@link TRANSCRIPT_CHAR_LIMIT} characters in, a capped summary out — and
 * a run that does not count it under-reports its own spend everywhere the
 * totals surface. Both cost fields are optional: a provider may not report
 * usage, and a hand-written summarizer has no model to name.
 */
export interface PruneSummary {
  /** Raw summary text, before {@link normalizePruneSummary} runs on it. */
  text: string;
  /** Tokens the call consumed, when the provider reported them. */
  tokenUsage?: TokenUsage;
  /** Model that produced the summary — the light tier, not the run's model. */
  model?: string;
}

/** Generates a summary of a rendered transcript. Rejects to decline. */
export type PruneSummarizer = (transcript: string) => Promise<PruneSummary>;

/** Everything the pruner needs to know about one loop's message format. */
export interface PruneShape<M> {
  /**
   * Leading messages that are never dropped or rewritten — the system prompt
   * (where the format carries one) plus the task brief.
   */
  headCount: number;
  /**
   * True when `message` may legally begin the retained tail. Tool results are
   * only valid immediately after the assistant message that requested them, so
   * every format answers "is this an assistant message"; the cut is walked
   * forward until this holds, which is what stops a prune from orphaning a
   * tool result and getting the next request rejected.
   */
  isTailStart: (message: M) => boolean;
  /** Flatten one message to plain text for the summarizer prompt. */
  render: (message: M) => string;
  /**
   * Wrap summary text in the message — or messages — this format accepts.
   *
   * A list rather than a single message because the summary lands between the
   * brief (a user turn) and the retained tail (an assistant turn), and formats
   * differ on whether that is legal. Anthropic documents consecutive same-role
   * turns as merged, so one user message is enough. The OpenAI-compatible and
   * Gemini paths are rendered by the served model's own chat template, and the
   * common ones (Mistral-Instruct, Gemma, Llama-2-chat) raise
   * "Conversation roles must alternate" instead — so those shapes return an
   * assistant bridge turn followed by the user summary, keeping the array
   * strictly alternating. Order matters: bridge first, because the tail opens
   * on an assistant turn and a summary placed last would collide with it.
   */
  toSummaryMessage: (summary: string) => M | M[];
  /**
   * Rewrite one retained-tail message so it stays valid after the cut, or
   * return it unchanged. Optional: formats with no prefix-bound content omit
   * it and the pruner skips the pass entirely.
   *
   * This exists for Anthropic's *preserved thinking* rule. A `thinking` block's
   * signature is bound to the exact conversation prefix that produced it, and
   * from Claude Fable 5.1 / Claude Mythos 5.1 onward the API rejects a request
   * whose history was edited behind a retained thinking block with
   * `400 Invalid signature in thinking block. The block is bound to a different
   * conversation`. Keep-tail compaction is the documented failure shape: the
   * retained turns are byte-identical, but the prefix in front of them is now a
   * summary rather than the turns that were summarized, so every thinking block
   * in the tail is invalidated at once. Anthropic's documented recovery for
   * compaction is to strip those blocks from the retained history, which is
   * what {@link stripAnthropicThinking} does.
   *
   * Only the retained tail is passed through this hook. Rewriting the head or
   * the summary region would move the cached prefix, which is the thing the
   * whole module exists to protect.
   */
  sanitizeRetained?: (message: M) => M;
}

/** What one {@link ConversationPruner.prune} call did, and what it cost. */
export interface PruneOutcome {
  /** Messages removed from the array. */
  dropped: number;
  /** True when the dropped span was replaced by a summary message. */
  summarized: boolean;
  /**
   * Tokens the summary call spent, for the caller to fold into the run.
   *
   * Reported whenever the call returned — including when its text was
   * unusable and {@link summarized} is therefore false. The summary was
   * discarded; the tokens were not. Absent when no call was made or it threw.
   */
  summaryUsage?: TokenUsage;
  /**
   * Model that spent them, so the per-turn breakdown attributes compaction to
   * the light tier rather than to the run's primary model.
   */
  summaryModel?: string;
}

/** Internal result of one summarize attempt: text if usable, cost regardless. */
interface SummarizeAttempt {
  /** Normalized summary, or absent when the call declined, failed, or threw. */
  text?: string;
  tokenUsage?: TokenUsage;
  model?: string;
}

const NO_PRUNE: PruneOutcome = { dropped: 0, summarized: false };

/** Truncate with a visible marker so the model knows text is missing. */
function clamp(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…[truncated]`;
}

/**
 * Render a dropped span as a plain-text transcript.
 *
 * Per-message truncation runs first so one enormous tool result cannot crowd
 * out every other turn; the overall cap then keeps the earliest turns, which
 * are the ones the retained tail no longer covers.
 */
export function renderPruneTranscript<M>(
  messages: readonly M[],
  render: (message: M) => string,
): string {
  const lines: string[] = [];
  for (const message of messages) {
    const text = render(message).trim();
    if (text.length === 0) continue;
    lines.push(clamp(text, TRANSCRIPT_MESSAGE_CHAR_LIMIT));
  }
  return clamp(lines.join("\n\n"), TRANSCRIPT_CHAR_LIMIT);
}

/**
 * The light-tier output contract for a prune summary.
 *
 * A light model may wrap prose in a fence or open with "Here is a summary:".
 * That text goes straight into the conversation the agent reasons over, so it
 * is stripped rather than passed through. Output with no usable prose left
 * yields `undefined`, which the caller treats as a declined summary.
 */
export function normalizePruneSummary(text: string | undefined): string | undefined {
  if (!text) return undefined;

  let body = text.trim();

  // Unwrap a single fenced block, the most common light-tier packaging.
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(body);
  if (fenced) body = fenced[1].trim();

  // Drop a leading label line ("Summary:", "Here is the summary:").
  body = body.replace(/^(?:here (?:is|are)[^\n:]*|summary)\s*:\s*/i, "").trim();

  if (body.length === 0) return undefined;
  return clamp(body, SUMMARY_CHAR_LIMIT);
}

/**
 * Prompt for the prune summary.
 *
 * Written as an extraction task rather than a prose-summary task: the value of
 * the summary is the concrete facts the dropped turns are the only record of
 * (paths, commands, failures, decisions), and a light model asked to
 * "summarize" reliably answers with atmosphere instead.
 */
export function buildPruneSummaryPrompt(transcript: string, taskTitle: string): string {
  return [
    "You are compacting the transcript of an autonomous coding agent so the",
    "conversation fits the model's context window. The turns below are about to",
    "be removed and replaced by your answer, so anything you leave out is lost.",
    "",
    `Task in progress: ${taskTitle}`,
    "",
    "Write plain prose that records, as specifically as the transcript allows:",
    "- every file path touched, and what changed in each",
    "- every command run, and whether it passed or failed",
    "- concrete findings: error messages, failing test names, identifiers, line numbers",
    "- decisions made, and approaches explicitly ruled out",
    "- work started but not finished",
    "",
    "Keep identifiers and paths verbatim. Do not add advice, praise, or next",
    "steps. Do not use markdown fences or headings. No preamble — begin with",
    "the first fact.",
    "",
    "--- transcript ---",
    transcript,
  ].join("\n");
}

/**
 * Batched, summarizing prune over one loop's message array.
 *
 * Stateful because it tracks the size of the append-only summary region, which
 * is what tells the next prune where the droppable span begins. One instance
 * per run, per message array.
 */
export class ConversationPruner<M> {
  private summaryCount = 0;

  constructor(
    private readonly shape: PruneShape<M>,
    private readonly summarize: PruneSummarizer,
  ) {}

  /**
   * Messages held in the append-only summary region. Counted in messages, not
   * in prunes, because a shape may need more than one message per summary —
   * both {@link triggerLength} and the drop offset are message indices.
   * Exposed for assertions and logging.
   */
  get summaries(): number {
    return this.summaryCount;
  }

  /** Length at which the next prune fires. */
  get triggerLength(): number {
    return this.shape.headCount + this.summaryCount + PRUNE_TRIGGER_PAIRS * 2;
  }

  /**
   * Prune `messages` in place when it has outgrown the trigger.
   *
   * Mutates only the droppable span and appends whatever the shape's
   * {@link PruneShape.toSummaryMessage} returns; the head and the existing
   * summaries keep their bytes and their indices.
   */
  async prune(messages: M[]): Promise<PruneOutcome> {
    if (messages.length <= this.triggerLength) return NO_PRUNE;

    const dropStart = this.shape.headCount + this.summaryCount;

    // Walk the cut forward to a message that may legally begin the tail, so a
    // tool result is never separated from the request it answers.
    let cut = messages.length - PRUNE_RETAIN_PAIRS * 2;
    while (cut < messages.length && !this.shape.isTailStart(messages[cut])) cut++;
    if (cut >= messages.length || cut <= dropStart) return NO_PRUNE;

    const dropped = messages.slice(dropStart, cut);
    const attempt = await this.trySummarize(dropped);

    const outcome: PruneOutcome = { dropped: dropped.length, summarized: false };
    if (attempt.tokenUsage) outcome.summaryUsage = attempt.tokenUsage;
    if (attempt.model) outcome.summaryModel = attempt.model;

    if (attempt.text === undefined) {
      // Degrade to the pre-summary behavior: drop the span, keep the run.
      messages.splice(dropStart, dropped.length);
      this.sanitizeTail(messages, dropStart);
      detail(`Pruned ${dropped.length} messages (no summary available)`);
      return outcome;
    }

    const inserted = this.shape.toSummaryMessage(attempt.text);
    const summaryMessages = Array.isArray(inserted) ? inserted : [inserted];
    messages.splice(dropStart, dropped.length, ...summaryMessages);
    this.summaryCount += summaryMessages.length;
    this.sanitizeTail(messages, dropStart + summaryMessages.length);
    detail(`Pruned ${dropped.length} messages into a ${attempt.text.length}-char summary`);
    outcome.summarized = true;
    return outcome;
  }

  /**
   * Run {@link PruneShape.sanitizeRetained} over the tail the prune kept.
   *
   * Runs on both the summarized and the degraded-drop paths: both edit the
   * middle of the history, so both invalidate anything in the tail that was
   * bound to the old prefix. `tailStart` is the first index after whatever the
   * splice left in place, so the head and the summary region are never visited
   * and their bytes cannot move.
   */
  private sanitizeTail(messages: M[], tailStart: number): void {
    const sanitize = this.shape.sanitizeRetained;
    if (!sanitize) return;
    for (let i = tailStart; i < messages.length; i++) messages[i] = sanitize(messages[i]);
  }

  /**
   * Summarize the span.
   *
   * The cost is reported separately from the text on purpose: a call that
   * answered with an unusable summary still consumed tokens, and the caller
   * needs to book them either way. Only a throw — or no call at all — yields
   * nothing to book.
   */
  private async trySummarize(dropped: readonly M[]): Promise<SummarizeAttempt> {
    try {
      const transcript = renderPruneTranscript(dropped, this.shape.render);
      if (transcript.length === 0) return {};

      const result = await this.summarize(transcript);
      const attempt: SummarizeAttempt = {};
      if (result.tokenUsage) attempt.tokenUsage = result.tokenUsage;
      if (result.model) attempt.model = result.model;

      const text = normalizePruneSummary(result.text);
      if (text !== undefined) attempt.text = text;
      return attempt;
    } catch (err) {
      detail(`Prune summary failed (${(err as Error).message})`);
      return {};
    }
  }
}

// ---------------------------------------------------------------------------
// Summarizer backed by the context.summarize task class
// ---------------------------------------------------------------------------

/** Inputs for {@link createContextSummarizer}. */
export interface ContextSummarizerOptions {
  /** Provider already resolved for this run. */
  provider: Pick<LLMProvider, "complete">;
  llmConfig: LLMConfig;
  /**
   * Vendor the run is using, so the light tier resolves for that vendor. An
   * unrecognized value falls back to the configured vendor rather than
   * asserting: routing is a cost optimization, not a correctness gate.
   */
  vendor: string;
  /** Task title, for orienting the summary. */
  taskTitle: string;
}

/**
 * A {@link PruneSummarizer} that calls the run's provider on the tier
 * `context.summarize` routes to — light by default.
 *
 * Deliberately not the run's own model: compaction is mechanical extraction
 * from text that is already in hand, and its output is length-capped and
 * contract-checked, so it is the archetypal light-tier call.
 */
export function createContextSummarizer(opts: ContextSummarizerOptions): PruneSummarizer {
  // The class is a literal rather than a named constant on purpose:
  // tests/integration/task-class-registry.test.js scans sources for the class
  // name at the call site to prove every routed class still has a live caller.
  const resolution = resolveTaskModel("context.summarize", opts.llmConfig, {
    vendor: isLLMVendor(opts.vendor) ? opts.vendor : undefined,
  });

  return async (transcript: string): Promise<PruneSummary> => {
    detail(`Compacting context via ${resolution.model} (${resolution.tier} tier)`);
    const { text, tokenUsage } = await opts.provider.complete({
      prompt: buildPruneSummaryPrompt(transcript, opts.taskTitle),
      model: resolution.model,
    });
    // `tokenUsage` is carried, not dropped: this call is billed like any other,
    // and the model named here is the light tier the class routed to.
    const summary: PruneSummary = { text, model: resolution.model };
    if (tokenUsage) summary.tokenUsage = tokenUsage;
    return summary;
  };
}

// ---------------------------------------------------------------------------
// Anthropic message shape
// ---------------------------------------------------------------------------

/** Flatten an Anthropic `tool_result` block's content to text. */
function renderToolResult(block: Anthropic.ToolResultBlockParam): string {
  if (typeof block.content === "string") return block.content;
  if (!block.content) return "";
  return block.content
    .map((part) => (part.type === "text" ? part.text : `[${part.type}]`))
    .join("\n");
}

/** Flatten one Anthropic message — text, tool requests and tool results. */
export function renderAnthropicMessage(message: Anthropic.MessageParam): string {
  if (typeof message.content === "string") return `${message.role}: ${message.content}`;

  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") parts.push(block.text);
    else if (block.type === "tool_use") {
      parts.push(`→ ${block.name}(${JSON.stringify(block.input)})`);
    } else if (block.type === "tool_result") {
      parts.push(`← ${renderToolResult(block)}`);
    }
  }
  if (parts.length === 0) return "";
  return `${message.role}: ${parts.join("\n")}`;
}

/**
 * Wrap summary text as a message the Anthropic loop accepts.
 *
 * A `user` message rather than an `assistant` one: it is context handed to the
 * model, not something the model said. It lands directly after the brief,
 * putting two user messages in a row, which the Messages API documents as
 * legal — "Consecutive `user` or `assistant` turns in your request will be
 * combined into a single turn". An assistant summary would create the same
 * adjacency against the tail's leading assistant message *and* read as if the
 * model had claimed work it cannot see.
 *
 * The adjacency is unavoidable, because the other rule is strict: a
 * `tool_result` "must immediately follow their corresponding tool use blocks",
 * so the retained tail has to begin on the assistant turn that requested the
 * results it carries. That is what {@link PruneShape.isTailStart} enforces.
 */
export function anthropicSummaryMessage(summary: string): Anthropic.MessageParam {
  return {
    role: "user",
    content:
      "[context] Earlier turns of this run were compacted to fit the context " +
      `window. What happened in them:\n\n${summary}`,
  };
}

/**
 * Stand-in for an assistant turn that held nothing but reasoning.
 *
 * Rare but reachable: a response truncated by `max_tokens` while the model was
 * still thinking carries a thinking block and nothing else, and stripping it
 * would leave `content: []`, which the API rejects. A message must survive the
 * strip, because the tail has to open on the assistant turn that owns the
 * following tool results.
 */
export const THINKING_ELIDED_TEXT = "[reasoning from an earlier turn was dropped during compaction]";

/**
 * Drop `thinking` and `redacted_thinking` blocks from a retained assistant turn.
 *
 * Anthropic's preserved-thinking rule binds a thinking block's signature to the
 * conversation prefix that produced it, so a keep-tail prune — which replaces
 * the turns in front of the tail with a summary — invalidates every thinking
 * block it retains. Stripping them is the documented recovery; see
 * {@link PruneShape.sanitizeRetained}.
 *
 * `text` and `tool_use` blocks keep their relative order, so the tool_use ids
 * the following `tool_result` blocks refer to are untouched. A message with no
 * thinking in it is returned by reference, so an unaffected tail costs nothing
 * and stays `===` to what the caller had.
 */
export function stripAnthropicThinking(
  message: Anthropic.MessageParam,
): Anthropic.MessageParam {
  if (message.role !== "assistant" || typeof message.content === "string") return message;

  const isThinking = (block: Anthropic.ContentBlockParam): boolean =>
    block.type === "thinking" || block.type === "redacted_thinking";

  if (!message.content.some(isThinking)) return message;

  const content = message.content.filter((block) => !isThinking(block));
  return {
    ...message,
    content: content.length > 0 ? content : [{ type: "text", text: THINKING_ELIDED_TEXT }],
  };
}

/** Prune shape for the Anthropic API loop: brief at index 0, then turn-pairs. */
export function anthropicPruneShape(): PruneShape<Anthropic.MessageParam> {
  return {
    headCount: 1,
    isTailStart: (message) => message.role === "assistant",
    render: renderAnthropicMessage,
    toSummaryMessage: anthropicSummaryMessage,
    sanitizeRetained: stripAnthropicThinking,
  };
}
