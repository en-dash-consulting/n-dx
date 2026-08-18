/**
 * Terminate a child process and everything beneath it.
 *
 * Killing a process does not kill what it started. Signalling only the direct
 * child leaves its descendants running — still holding file handles, still
 * writing to the workspace — which for an autonomous agent means work continuing
 * underneath a caller that has already been told the command stopped.
 *
 * This is the single termination contract for the foundation tier: callers ask
 * for a tree kill and never test `process.platform` themselves. POSIX signals the
 * process group; Windows runs `taskkill /T /F`. Both fall back to killing the
 * direct child if the tree-wide attempt fails or leaves it running.
 *
 * ## Windows: libuv reaps some trees for you, but not the ones that matter
 *
 * libuv assigns every non-detached child it spawns to a global job object with
 * KILL_ON_JOB_CLOSE, so a tree of node processes collapses when the middle one
 * dies. That covers node-spawned node, and nothing else: `sh`, `cmd`, `make`,
 * python, and pnpm/npm shims all use plain CreateProcess, and their children
 * survive. Measured on Windows with a 700ms timeout — a node intermediate left a
 * dead grandchild after 4 writes; `sh` in the same position left a live one that
 * went on to write 15. Since the interesting commands are exactly the ones behind
 * a shell, the job object cannot be relied on.
 *
 * ## TWIN
 *
 * This logic is intentionally duplicated in `packages/core/child-lifecycle.js`
 * (`terminateTree`): the orchestration tier must not import from packages
 * (spawn-only rule), which rules out consuming this module from there. The same
 * constraint already forces a twin of `quoteWindowsToken` — see
 * `tests/unit/windows-quoting-parity.test.js`. Both twins derive the Windows kill
 * argv from {@link treeKillCommand}, and `tests/unit/tree-kill-parity.test.js`
 * fails if they diverge.
 *
 * @module @n-dx/llm-client/process-tree
 */

import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";

/** Grace period before escalating a tree kill, and the bound on each wait. */
const DEFAULT_FORCE_KILL_TIMEOUT_MS = 5_000;

/** How often {@link waitForGroupExit} re-probes the group. */
const GROUP_POLL_INTERVAL_MS = 25;

/**
 * Whether `platform` supports POSIX process groups.
 *
 * Deliberately NOT exported: callers should ask for a tree kill and let this
 * module pick the strategy. An exported capability flag invites callers to branch
 * on the platform themselves, which is how scattered platform conditionals start.
 */
function supportsProcessGroups(platform: NodeJS.Platform): boolean {
  return platform !== "win32";
}

/**
 * Spawn options a child needs in order to be tree-killable later.
 *
 * POSIX: `detached: true` makes the child a process-group leader, which is what
 * lets `process.kill(-pgid)` reach grandchildren. Windows: nothing — `detached`
 * there means "new console", not "new process group", and taskkill walks the tree
 * by PID regardless. Worse, a detached child on Windows would escape libuv's job
 * object, so passing `detached` there would remove protection rather than add it.
 */
export function treeKillSpawnOptions(
  platform: NodeJS.Platform = process.platform,
): { detached?: boolean } {
  return supportsProcessGroups(platform) ? { detached: true } : {};
}

/**
 * The Windows tree-kill command, as argv.
 *
 * `/T` terminates the whole tree rooted at the PID — the closest analogue to
 * signalling a process group. `/F` is not optional: `taskkill /T` without it
 * posts WM_CLOSE, which only a process pumping a window-message loop acts on, and
 * node children do not. Windows has no graceful phase to skip here either, since
 * `process.kill(pid, "SIGTERM")` is already `TerminateProcess`.
 *
 * Factored out so the orchestration-tier twin can be compared against it — see
 * the TWIN note in the module docblock.
 */
export function treeKillCommand(pid: number): { command: string; args: string[] } {
  return { command: "taskkill", args: ["/PID", String(pid), "/T", "/F"] };
}

/** Injectable seams. Defaults are the real thing; tests replace them. */
export interface TerminateTreeOptions {
  /** Grace period before escalating, and the bound on each wait phase. */
  forceKillTimeoutMs?: number;
  /**
   * Overridable so both strategies are exercised on any host. CI runs on a
   * single platform at a time, so without this seam one branch ships untested.
   */
  platform?: NodeJS.Platform;
  /** Injectable spawn for the Windows path. */
  spawnImpl?: typeof spawn;
  /** Injectable group signaller for the POSIX path. */
  killGroup?: (pid: number, signal: NodeJS.Signals | 0) => void;
}

function isChildRunning(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForChildExit(child: ChildProcess): Promise<void> {
  if (!isChildRunning(child)) return Promise.resolve();

  return new Promise((resolve) => {
    const done = (): void => {
      child.removeListener("close", done);
      child.removeListener("exit", done);
      resolve();
    };
    child.once("close", done);
    child.once("exit", done);
  });
}

/** SIGTERM the direct child, escalating to SIGKILL if it outlives the grace period. */
async function terminateChildProcess(
  child: ChildProcess,
  forceKillTimeoutMs: number,
): Promise<void> {
  if (!isChildRunning(child)) return;

  try {
    child.kill("SIGTERM");
  } catch {
    return; // already gone
  }

  await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);
  if (!isChildRunning(child)) return;

  try {
    child.kill("SIGKILL");
  } catch {
    return;
  }

  await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);
}

/**
 * Whether a process group still has any member.
 *
 * Signal 0 runs the kernel's existence/permission check without delivering
 * anything, so this is a probe rather than a kill.
 *
 * PID-REUSE SAFETY: a pgid stays allocated while the group has members, and a
 * pgid is its leader's PID, so that PID cannot be recycled underneath us while
 * anyone is still in the group. Probing immediately before signalling therefore
 * cannot target an unrelated process. If the group drains in between, the
 * follow-up signal fails with ESRCH and is swallowed.
 */
function groupHasMembers(
  pgid: number,
  killGroup: NonNullable<TerminateTreeOptions["killGroup"]>,
): boolean {
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
async function waitForGroupExit(
  pgid: number,
  killGroup: NonNullable<TerminateTreeOptions["killGroup"]>,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (!groupHasMembers(pgid, killGroup)) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    await delay(Math.min(GROUP_POLL_INTERVAL_MS, remaining));
  }
}

/** Run a command and return its stdout, bounded. Empty string on any failure. */
function captureStdout(
  spawnImpl: typeof spawn,
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve) => {
    let out = "";
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(out);
    };

    try {
      const proc = spawnImpl(command, args, { stdio: ["ignore", "pipe", "ignore"] });
      proc.stdout?.on("data", (chunk: Buffer) => {
        out += chunk.toString();
      });
      proc.once("close", finish);
      proc.once("error", () => {
        out = "";
        finish();
      });
      setTimeout(finish, timeoutMs);
    } catch {
      finish();
    }
  });
}

/**
 * Every descendant pid of `rootPid`, deepest last.
 *
 * `ps -A -o pid=,ppid=` is the portable form: the `=` suppresses headers, and it
 * behaves the same on Linux and macOS. Reading /proc would avoid the spawn but is
 * Linux-only.
 *
 * Used because a process group is not always available — see
 * {@link terminatePosixTree}.
 */
async function posixDescendants(
  rootPid: number,
  spawnImpl: typeof spawn,
  timeoutMs: number,
): Promise<number[]> {
  const listing = await captureStdout(spawnImpl, "ps", ["-A", "-o", "pid=,ppid="], timeoutMs);
  if (!listing) return [];

  const childrenOf = new Map<number, number[]>();
  for (const line of listing.split("\n")) {
    const [pidText, ppidText] = line.trim().split(/\s+/);
    const pid = Number.parseInt(pidText ?? "", 10);
    const ppid = Number.parseInt(ppidText ?? "", 10);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    const siblings = childrenOf.get(ppid);
    if (siblings) siblings.push(pid);
    else childrenOf.set(ppid, [pid]);
  }

  // Breadth-first, so the returned order is shallowest-first; callers signal in
  // reverse to take leaves before their parents.
  const found: number[] = [];
  const queue = [rootPid];
  const seen = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const next = queue.shift()!;
    for (const kid of childrenOf.get(next) ?? []) {
      if (seen.has(kid)) continue;
      seen.add(kid);
      found.push(kid);
      queue.push(kid);
    }
  }
  return found;
}

/** Whether a single pid is still alive. Signal 0 is a probe, not a kill. */
function pidIsAlive(
  pid: number,
  signalPid: NonNullable<TerminateTreeOptions["killGroup"]>,
): boolean {
  try {
    signalPid(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * POSIX: signal the whole process group, then sweep any descendant the group kill
 * could not reach.
 *
 * THE GROUP IS OFTEN NOT THERE. A group kill only works when the child was
 * spawned with {@link treeKillSpawnOptions}, and `child_process.execFile` cannot
 * do that: it builds its own options object for `spawn` and silently drops
 * anything outside its curated set, `detached` included. (Verified: passing
 * `stdio: "ignore"` to execFile is likewise ignored and the streams are still
 * piped.) So for every caller that buffers output through execFile, `kill(-pid)`
 * fails with ESRCH and the descendants survive — which is exactly what shipped
 * and what ubuntu CI caught: a timed-out command kept writing 13 more files.
 *
 * The sweep therefore does not depend on how the child was spawned. The group
 * kill is kept as the fast path because it is atomic and cheap when available.
 */
async function terminatePosixTree(
  child: ChildProcess,
  forceKillTimeoutMs: number,
  killGroup: NonNullable<TerminateTreeOptions["killGroup"]>,
  spawnImpl: typeof spawn,
): Promise<void> {
  if (!isChildRunning(child)) return;
  if (!child.pid) return terminateChildProcess(child, forceKillTimeoutMs);

  const rootPid = child.pid;
  const pgid = -rootPid;

  // Collect descendants BEFORE signalling: once the direct child dies its
  // children are reparented to init and the pid->ppid links to it are gone.
  const descendants = await posixDescendants(rootPid, spawnImpl, forceKillTimeoutMs);

  let groupSignalled = false;
  try {
    killGroup(pgid, "SIGTERM");
    groupSignalled = true;
  } catch {
    // No group of its own (the common execFile case) or already exited. The
    // descendant sweep below covers it; do not return early.
  }

  if (groupSignalled) {
    // Wait on the GROUP, not the direct child. A shell commonly exits promptly on
    // SIGTERM while the command it started ignores it, so the child's exit says
    // nothing about whether the tree is gone.
    await waitForGroupExit(pgid, killGroup, forceKillTimeoutMs);
    if (groupHasMembers(pgid, killGroup)) {
      try {
        killGroup(pgid, "SIGKILL");
      } catch {
        // Group may have drained between the probe and the signal — ignore.
      }
      await waitForGroupExit(pgid, killGroup, forceKillTimeoutMs);
    }
  }

  // Sweep whatever the group kill did not reach, leaves before parents so a
  // parent cannot spawn a replacement after its child was taken.
  const stragglers = [...descendants].reverse().filter((pid) => pidIsAlive(pid, killGroup));
  for (const pid of stragglers) {
    try {
      killGroup(pid, "SIGTERM");
    } catch {
      // Already gone.
    }
  }

  if (stragglers.length > 0) {
    const deadline = Date.now() + forceKillTimeoutMs;
    while (Date.now() < deadline && stragglers.some((pid) => pidIsAlive(pid, killGroup))) {
      await delay(Math.min(GROUP_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
    for (const pid of stragglers) {
      if (!pidIsAlive(pid, killGroup)) continue;
      try {
        killGroup(pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }

  // The direct child last: it may have ignored the group signal, and it is the
  // one whose exit the caller is awaiting.
  await terminateChildProcess(child, forceKillTimeoutMs);
}

/**
 * Windows: `taskkill /T /F`, then fall back to the direct child.
 *
 * NOT USED: Job Objects are the architecturally correct primitive — a job with
 * JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE reaps its whole tree with semantics exactly
 * analogous to a process group. Creating one requires a native addon, which would
 * put a compiled dependency in a pure-JS package.
 *
 * LIMITATION: taskkill is spawned during termination. If this process is itself
 * force-killed (TerminateProcess, Task Manager "End task"), no handler runs and
 * this never executes — the tree then survives unless the host placed it in a job
 * object.
 */
async function terminateWindowsTree(
  child: ChildProcess,
  forceKillTimeoutMs: number,
  spawnImpl: typeof spawn,
): Promise<void> {
  if (!isChildRunning(child)) return;
  if (!child.pid) return terminateChildProcess(child, forceKillTimeoutMs);

  try {
    const { command, args } = treeKillCommand(child.pid);
    // Plain argv spawn, not the cmd.exe-wrapping spawnCli: taskkill is a real
    // .exe on PATH rather than a .cmd shim, so the wrapper buys nothing, and
    // importing spawnCli here would put an import cycle between this module and
    // exec.ts. No shell is involved either way.
    const killer = spawnImpl(command, args, { stdio: "ignore", windowsHide: true });

    // Bounded: a taskkill that never reports back must not wedge the caller. Any
    // exit code counts as done — non-zero usually means "process not found",
    // which during termination is a normal race, not an error worth surfacing.
    await Promise.race([
      new Promise<void>((resolve) => {
        killer.once("close", () => resolve());
        killer.once("error", () => resolve());
      }),
      delay(forceKillTimeoutMs),
    ]);
  } catch {
    // taskkill itself could not be spawned — fall through to the direct kill.
  }

  await Promise.race([waitForChildExit(child), delay(forceKillTimeoutMs)]);
  if (!isChildRunning(child)) return;

  // taskkill did not get it (or never ran): still deal with the direct child.
  return terminateChildProcess(child, forceKillTimeoutMs);
}

/**
 * Terminate a child and every process beneath it, using whichever primitive the
 * platform provides.
 *
 * Children must be spawned with {@link treeKillSpawnOptions} for the POSIX path
 * to reach grandchildren. Never rejects.
 */
export async function terminateProcessTree(
  child: ChildProcess,
  {
    forceKillTimeoutMs = DEFAULT_FORCE_KILL_TIMEOUT_MS,
    platform = process.platform,
    spawnImpl = spawn,
    killGroup = (pid, signal) => {
      process.kill(pid, signal);
    },
  }: TerminateTreeOptions = {},
): Promise<void> {
  if (!isChildRunning(child)) return;

  return supportsProcessGroups(platform)
    ? terminatePosixTree(child, forceKillTimeoutMs, killGroup, spawnImpl)
    : terminateWindowsTree(child, forceKillTimeoutMs, spawnImpl);
}
