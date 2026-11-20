/**
 * Sizing Jev requests so TypeSafe accepts them, in three layers.
 *
 * 1. **Packing** ({@link packBySize}): items go out in chunks whose JSON bytes
 *    stay under {@link jevRequestByteCeiling}, still capped by each caller's
 *    count. Bytes, not tokens: no tokenizer is needed to stay roughly right.
 * 2. **Splitting** ({@link askSplittingWhenTooLarge}): TypeSafe refuses a
 *    request it cannot take with a non-retryable 400 naming
 *    `max_tokens_exceeded`; the refused range is halved until each request
 *    fits. It covers a wrong ceiling, a later change in TypeSafe's limit and a
 *    limit on the answer rather than the request.
 * 3. **Trimming**: an item refused on its own is asked again on less evidence,
 *    one deterministic trim level at a time, before it is left out. Never a
 *    model summary: that is a paid call, differs every run (judgment cache
 *    misses), and Jev would judge a paraphrase instead of the evidence.
 *
 * The largest size driver for classification is the archetype catalog, which
 * a classification request repeats once per file question. That is TypeSafe's
 * API shape (each Choice carries its own options), so it is left as is.
 *
 * The too-large check lives here rather than as an llm-client `ErrorReason`:
 * a new reason would change llm-client's public surface during the soft freeze.
 */

import { debug } from "@n-dx/llm-client";
import { ClaudeClientError } from "./claude-client.js";

/**
 * Default request ceiling in UTF-8 bytes of the request's JSON. TypeSafe does
 * not publish its limit, so this comes from a reference deep run: its
 * successful `finding.judge` requests averaged about 22k input tokens (about
 * 88 KB at roughly 4 bytes per token of JSON), and no 30-file classification
 * request against the built-in catalog (about 118 KB) was refused. 128 KiB sits
 * above both, so requests of the shape that succeeded keep it, and only the
 * outliers that were refused are packed smaller. Splitting covers the error.
 */
export const JEV_REQUEST_BYTE_CEILING = 128 * 1024;

let configuredCeiling: number | undefined;

/**
 * Override the ceiling for this process (`sourcevision.jev.requestByteCeiling`);
 * `undefined` restores {@link JEV_REQUEST_BYTE_CEILING}.
 */
export function setJevRequestByteCeiling(bytes: number | undefined): void {
  configuredCeiling = bytes;
}

/** The ceiling in force: the configured override, else the default. */
export function jevRequestByteCeiling(): number {
  return configuredCeiling ?? JEV_REQUEST_BYTE_CEILING;
}

/** UTF-8 byte length of a value's JSON. */
export function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

/** Debug-level record of one request's size and outcome. */
export function logJevRequest(taskClass: string, bytes: number, err?: unknown): void {
  const outcome = err === undefined ? "answered" : isJevTooLarge(err) ? "refused as too large" : "failed";
  debug(`  [jev] ${taskClass} request ${bytes} bytes — ${outcome}`);
}

/** TypeSafe refused the request because it is too large to judge. */
export function isJevTooLarge(err: unknown): boolean {
  return err instanceof ClaudeClientError && err.message.includes("max_tokens_exceeded");
}

export interface PackOptions<T> {
  /** At most this many items per chunk. */
  maxCount?: number;
  /**
   * State an item needs that a chunk carries once however many of its items
   * need it, as `[key, bytes]` pairs: each key is counted once per chunk.
   */
  shared?: (item: T) => Iterable<readonly [string, number]>;
}

/**
 * Pack `items`, in order, into chunks whose summed size (each item's
 * `sizeOf` plus each distinct shared key's bytes) stays at or under
 * `ceiling`, with at most `maxCount` items each. An item over the ceiling on
 * its own gets a chunk of its own.
 */
export function packBySize<T>(
  items: readonly T[],
  sizeOf: (item: T) => number,
  ceiling: number,
  opts: PackOptions<T> = {},
): T[][] {
  const maxCount = opts.maxCount ?? Infinity;
  const chunks: T[][] = [];
  let chunk: T[] = [];
  let bytes = 0;
  let keys = new Set<string>();

  const cost = (item: T, own: number): [number, string[]] => {
    const added: string[] = [];
    let total = own;
    for (const [key, size] of opts.shared?.(item) ?? []) {
      if (keys.has(key) || added.includes(key)) continue;
      added.push(key);
      total += size;
    }
    return [total, added];
  };

  for (const item of items) {
    const own = sizeOf(item);
    let [add, added] = cost(item, own);
    if (chunk.length > 0 && (chunk.length >= maxCount || bytes + add > ceiling)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 0;
      keys = new Set();
      [add, added] = cost(item, own);
    }
    chunk.push(item);
    bytes += add;
    for (const key of added) keys.add(key);
  }
  if (chunk.length > 0) chunks.push(chunk);
  return chunks;
}

/**
 * Ask about `items` in as few requests as fit. `ask` gets a slice and the
 * index of its first item in `items`. A too-large refusal halves the slice
 * (the first half one longer when odd) and asks both halves, first half
 * first, before anything after them. A single item refused is asked again as
 * `trim(item, 1)`, `trim(item, 2)`, … until one is answered or `trim` returns
 * undefined. Returns the items left out after every trim level, in order; any
 * other error from `ask` propagates.
 */
export async function askSplittingWhenTooLarge<T>(
  items: readonly T[],
  ask: (slice: T[], offset: number) => Promise<void>,
  trim?: (item: T, level: number) => T | undefined,
): Promise<T[]> {
  const askTrimmed = async (item: T, offset: number): Promise<boolean> => {
    for (let level = 1; trim; level++) {
      const trimmed = trim(item, level);
      if (trimmed === undefined) return false;
      try {
        await ask([trimmed], offset);
        return true;
      } catch (err) {
        if (!isJevTooLarge(err)) throw err;
      }
    }
    return false;
  };

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
        if (!(await askTrimmed(items[start], start))) tooLarge.push(items[start]);
        continue;
      }
      const mid = start + Math.ceil(len / 2);
      queue.unshift([start, mid], [mid, end]);
    }
  }
  return tooLarge;
}
