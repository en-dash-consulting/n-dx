const DEFAULT_FORCE_KILL_TIMEOUT_MS = 5000;
const SIGNAL_EXIT_CODES = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGTERM: 15,
};

/**
 * Whether the current platform supports POSIX process groups.
 * On Windows, process.kill(-pgid, signal) is not implemented.
 */
export const PLATFORM_SUPPORTS_PROCESS_GROUPS = process.platform !== "win32";

function isChildRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function waitForChildExit(child) {
  if (!isChildRunning(child)) return Promise.resolve();

  return new Promise((resolve) => {
    const done = () => {
      child.removeListener("close", done);
      child.removeListener("exit", done);
      resolve();
    };

    child.once("close", done);
    child.once("exit", done);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function terminateChildProcess(child, forceKillTimeoutMs) {
  if (!isChildRunning(child)) return;

  try {
    child.kill("SIGTERM");
  } catch {
    return;
  }

  await Promise.race([
    waitForChildExit(child),
    delay(forceKillTimeoutMs),
  ]);

  if (!isChildRunning(child)) return;

  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }

  await Promise.race([
    waitForChildExit(child),
    delay(forceKillTimeoutMs),
  ]);
}

/**
 * Terminate an entire process group rooted at the child's PID.
 *
 * Sends SIGTERM to the process group (process.kill(-pgid, signal)), which
 * delivers the signal to every process in the group — including grandchildren
 * spawned by the child.  Falls back to direct kill if the group kill fails.
 *
 * Only effective when the child was spawned with `detached: true`, which makes
 * it the leader of a new process group.
 */
async function terminateProcessGroup(child, forceKillTimeoutMs) {
  if (!isChildRunning(child)) return;

  if (!child.pid) {
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  let groupKillSucceeded = false;
  try {
    process.kill(-child.pid, "SIGTERM");
    groupKillSucceeded = true;
  } catch {
    // Group kill failed (e.g. child already exited or pgid not available).
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  await Promise.race([
    waitForChildExit(child),
    delay(forceKillTimeoutMs),
  ]);

  if (!isChildRunning(child)) return;

  if (groupKillSucceeded) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // Group may have already exited between SIGTERM and SIGKILL — ignore.
    }
  }

  await Promise.race([
    waitForChildExit(child),
    delay(forceKillTimeoutMs),
  ]);
}

/**
 * Create a tracker that registers and cleans up child processes.
 *
 * @param {object} [options]
 * @param {number} [options.forceKillTimeoutMs=5000] - Grace period before escalating to SIGKILL.
 * @param {boolean} [options.processGroups=false] - When true, terminate the entire process group
 *   instead of only the direct child.  Requires children to be spawned with `detached: true` so
 *   each child is its own process group leader.  No-op on Windows (logs a one-time warning).
 */
export function createChildProcessTracker({
  forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
  processGroups = false,
} = {}) {
  if (processGroups && !PLATFORM_SUPPORTS_PROCESS_GROUPS) {
    process.stderr.write(
      "[child-lifecycle] process group cleanup is not supported on this platform; falling back to direct child kill\n",
    );
  }

  const terminate = (processGroups && PLATFORM_SUPPORTS_PROCESS_GROUPS)
    ? terminateProcessGroup
    : terminateChildProcess;

  const children = new Set();
  let cleanupPromise = null;

  function unregister(child) {
    children.delete(child);
  }

  function register(child) {
    if (!child || typeof child.kill !== "function") return child;

    children.add(child);

    const onClose = () => unregister(child);
    const onExit = () => unregister(child);

    child.once("close", onClose);
    child.once("exit", onExit);

    return child;
  }

  async function cleanup() {
    if (!cleanupPromise) {
      cleanupPromise = Promise.allSettled(
        [...children].map((child) => terminate(child, forceKillTimeoutMs)),
      ).then(() => undefined);
    }

    return cleanupPromise;
  }

  return {
    cleanup,
    register,
    size() {
      return children.size;
    },
  };
}

export function installTrackedChildProcessHandlers({
  tracker,
  processRef = process,
  signals = ["SIGINT", "SIGTERM"],
  onSignal,
}) {
  let signalPromise = null;
  const handlers = new Map();

  const removeHandlers = () => {
    for (const [signal, handler] of handlers) {
      processRef.removeListener(signal, handler);
    }
    handlers.clear();
  };

  const handleSignal = (signal) => {
    if (!signalPromise) {
      signalPromise = (async () => {
        removeHandlers();
        await tracker.cleanup();

        if (typeof onSignal === "function") {
          await onSignal(signal);
          return;
        }

        processRef.exit(128 + (SIGNAL_EXIT_CODES[signal] ?? 1));
      })();
    }

    return signalPromise;
  };

  for (const signal of signals) {
    const handler = () => {
      void handleSignal(signal);
    };
    handlers.set(signal, handler);
    processRef.on(signal, handler);
  }

  return {
    dispose: removeHandlers,
    handleSignal,
  };
}
