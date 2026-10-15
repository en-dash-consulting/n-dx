import type { FSWatcher } from "node:fs";

/**
 * Attach the 'error' listener every FSWatcher needs: without one, an error
 * emitted after `watch()` returned (Windows raises EPERM when a watched
 * directory is deleted, nodejs/node#4337) is an uncaught exception that takes
 * the server down; the try/catch around `watch()` only covers a synchronous
 * throw. A failed watcher is closed and `onError` lets the owner forget it.
 */
export function guardWatcher(w: FSWatcher, label: string, onError?: () => void): FSWatcher {
  w.on("error", (err) => {
    console.warn(`[watcher] ${label} watcher error, closing it: ${(err as Error).message}`);
    w.close();
    onError?.();
  });
  return w;
}
