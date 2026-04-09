/**
 * Orphan grandchild process — runs indefinitely and ignores SIGTERM.
 *
 * Used by orphan-child-double.mjs to simulate a subprocess that would
 * outlive its parent if not cleaned up via process-group termination.
 */

process.on("SIGTERM", () => {
  // Deliberately ignore graceful termination.  Only SIGKILL can stop this process.
});

// Keep the event loop alive.
setInterval(() => {}, 1_000);
