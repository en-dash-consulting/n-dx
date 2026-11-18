/**
 * Splitting a Jev request TypeSafe refuses as too large.
 *
 * Batches are sized by item count, so on a large repository one request can
 * outgrow what TypeSafe accepts. It answers with a non-retryable 400 whose
 * body names `max_tokens_exceeded`; sending the same request again fails the
 * same way. Each item's own evidence is already capped, so halving the item
 * range until each request fits is enough — one item's evidence is never
 * split across requests.
 *
 * The check lives here rather than as an llm-client `ErrorReason`: a new
 * reason would change llm-client's public surface during the soft freeze.
 */

import { ClaudeClientError } from "./claude-client.js";

/** TypeSafe refused the request because it is too large to judge. */
export function isJevTooLarge(err: unknown): boolean {
  return err instanceof ClaudeClientError && err.message.includes("max_tokens_exceeded");
}

/**
 * Ask about `items` in as few requests as fit. `ask` gets a slice and the
 * index of its first item in `items`. A too-large refusal halves the slice
 * (the first half one longer when odd) and asks both halves, first half
 * first, before anything after them. Returns the items too large on their
 * own, in order; any other error from `ask` propagates.
 */
export async function askSplittingWhenTooLarge<T>(
  items: readonly T[],
  ask: (slice: T[], offset: number) => Promise<void>,
): Promise<T[]> {
  const tooLarge: T[] = [];
  const queue: Array<[number, number]> = items.length > 0 ? [[0, items.length]] : [];
  while (queue.length > 0) {
    const [start, end] = queue.shift()!;
    try {
      await ask(items.slice(start, end), start);
    } catch (err) {
      if (!isJevTooLarge(err)) throw err;
      const len = end - start;
      if (len === 1) {
        tooLarge.push(items[start]);
        continue;
      }
      const mid = start + Math.ceil(len / 2);
      queue.unshift([start, mid], [mid, end]);
    }
  }
  return tooLarge;
}
