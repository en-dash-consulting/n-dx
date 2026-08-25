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

/**
 * Await `promise`, giving up after `timeoutMs`, always clearing the timer.
 *
 * `Promise.race([p, delay(ms)])` looks equivalent but leaks: when `p` wins, the
 * losing timer stays armed, and an armed timer holds the event loop open. A CLI
 * that finished its work immediately after a kill therefore sat idle for the
 * whole grace period before exiting — 5s by default.
 *
 * Only the RACED waits need this. The polling `delay()` calls below are awaited
 * directly, so their timer always fires and never outlives its await.
 */
function raceWithTimeout(promise, timeoutMs) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).then(() => undefined),
    new Promise((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The ONE SIGTERM → grace → SIGKILL escalation in this package.
 *
 * Written against three injected capabilities rather than a concrete target, so a
 * live ChildProcess and a bare PID read from a pid file share the same sequence
 * instead of each growing its own copy. `ndx start stop` previously had a second
 * implementation in web.js, which meant Windows deficiencies had to be fixed twice
 * and were not.
 *
 * @param {object} target
 * @param {(signal: string) => boolean} target.signal Deliver a signal. Returns
 *   false when the target is already gone, which ends the sequence.
 * @param {() => boolean} target.isAlive Liveness check.
 * @param {(timeoutMs: number) => Promise<void>} target.waitForExit Resolve when the
 *   target exits or the timeout elapses — event-driven for a ChildProcess, polling
 *   for a PID.
 * @param {number} forceKillTimeoutMs Grace period before SIGKILL, and the bound on
 *   the wait after it.
 * @returns {Promise<boolean>} Whether the target is gone.
 */
async function escalateTermination({ signal, isAlive, waitForExit }, forceKillTimeoutMs) {
  if (!isAlive()) return true;
  if (!signal("SIGTERM")) return !isAlive();

  await waitForExit(forceKillTimeoutMs);
  if (!isAlive()) return true;

  // SIGTERM is advisory: a process can ignore it, and on Windows it is
  // TerminateProcess anyway, so reaching here means the graceful phase is over.
  if (!signal("SIGKILL")) return !isAlive();

  await waitForExit(forceKillTimeoutMs);
  return !isAlive();
}

/** Escalation adapter for a live ChildProcess: signals via the handle, waits on events. */
function childTarget(child) {
  return {
    signal: (sig) => {
      try {
        child.kill(sig);
        return true;
      } catch {
        return false; // already gone
      }
    },
    isAlive: () => isChildRunning(child),
    waitForExit: (timeoutMs) => raceWithTimeout(waitForChildExit(child), timeoutMs),
  };
}

/**
 * Escalation adapter for a bare PID.
 *
 * Polls, because there is no handle to listen on. `kill(pid, 0)` is a probe rather
 * than a signal, and it CANNOT distinguish a live process from a zombie or from a
 * recycled PID — so callers that own a pid file must keep their own staleness
 * handling rather than treating "alive" here as authoritative.
 */
function pidTarget(pid, killImpl, pollIntervalMs) {
  const isAlive = () => {
    try {
      killImpl(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  return {
    isAlive,
    signal: (sig) => {
      try {
        killImpl(pid, sig);
        return true;
      } catch {
        return false;
      }
    },
    waitForExit: async (timeoutMs) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!isAlive()) return;
        await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      }
    },
  };
}

async function terminateChildProcess(child, forceKillTimeoutMs) {
  await escalateTermination(childTarget(child), forceKillTimeoutMs);
}

/**
 * Report which termination strategy ran (opt-in; see isLifecycleDebugEnabled).
 *
 * `env` is threaded from the caller rather than read from `process.env` here so a
 * test can enable the notice by passing a plain object. Reading the real env forced
 * tests to `vi.stubEnv`, which mutates the vitest WORKER's env — and sibling e2e
 * files in that worker spawn CLIs with `{ ...process.env }`, so a child could
 * inherit the flag and print a notice the gating existed to suppress. That window
 * is concurrent, not sequential, so `vi.unstubAllEnvs()` in afterEach does not
 * close it. Threading removes the channel instead of scheduling around it.
 *
 * @param {string} message
 * @param {NodeJS.ProcessEnv} [env]
 */
function traceStrategy(message, env) {
  if (isLifecycleDebugEnabled(env)) {
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
async function terminateProcessGroup(child, forceKillTimeoutMs, killGroup, env) {
  if (!isChildRunning(child)) return;

  if (!child.pid) {
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  const pgid = -child.pid;
  traceStrategy(`process group kill ${pgid} (SIGTERM, then SIGKILL)`, env);

  if (!groupHasMembers(pgid, killGroup)) {
    // No group of its own (not spawned detached) or already drained — deal with
    // the direct child instead.
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  // Same escalation as everywhere else, with the GROUP as the target rather than
  // the direct child: the leader commonly installs a SIGTERM handler and exits
  // promptly while a grandchild ignores the signal, so the child's exit says
  // nothing about whether the tree is gone.
  const drained = await escalateTermination(groupTarget(pgid, killGroup, forceKillTimeoutMs), forceKillTimeoutMs);
  if (drained) return;

  // Group did not drain — the direct child is still the caller's handle.
  return terminateChildProcess(child, forceKillTimeoutMs);
}

/** Escalation adapter for a POSIX process group. */
function groupTarget(pgid, killGroup, forceKillTimeoutMs) {
  return {
    signal: (sig) => {
      try {
        killGroup(pgid, sig);
        return true;
      } catch {
        return false; // group drained between probe and signal
      }
    },
    isAlive: () => groupHasMembers(pgid, killGroup),
    waitForExit: (timeoutMs) =>
      waitForGroupExit(pgid, killGroup, Math.min(timeoutMs, forceKillTimeoutMs)),
  };
}

/**
 * The Windows tree-kill command, as argv.
 *
 * TWIN: mirrored by `treeKillCommand` in
 * `packages/llm-client/src/process-tree.ts`. The two exist separately because the
 * orchestration tier must not import from packages (spawn-only rule) — the same
 * constraint that forces the `quoteWindowsToken` twin. Any change here MUST be
 * mirrored there; `tests/unit/tree-kill-parity.test.js` fails if they diverge.
 *
 * @param {number} pid
 * @returns {{ command: string, args: string[] }}
 */
export function treeKillCommand(pid) {
  return { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
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
/**
 * Run `taskkill /T /F` against a pid and wait, bounded, for it to report back.
 *
 * Shared by the ChildProcess and PID paths so the Windows tree kill is invoked in
 * exactly one place. Never throws: a taskkill that cannot spawn leaves the caller
 * to fall back to signalling directly.
 */
async function runWindowsTreeKill(pid, forceKillTimeoutMs, spawnCliImpl) {
  try {
    // Routed through win-spawn.js rather than a hand-built command line:
    // repo policy (the DEP0190 guard in tests/e2e/architecture-policy.test.js)
    // bans ad-hoc Windows command strings.
    const { command, args } = treeKillCommand(pid);
    const killer = spawnCliImpl(command, args, { stdio: "ignore", windowsHide: true });

    // Bounded: a taskkill that never reports back must not wedge shutdown.
    // Any exit code counts as done — a non-zero status usually means
    // "process not found" (128), which during shutdown is a normal race, not
    // an error worth surfacing or throwing on.
    await raceWithTimeout(
      new Promise((resolve) => {
        killer.once("close", resolve);
        killer.once("error", resolve);
      }),
      forceKillTimeoutMs,
    );
  } catch {
    // taskkill itself could not be spawned — caller falls back to a direct kill.
  }
}

async function terminateWindowsTree(child, forceKillTimeoutMs, spawnCliImpl, env) {
  if (!isChildRunning(child)) return;

  if (!child.pid) {
    return terminateChildProcess(child, forceKillTimeoutMs);
  }

  traceStrategy(`taskkill /PID ${child.pid} /T /F`, env);
  await runWindowsTreeKill(child.pid, forceKillTimeoutMs, spawnCliImpl);

  await raceWithTimeout(waitForChildExit(child), forceKillTimeoutMs);

  if (!isChildRunning(child)) return;

  // taskkill did not get it (or never ran): still deal with the direct child.
  return terminateChildProcess(child, forceKillTimeoutMs);
}

/**
 * Terminate a process tree given only a PID — the pid-file case.
 *
 * Same contract as {@link terminateTree}, for callers that never held the
 * ChildProcess: `ndx start stop` reads `.n-dx-web.pid` written by an earlier,
 * unrelated process. It shares {@link escalateTermination}, so there is one
 * SIGTERM-grace-SIGKILL sequence in this package rather than one per call site.
 *
 * WHAT THIS FIXES ON WINDOWS: signalling the recorded PID alone orphaned every
 * child the server had spawned, because SIGTERM there is TerminateProcess (no
 * cleanup handlers run) and nothing walks the tree. `taskkill /T` does. The
 * background server is also spawned `detached: true`, which takes it OUT of
 * libuv's job object, so nothing else would have reaped its children either.
 *
 * A PID IS WEAKER EVIDENCE THAN A HANDLE, and the difference is not papered over:
 * `kill(pid, 0)` cannot tell a live process from a zombie or from a recycled PID.
 * Callers owning a pid file must keep their own staleness checks; a true return
 * here means "not signallable any more", not "the process we meant is gone".
 *
 * WHICH MEANS: DO NOT REPORT A FALSE RETURN AS "STILL RUNNING". SIGKILL is
 * unblockable, so by the time this resolves the process is done in every sense a
 * caller cares about; a pid that still answers signal 0 is as likely to be an
 * exited-but-unreaped zombie, or a PID now owned by something unrelated. Both
 * stop paths (`cli.js`, `web.js`) therefore discard the result, and
 * tests/unit/terminate-by-pid-result-unused.test.js keeps them that way —
 * `web.js` once warned "did not exit" on this basis, one line above the "Stopped"
 * line it printed anyway.
 *
 * A caller that genuinely needs to report a failed stop should probe with signal
 * 0 BEFORE killing, which is where the meaningful distinction lives: `cli.js`
 * separates EPERM ("exists, not ours to signal" — a real failure) from ESRCH
 * ("already gone" — success).
 *
 * @param {number} pid
 * @param {object} [options]
 * @param {number} [options.forceKillTimeoutMs=5000] Grace period before SIGKILL.
 * @param {NodeJS.Platform} [options.platform] Overridable so both strategies are
 *   testable on any host.
 * @param {Function} [options.spawnCliImpl] Injectable spawn (defaults to win-spawn's spawnCli).
 * @param {Function} [options.killImpl] Injectable signaller (defaults to process.kill).
 * @param {number} [options.pollIntervalMs=100] Liveness poll interval.
 * @returns {Promise<boolean>} Whether the pid stopped answering signal 0 — NOT
 *   whether the intended process exited. See the contract above before using it.
 */
export async function terminateTreeByPid(pid, {
  forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
  platform = process.platform,
  spawnCliImpl = spawnCli,
  killImpl = (targetPid, signal) => process.kill(targetPid, signal),
  pollIntervalMs = 100,
  env = process.env,
} = {}) {
  const target = pidTarget(pid, killImpl, pollIntervalMs);
  if (!target.isAlive()) return true;

  if (supportsProcessGroups(platform)) {
    // Signal the GROUP first when the process leads one — the background server is
    // spawned detached, so on POSIX it does. Falls through to the pid itself when
    // there is no group (ESRCH), which the escalation below handles.
    const group = pidTarget(-pid, killImpl, pollIntervalMs);
    if (group.isAlive()) {
      traceStrategy(`process group kill ${-pid} (SIGTERM, then SIGKILL)`, env);
      await escalateTermination(
        { ...group, isAlive: target.isAlive },
        forceKillTimeoutMs,
      );
      if (!target.isAlive()) return true;
    }
    return escalateTermination(target, forceKillTimeoutMs);
  }

  traceStrategy(`taskkill /PID ${pid} /T /F`, env);
  await runWindowsTreeKill(pid, forceKillTimeoutMs, spawnCliImpl);
  await target.waitForExit(forceKillTimeoutMs);
  if (!target.isAlive()) return true;

  // taskkill did not get it (or never ran): fall back to signalling the pid.
  return escalateTermination(target, forceKillTimeoutMs);
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
 * @param {NodeJS.ProcessEnv} [options.env] Environment consulted for the debug-notice
 *   gate. Injectable so a test can enable the notice without mutating the worker's
 *   real env, which sibling e2e files leak into spawned children — see traceStrategy.
 * @returns {Promise<void>}
 */
export async function terminateTree(child, {
  forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
  platform = process.platform,
  spawnCliImpl = spawnCli,
  killGroup = (pid, signal) => process.kill(pid, signal),
  env = process.env,
} = {}) {
  if (!isChildRunning(child)) return;

  return supportsProcessGroups(platform)
    ? terminateProcessGroup(child, forceKillTimeoutMs, killGroup, env)
    : terminateWindowsTree(child, forceKillTimeoutMs, spawnCliImpl, env);
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
  env = process.env,
} = {}) {
  const terminate = treeKill
    ? (child, timeoutMs) => terminateTree(child, { forceKillTimeoutMs: timeoutMs, env })
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
