/**
 * One assistant message, counted once.
 *
 * ## The defect this exists to prevent
 *
 * Claude's `--output-format stream-json` emits one `assistant` line per
 * *content block*, not per message. A turn that writes a sentence and then
 * calls three tools arrives as four lines — and every one of them carries the
 * complete `message` object, `usage` included. The same is true of the session
 * transcripts Claude Code writes under `~/.claude/projects/`.
 *
 * Every consumer that summed `message.usage` line by line therefore charged
 * each turn once per content block. Measured on a real session in this
 * repository's sibling project: 234 usage-bearing lines carrying only 57
 * distinct messages, for a 4.27x over-count — 23.5M cache-read tokens
 * reported against 5.5M actually read. That is the gap between a dashboard
 * reading "millions in seconds" and the thousands the vendor actually billed.
 *
 * ## Why first-wins
 *
 * The duplicates are byte-identical: the CLI repeats the finished message's
 * usage on each block rather than streaming a partial that grows. Verified
 * across a full transcript — zero ids carried differing payloads. So the first
 * sighting is the whole truth and later sightings are pure repetition. Taking
 * the last would be equally correct and strictly more expensive, since it
 * would mean retracting usage already accumulated.
 *
 * ## Why a filter object rather than a pure function
 *
 * Deduplication is inherently stateful — it is a question about what has
 * already been seen. Pushing that state to the call site (a bare `Set` per
 * parse loop) is what let the three ingestion paths drift apart in the first
 * place. One object, constructed per run or per transcript read, keeps the
 * identity rule in a single place.
 *
 * A payload with no id is always accepted. Vendors other than Claude do not
 * stamp one, and refusing to count unidentifiable usage would trade a 4x
 * over-count for a total loss.
 *
 * @module llm-client/usage-dedup
 */

/**
 * Read the vendor's message identity from a raw stream or transcript payload.
 *
 * Checks the two shapes that carry one: `message.id` (Claude stream-json
 * `assistant` lines and Claude Code transcript entries) and a top-level `id`
 * alongside a `usage` field (the Anthropic Messages API response shape).
 *
 * Returns `undefined` when the payload carries no usable identity — the
 * caller should then count the usage rather than discard it.
 */
export function usageMessageId(rawJson: unknown): string | undefined {
  if (!rawJson || typeof rawJson !== "object") return undefined;
  const root = rawJson as Record<string, unknown>;

  const message = root.message;
  if (message && typeof message === "object") {
    const id = (message as Record<string, unknown>).id;
    if (typeof id === "string" && id) return id;
  }

  // Top-level id only counts when this payload is itself usage-bearing.
  // Plenty of stream lines carry an unrelated `id`, and treating those as
  // message identities would suppress distinct turns.
  if (root.usage && typeof root.usage === "object") {
    const id = root.id;
    if (typeof id === "string" && id) return id;
  }

  return undefined;
}

/**
 * Accepts each vendor message's usage exactly once.
 *
 * Construct one per run (or per transcript read) and call {@link accept}
 * before accumulating any `usage` payload:
 *
 * ```ts
 * const seen = new UsageMessageFilter();
 * for (const line of lines) {
 *   const json = JSON.parse(line);
 *   if (!seen.accept(json)) continue; // repeat of a message already counted
 *   total.input += json.message.usage.input_tokens;
 * }
 * ```
 */
export class UsageMessageFilter {
  private readonly seen = new Set<string>();

  /**
   * True when this payload's usage has not been counted yet — and records it
   * as counted. False when it repeats a message already accepted.
   *
   * Payloads with no message identity always return true; see the module
   * note on why unidentifiable usage is counted rather than dropped.
   */
  accept(rawJson: unknown): boolean {
    const id = usageMessageId(rawJson);
    if (!id) return true;
    if (this.seen.has(id)) return false;
    this.seen.add(id);
    return true;
  }

  /** Whether `id` has already been counted. Does not record it. */
  has(id: string): boolean {
    return this.seen.has(id);
  }

  /** Distinct messages counted so far. */
  get size(): number {
    return this.seen.size;
  }
}
