/**
 * The kill paths in `packages/core/child-lifecycle.js`, against real OS processes.
 *
 * WHY THIS FILE EXISTS. `tests/unit/child-lifecycle.test.js` drives every
 * strategy through FakeChildProcess and injected signallers, and asserts WHICH
 * STRATEGY RAN — so replacing `terminateTree` with a function that records
 * "SIGTERM", records "SIGKILL" and delivers neither leaves that suite green.
 * The module whose one job is not leaking processes then had no test proving it
 * does not leak one. These cases assert death: every one of them fails if the
 * production signal is not delivered to the kernel.
 *
 * SCOPE. POSIX only, deliberately:
 *
 * - The trees here are node-spawns-node. On Windows libuv puts such a tree in a
 *   global job object that reaps it when the parent dies, so a liveness
 *   assertion there passes without proving a kill reached anything — the same
 *   vacuity recorded in `tests/shell-spawn-inventory.md` and in the Job Object
 *   caveat on the Windows tree-kill path. The Windows strategy keeps its
 *   injected-argv assertions in the unit suite, where what it proves is exactly
 *   what it claims: that `taskkill /T /F` was invoked with the right pid.
 * - `terminateTreeByPid`'s pid-file path is also covered end to end by
 *   `tests/e2e/stop-orphan-children.test.js`, but that case needs a POSIX shell
 *   as a non-libuv intermediary and skips without one. The cases here need only
 *   node, so they run on every POSIX host.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  terminateTree,
  terminateTreeByPid,
} from "../../packages/core/child-lifecycle.js";
import {
  isPidRunning,
  reapPids,
  spawnIdleChild,
  spawnOrphanedProcessTree,
  spawnProcessTree,
  waitForPidExit,
} from "../helpers/real-process-tree.js";

/**
 * Grace period before SIGKILL. Far shorter than production's 5s: every fixture
 * here either exits on SIGTERM immediately or ignores it forever, so a longer
 * window only makes the escalation cases slower to finish.
 */
const GRACE_MS = 500;

/** @type {number[]} */
let pidsToReap = [];

afterEach(() => {
  reapPids(pidsToReap);
  pidsToReap = [];
});

const describePosix = process.platform === "win32" ? describe.skip : describe;

describePosix("terminateTree against real processes", () => {
  it("kills a detached child AND its grandchild", async () => {
    const { child, grandchildPid } = await spawnProcessTree();
    pidsToReap = [child.pid, grandchildPid];

    expect(isPidRunning(grandchildPid)).toBe(true);

    await terminateTree(child, { forceKillTimeoutMs: GRACE_MS });

    await Promise.all([
      waitForPidExit(child.pid, "Detached child"),
      // The grandchild is the whole point: it is reachable only through the
      // process group, so this assertion fails if the group signal was recorded
      // rather than delivered.
      waitForPidExit(grandchildPid, "Grandchild"),
    ]);
  });

  it("escalates to a real SIGKILL when the tree ignores SIGTERM", async () => {
    const { child, grandchildPid } = await spawnProcessTree({ ignoreSigterm: true });
    pidsToReap = [child.pid, grandchildPid];

    await terminateTree(child, { forceKillTimeoutMs: GRACE_MS });

    // Both processes have an empty SIGTERM handler, so nothing but an actual
    // SIGKILL can end them — the graceful phase alone leaves this red.
    await Promise.all([
      waitForPidExit(child.pid, "SIGTERM-ignoring child"),
      waitForPidExit(grandchildPid, "SIGTERM-ignoring grandchild"),
    ]);
  });

  it("kills a child that leads no process group of its own", async () => {
    // Not detached: it shares this process's group, so `kill(-pid)` finds nothing
    // and the direct-child fallback is what has to do the work.
    const child = spawnIdleChild();
    pidsToReap = [child.pid];

    await terminateTree(child, { forceKillTimeoutMs: GRACE_MS });

    await waitForPidExit(child.pid, "Group-less child");
  });

  it("kills a group-less child that ignores SIGTERM", async () => {
    const child = spawnIdleChild({ ignoreSigterm: true });
    pidsToReap = [child.pid];

    await terminateTree(child, { forceKillTimeoutMs: GRACE_MS });

    await waitForPidExit(child.pid, "SIGTERM-ignoring group-less child");
  });
});

describePosix("terminateTreeByPid against real processes", () => {
  it("kills a process given only its pid, with no ChildProcess handle held", async () => {
    const { pid } = await spawnOrphanedProcessTree({ withGrandchild: false });
    pidsToReap = [pid];

    expect(isPidRunning(pid)).toBe(true);

    await terminateTreeByPid(pid, { forceKillTimeoutMs: GRACE_MS });

    await waitForPidExit(pid, "Orphaned process addressed by pid");
  });

  it("kills the tree under a pid, not only the pid itself", async () => {
    const { pid, grandchildPid } = await spawnOrphanedProcessTree();
    pidsToReap = [pid, grandchildPid];

    await terminateTreeByPid(pid, { forceKillTimeoutMs: GRACE_MS });

    await Promise.all([
      waitForPidExit(pid, "Orphaned tree root"),
      waitForPidExit(grandchildPid, "Orphaned tree grandchild"),
    ]);
  });

  it("kills a SIGTERM-ignoring tree given only its pid", async () => {
    const { pid, grandchildPid } = await spawnOrphanedProcessTree({ ignoreSigterm: true });
    pidsToReap = [pid, grandchildPid];

    await terminateTreeByPid(pid, { forceKillTimeoutMs: GRACE_MS });

    await Promise.all([
      waitForPidExit(pid, "SIGTERM-ignoring tree root"),
      waitForPidExit(grandchildPid, "SIGTERM-ignoring tree grandchild"),
    ]);
  });
});
