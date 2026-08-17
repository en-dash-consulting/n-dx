import { spawnCli } from "./win-spawn.js";

const DEFAULT_FORCE_KILL_TIMEOUT_MS = 5000;
const SIGNAL_EXIT_CODES = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGTERM: 15,
};

/**
 * Whether `platform` supports POSIX process groups.
 *
 * Deliberately NOT exported: callers should ask for a tree kill via
 * {@link terminateTree} and let this module pick the strategy. An exported
 * capability flag invites callers to branch on the platform themselves, which
 * is how the two spawn/terminate platform conditionals in cli.js arose.
 */
function supportsProcessGroups(platform) {
  return platform !== "win32";
}

/**
 * Spawn options a child needs in order to be tree-killable later.
 *
 * POSIX: `detached: true` makes the child a process-group leader, which is what
 * lets `process.kill(-pgid)` reach grandchildren. Windows: nothing — `detached`
 * there means "new console", not "new process group", and taskkill walks the
 * tree by PID regardless.
 *
 * Exported so callers spawn correctly without testing `process.platform`.
 *
 * @param {NodeJS.Platform} [platform]
 * @returns {{ detached?: boolean }}
 */
export function treeKillSpawnOptions(platform = process.platform) {
  return supportsProcessGroups(platform) ? { detached: true } : {};
}

/**
 * Whether child-lifecycle diagnostics should be written to stderr.
 * Opt-in via NDX_DEBUG_LIFECYCLE / NDX_DEBUG — the direct-kill path is the
 * intended behaviour on platforms without process groups, so announcing it on
 * every invocation is noise rather than a warning users can act on.
 */
export function isLifecycleDebugEnabled(env = process.env) {
  const v = env.NDX_DEBUG_LIFECYCLE ?? env.NDX_DEBUG;
  return v === "1" || v === "true" || v === "yes";
}

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

/** Report which termination strategy ran (opt-in; see isLifecycleDebugEnabled). */
function traceStrategy(message) {
  if (isLifecycleDebugEnabled()) {
    process.stderr.write(`[child-lifecycle] ${message}\n`);
  }
}

/**
 * Whether a process group still has any member.
 *
 * Signal 0 runs the kernel's existence/permission check without delivering
 * anything, so this is a probe rather than a kill.
 *
 * PID-REUSE SAFETY: a pgid stays allocated for as long as the group has
 * members, and a pgid is its leader's PID, so that PID cannot be recycled
 * underneath us while anyone is still in the group. Probing immediately before
 * signalling therefore cannot target an unrelated process. If the group drains
 * in between, the follow-up signal fails with ESRCH and is swallowed.
 */
function groupHasMembers(pgid, killGroup) {
  try {
    killGroup(pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Wait (bounded) for every member of a process group to exit.
 *
 * Polls rather than awaiting the child's "exit" event: the direct child is only
 * one member, and a tree kill has to care about all of them.
 */
async function waitForGroupExit(pgid, killGroup, timeoutMs, intervalMs = 25) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!groupHasMembers(pgid, killGroup)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    await delay(Math.min(intervalMs, remaining));
  }
}

/**
 * Terminate an entire process group rooted at the child's PID.
 *
 * Sends SIGTERM to the process group (process.kill(-pgid, signal)), which
 * delivers the signal to every process in the group — including grandchildren
 * spawned by the child.  Falls back to direct kill if the group kill fails.
 *
 * Only effective when the child was spawned with `detached: true`, which makes
 * it the leader of a new process group — see {@link treeKillSpawnOptions}.
 */
async function terminateProcessGroup(child, forceKillTimeoutMs, killGroup) {
  if (!isChildRunning(child)) return;

  if (!child.pid) {
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  const pgid = -child.pid;
  traceStrategy(`process group kill ${pgid} (SIGTERM, then SIGKILL)`);

  try {
    killGroup(pgid, "SIGTERM");
  } catch {
    // Group kill failed (e.g. child already exited or pgid not available).
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  // Wait on the GROUP, not the direct child. The leader commonly installs a
  // SIGTERM handler and exits promptly while a grandchild ignores the signal,
  // so the child's exit says nothing about whether the tree is gone.
  await waitForGroupExit(pgid, killGroup, forceKillTimeoutMs);

  if (!groupHasMembers(pgid, killGroup)) return;

  try {
    killGroup(pgid, "SIGKILL");
  } catch {
    // Group may have drained between the probe and SIGKILL — ignore.
  }

  await waitForGroupExit(pgid, killGroup, forceKillTimeoutMs);
}

/**
 * Windows counterpart to a POSIX process-group kill: `taskkill /T /F`.
 *
 * `/T` terminates the whole tree rooted at the PID, which is the closest
 * analogue to signalling a process group. Windows has no equivalent of the
 * POSIX graceful phase:
 *
 * - `process.kill(pid, "SIGTERM")` is `TerminateProcess` on Windows — the
 *   target gets no chance to run cleanup handlers, so a "graceful" SIGTERM pass
 *   buys nothing while still burning the grace period.
 * - `taskkill /T` without `/F` posts WM_CLOSE, which only a process pumping a
 *   window-message loop acts on. Node children do not, so it would time out.
 *
 * So this goes straight to `/F` and the absence of a graceful phase on Windows
 * is a documented limitation, not an oversight.
 *
 * NOT USED: Job Objects are the architecturally correct primitive — a job with
 * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` reaps its whole tree with semantics
 * exactly analogous to a process group. They are rejected here because they
 * require a native addon, which would put a compiled dependency in the
 * orchestration tier of a pure-JS package.
 *
 * LIMITATION: taskkill is spawned during shutdown. If the ndx process is itself
 * force-killed (`TerminateProcess`, Task Manager "End task", or a parent's own
 * `taskkill /F`), no handler runs and this never executes — the tree then
 * survives unless the host placed it in a Job Object.
 */
async function terminateWindowsTree(child, forceKillTimeoutMs, spawnCliImpl) {
  if (!isChildRunning(child)) return;

  if (!child.pid) {
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  traceStrategy(`taskkill /PID ${child.pid} /T /F`);

  try {
    // Routed through win-spawn.js rather than a hand-built command line:
    // repo policy (the DEP0190 guard in tests/e2e/architecture-policy.test.js)
    // bans ad-hoc Windows command strings.
    const killer = spawnCliImpl(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );

    // Bounded: a taskkill that never reports back must not wedge shutdown.
    // Any exit code counts as done — a non-zero status usually means
    // "process not found" (128), which during shutdown is a normal race, not
    // an error worth surfacing or throwing on.
    await Promise.race([
      new Promise((resolve) => {
        killer.once("close", resolve);
        killer.once("error", resolve);
      }),
      delay(forceKillTimeoutMs),
    ]);
  } catch {
    // taskkill itself could not be spawned — fall through to the direct kill.
  }

  await Promise.race([
    waitForChildExit(child),
    delay(forceKillTimeoutMs),
  ]);

  if (!isChildRunning(child)) return;

  // taskkill did not get it (or never ran): still deal with the direct child.
  return terminateChildProcess(child, forceKillTimeoutMs);
}

/**
 * Terminate a child and every process beneath it, using whichever primitive the
 * platform provides.
 *
 * This is the single termination contract: callers never choose between a group
 * kill and a direct kill, and never test `process.platform`. POSIX signals the
 * process group; Windows runs `taskkill /T /F`. Both fall back to killing the
 * direct child if the tree-wide attempt fails or leaves it running.
 *
 * Children must be spawned with {@link treeKillSpawnOptions} for the POSIX path
 * to reach grandchildren.
 *
 * @param {import("child_process").ChildProcess} child
 * @param {object} [options]
 * @param {number} [options.forceKillTimeoutMs=5000] Grace period before escalating.
 * @param {NodeJS.Platform} [options.platform] Overridable so both strategies are
 *   testable on any host — CI runs the suite on Linux only, so without this seam
 *   the Windows branch would ship untested.
 * @param {Function} [options.spawnCliImpl] Injectable spawn (defaults to win-spawn's spawnCli).
 * @param {Function} [options.killGroup] Injectable group signaller (defaults to process.kill).
 * @returns {Promise<void>}
 */
export async function terminateTree(child, {
  forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
  platform = process.platform,
  spawnCliImpl = spawnCli,
  killGroup = (pid, signal) => process.kill(pid, signal),
} = {}) {
  if (!isChildRunning(child)) return;

  return supportsProcessGroups(platform)
    ? terminateProcessGroup(child, forceKillTimeoutMs, killGroup)
    : terminateWindowsTree(child, forceKillTimeoutMs, spawnCliImpl);
}

/**
 * Create a tracker that registers and cleans up child processes.
 *
 * @param {object} [options]
 * @param {number} [options.forceKillTimeoutMs=5000] - Grace period before escalating to SIGKILL.
 * @param {boolean} [options.treeKill=false] - When true, terminate the child's entire process
 *   tree via {@link terminateTree} instead of only the direct child. Spawn such children with
 *   {@link treeKillSpawnOptions} so the POSIX path can reach grandchildren. Named for the intent
 *   rather than the POSIX mechanism: Windows has no process groups but does tree-kill.
 */
export function createChildProcessTracker({
  forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
  treeKill = false,
} = {}) {
  const terminate = treeKill
    ? (child, timeoutMs) => terminateTree(child, { forceKillTimeoutMs: timeoutMs })
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
