/**
 * Stopping the benchmark: an abortable sleep and the Ctrl-C escalation.
 *
 * Measured runs lead their own process groups, so the terminal's SIGINT never
 * reaches them; the bench must signal them itself, and a suite slow to exit
 * on SIGTERM would otherwise hold it until the per-run timeout.
 */

/** Resolve after `ms`, or at once when `signal` aborts or has aborted already. */
export function sleep(ms, signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolvePromise) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolvePromise();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * The SIGINT/SIGTERM handler. The first signal aborts `abort`, sends SIGTERM
 * to every running child and sends SIGKILL to those still running after
 * `graceMs`; a second signal sends SIGKILL at once.
 *
 * @param {object} args
 * @param {AbortController} args.abort
 * @param {() => Iterable<object>} args.children the children running now
 * @param {(child: object, signal: string) => void} args.killTree
 * @param {number} args.graceMs
 * @param {(message: string) => void} [args.log]
 * @param {(fn: () => void, ms: number) => unknown} [args.setTimer]
 * @returns {(signal: string) => void}
 */
export function createSignalHandler({ abort, children, killTree, graceMs, log = console.error, setTimer = setTimeout }) {
  const killAll = (signal) => {
    for (const child of children()) killTree(child, signal);
  };
  return (signal) => {
    if (abort.signal.aborted) {
      log(`\n${signal} again: killing the running suites now…`);
      killAll("SIGKILL");
      return;
    }
    log(`\n${signal}: stopping the benchmark and removing its worktrees (again to kill at once)…`);
    abort.abort(signal);
    killAll("SIGTERM");
    // unref: the timer must not keep the bench alive once its runs have exited.
    setTimer(() => killAll("SIGKILL"), graceMs)?.unref?.();
  };
}

/** Throw when `signal` has aborted: a batch its runs were stopped in is not a result. */
export function throwIfStopped(signal) {
  if (signal?.aborted) throw new Error(`Stopped by ${signal.reason}.`);
}
