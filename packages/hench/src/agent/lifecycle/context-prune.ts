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
 *     |        one message per prune, append-only
 *     system prompt / task brief — never touched
 * ```
 *
 * A prune replaces the span between the summaries and the retained tail with
 * **one** summary message, appended to the summary region. Nothing already in
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

/** Generates a summary of a rendered transcript. Rejects to decline. */
export type PruneSummarizer = (transcript: string) => Promise<string>;

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
  /** Wrap summary text in a message this format accepts. */
  toSummaryMessage: (summary: string) => M;
}

/** What one {@link ConversationPruner.prune} call did. */
export interface PruneOutcome {
  /** Messages removed from the array. */
  dropped: number;
  /** True when the dropped span was replaced by a summary message. */
  summarized: boolean;
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

  /** Summary messages inserted so far. Exposed for assertions and logging. */
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
   * Mutates only the droppable span and appends at most one message; the head
   * and the existing summaries keep their bytes and their indices.
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
    const summary = await this.trySummarize(dropped);

    if (summary === undefined) {
      // Degrade to the pre-summary behavior: drop the span, keep the run.
      messages.splice(dropStart, dropped.length);
      detail(`Pruned ${dropped.length} messages (no summary available)`);
      return { dropped: dropped.length, summarized: false };
    }

    messages.splice(dropStart, dropped.length, this.shape.toSummaryMessage(summary));
    this.summaryCount++;
    detail(`Pruned ${dropped.length} messages into a ${summary.length}-char summary`);
    return { dropped: dropped.length, summarized: true };
  }

  /** Summarize the span, or `undefined` when the call declines or fails. */
  private async trySummarize(dropped: readonly M[]): Promise<string | undefined> {
    try {
      const transcript = renderPruneTranscript(dropped, this.shape.render);
      if (transcript.length === 0) return undefined;
      return normalizePruneSummary(await this.summarize(transcript));
    } catch (err) {
      detail(`Prune summary failed (${(err as Error).message})`);
      return undefined;
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

  return async (transcript: string): Promise<string> => {
    detail(`Compacting context via ${resolution.model} (${resolution.tier} tier)`);
    const { text } = await opts.provider.complete({
      prompt: buildPruneSummaryPrompt(transcript, opts.taskTitle),
      model: resolution.model,
    });
    return text;
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

/** Prune shape for the Anthropic API loop: brief at index 0, then turn-pairs. */
export function anthropicPruneShape(): PruneShape<Anthropic.MessageParam> {
  return {
    headCount: 1,
    isTailStart: (message) => message.role === "assistant",
    render: renderAnthropicMessage,
    toSummaryMessage: anthropicSummaryMessage,
  };
}
