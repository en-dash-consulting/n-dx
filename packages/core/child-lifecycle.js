const DEFAULT_FORCE_KILL_TIMEOUT_MS = 5000;
const SIGNAL_EXIT_CODES = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGTERM: 15,
};

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

export function createChildProcessTracker({ forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS } = {}) {
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
        [...children].map((child) => terminateChildProcess(child, forceKillTimeoutMs)),
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
