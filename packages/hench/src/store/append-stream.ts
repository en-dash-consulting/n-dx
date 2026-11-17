/**
 * The fail-soft append stream behind the run log (`run-log.ts`) and the run's
 * events file (`run-events.ts`): a file written as the run narrates itself,
 * whose writes are never awaited and never throw.
 *
 * A disk problem must not take down an agent loop that was only trying to
 * narrate itself, so a write error is recorded instead of thrown and reported
 * once, by {@link AppendStream.close}. What each file writes, and how it
 * scrubs it, stays with its own module.
 *
 * @module
 */

import { open } from "node:fs/promises";
import type { WriteStream } from "node:fs";

/** An owner-only file opened for fire-and-forget appends. */
export interface AppendStream {
  /**
   * True once the file is closed or a write has failed. Every further write
   * would fail the same way, so callers stop writing.
   */
  readonly done: boolean;
  /**
   * Hand `text` to the stream. Deliberately no backpressure handling: the
   * agent loop must never wait on disk. Node buffers what the fd cannot take
   * yet and drains it in order, so the file stays correct — only its tail lags.
   */
  write(text: string): void;
  /**
   * Flush and close the file. `beforeEnd` makes the last writes, once, unless
   * the stream has already failed.
   *
   * @returns The first write error seen, or `null` when every write landed.
   */
  close(beforeEnd?: () => void): Promise<Error | null>;
}

/**
 * Create (or truncate) `path` with mode 0600 and open it for appending.
 *
 * @throws When the file cannot be opened. open() runs first, so an unwritable
 *         path rejects here — where the caller can still decide what to do —
 *         rather than as an async 'error' event later.
 */
export async function openAppendStream(path: string): Promise<AppendStream> {
  // Closing the stream closes the handle.
  const handle = await open(path, "w", 0o600);
  const stream: WriteStream = handle.createWriteStream({ encoding: "utf-8" });

  let failure: Error | null = null;
  let closed = false;
  /** Set while close() is waiting, so an error can settle it too. */
  let settleClose: ((error: Error | null) => void) | null = null;

  // An unhandled 'error' on a stream is thrown on the stream's own tick,
  // which would crash the run from inside an output call. Record it instead;
  // close() reports it.
  stream.on("error", (error: Error) => {
    failure ??= error;
    const settle = settleClose;
    settleClose = null;
    settle?.(failure);
  });

  const close = (beforeEnd?: () => void): Promise<Error | null> =>
    new Promise((resolve) => {
      if (closed) {
        resolve(failure);
        return;
      }
      closed = true;
      if (failure) {
        stream.destroy();
        resolve(failure);
        return;
      }
      beforeEnd?.();
      settleClose = resolve;
      stream.end(() => {
        const settle = settleClose;
        settleClose = null;
        settle?.(failure);
      });
    });

  return {
    get done() { return closed || failure !== null; },
    write: (text: string): void => { stream.write(text); },
    close,
  };
}
