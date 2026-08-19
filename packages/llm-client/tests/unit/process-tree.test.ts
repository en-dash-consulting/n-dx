import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import {
  terminateProcessTree,
  treeKillSpawnOptions,
  treeKillCommand,
} from "../../src/process-tree.js";

/**
 * Both platform branches run here, on whatever host this is.
 *
 * The platform, the group signaller, and the spawn are all injected, because CI
 * runs one OS at a time and the branch that is not the host's would otherwise
 * ship untested — which is how the orphan-on-timeout defect survived in the first
 * place. Real-process behaviour is covered in
 * tests/integration/exec-timeout-tree-kill.test.ts.
 */

/**
 * Minimal stand-in for a live ChildProcess. `pid` has no default: passing
 * `undefined` to a defaulted parameter silently yields the default, which made
 * the no-pid case exercise the pid path instead.
 */
function fakeChild(pid: number | undefined): ChildProcess & {
  kills: (NodeJS.Signals | number)[];
  simulateExit: () => void;
} {
  const emitter = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const kills: (NodeJS.Signals | number)[] = [];

  Object.assign(emitter, {
    pid,
    exitCode: null,
    signalCode: null,
    kills,
    kill(signal?: NodeJS.Signals) {
      kills.push(signal ?? "SIGTERM");
      return true;
    },
    simulateExit() {
      (emitter as { exitCode: number | null }).exitCode = 0;
      emitter.emit("exit");
      emitter.emit("close");
    },
  });

  return emitter as unknown as ChildProcess & {
    kills: (NodeJS.Signals | number)[];
    simulateExit: () => void;
  };
}

/**
 * A group signaller backed by a membership flag, so escalation can be driven the
 * way the real thing is: signal 0 is a probe, not a kill.
 */
function fakeGroup({ drainsOn }: { drainsOn: NodeJS.Signals | null }) {
  const calls: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
  let hasMembers = true;

  return {
    calls,
    kill(pid: number, signal: NodeJS.Signals | 0): void {
      if (signal === 0) {
        if (!hasMembers) throw new Error("ESRCH");
        return;
      }
      calls.push({ pid, signal });
      if (signal === drainsOn) hasMembers = false;
    },
  };
}

describe("treeKillSpawnOptions", () => {
  it("makes the child a process-group leader on POSIX", () => {
    expect(treeKillSpawnOptions("linux")).toEqual({ detached: true });
    expect(treeKillSpawnOptions("darwin")).toEqual({ detached: true });
  });

  it("adds nothing on Windows", () => {
    // `detached` on Windows means "new console", not "new process group", and it
    // would take the child out of libuv's job object — strictly worse.
    expect(treeKillSpawnOptions("win32")).toEqual({});
  });
});

describe("treeKillCommand", () => {
  it("terminates the tree forcibly", () => {
    expect(treeKillCommand(1234)).toEqual({
      command: "taskkill",
      args: ["/PID", "1234", "/T", "/F"],
    });
  });
});

describe("terminateProcessTree — POSIX", () => {
  /**
   * A `ps -A -o pid=,ppid=` stand-in. Injected in every POSIX case: without it
   * these tests shell out to the host's real ps, which makes them depend on the
   * machine's actual process table.
   */
  function fakePs(listing: string | string[]) {
    const calls: string[][] = [];
    // An array scripts successive passes, so a table that GROWS between reads can
    // be modelled — that is what proves the loop runs to a fixpoint rather than a
    // fixed number of rounds. The last entry repeats once exhausted.
    const listings = Array.isArray(listing) ? listing : [listing];
    const impl = ((command: string, args: string[]) => {
      const text = listings[Math.min(calls.length, listings.length - 1)]!;
      calls.push([command, ...args]);
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
      proc.stdout = new EventEmitter();
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from(text));
        proc.emit("close", 0);
      }, 1);
      return proc as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as typeof import("node:child_process").spawn;
    return { impl, calls };
  }

  /** No descendants — the root pid is the only entry. */
  const NO_CHILDREN = " 4242     1\n";

  const posix = { platform: "linux" as NodeJS.Platform, forceKillTimeoutMs: 150 };

  it("signals the process group, not just the child", async () => {
    const child = fakeChild(4242);
    const group = fakeGroup({ drainsOn: "SIGTERM" });

    await terminateProcessTree(child, {
      ...posix,
      killGroup: group.kill,
      spawnImpl: fakePs(NO_CHILDREN).impl,
    });

    // Negative pid is what makes this reach descendants rather than just the child.
    expect(group.calls[0]).toEqual({ pid: -4242, signal: "SIGTERM" });
    // The direct child is still dealt with afterwards: it may have ignored the
    // group signal, and it is the handle whose exit the caller awaits.
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("sweeps descendants when there is no process group to signal", async () => {
    // The execFile case: `detached` never reaches spawn, so kill(-pid) fails with
    // ESRCH and the group phase is skipped entirely. Descendants must still die —
    // this is the exact regression ubuntu CI caught.
    const child = fakeChild(4242);
    const alive = new Set([4242, 5000, 6000]);
    const signalled: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
    const killGroup = (pid: number, signal: NodeJS.Signals | 0): void => {
      if (pid < 0) throw new Error("ESRCH"); // not a group leader
      if (signal === 0) {
        if (!alive.has(pid)) throw new Error("ESRCH");
        return;
      }
      signalled.push({ pid, signal });
      alive.delete(pid);
    };

    // 5000 is a child of the root, 6000 a child of 5000.
    const ps = fakePs(" 4242     1\n 5000  4242\n 6000  5000\n 7000     1\n");
    await terminateProcessTree(child, { ...posix, killGroup, spawnImpl: ps.impl });

    // The state column comes from the SAME call as parentage: the freeze path needs
    // both every pass, and asking twice would double the spawns for nothing.
    expect(ps.calls[0]).toEqual(["ps", "-A", "-o", "pid=,ppid=,state="]);
    // Leaves before parents, and the unrelated pid 7000 is untouched.
    expect(signalled.map((s) => s.pid)).toEqual([6000, 5000]);
    expect(signalled.every((s) => s.signal === "SIGTERM")).toBe(true);
  });

  it("escalates a straggler that ignores SIGTERM", async () => {
    const child = fakeChild(4242);
    const stubborn = 5000;
    const signalled: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
    const killGroup = (pid: number, signal: NodeJS.Signals | 0): void => {
      if (pid < 0) throw new Error("ESRCH");
      if (signal === 0) return; // never dies, so the probe always succeeds
      signalled.push({ pid, signal });
    };

    await terminateProcessTree(child, {
      ...posix,
      killGroup,
      spawnImpl: fakePs(` 4242     1\n ${stubborn}  4242\n`).impl,
    });

    expect(signalled).toEqual([
      { pid: stubborn, signal: "SIGTERM" },
      { pid: stubborn, signal: "SIGKILL" },
    ]);
  });

  it("survives a ps that is unavailable or unparsable", async () => {
    // No ps on PATH, or output in an unexpected shape: the direct child must still
    // be terminated rather than the whole call throwing.
    const child = fakeChild(4242);
    const spawnImpl = (() => {
      throw new Error("ENOENT");
    }) as unknown as typeof import("node:child_process").spawn;

    await terminateProcessTree(child, {
      ...posix,
      killGroup: fakeGroup({ drainsOn: "SIGTERM" }).kill,
      spawnImpl,
    });

    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("escalates to SIGKILL when the group outlives SIGTERM", async () => {
    const child = fakeChild(4242);
    const group = fakeGroup({ drainsOn: "SIGKILL" });

    await terminateProcessTree(child, { ...posix, killGroup: group.kill, spawnImpl: fakePs(NO_CHILDREN).impl });

    expect(group.calls.map((c) => c.signal)).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("keeps escalating after the child itself has exited", async () => {
    // The shell exits promptly on SIGTERM while the command it started ignores
    // it. Treating the child's exit as "the tree is gone" is precisely the bug,
    // so the child going away here must not stop the escalation.
    const child = fakeChild(4242);
    const group = fakeGroup({ drainsOn: "SIGKILL" });

    const done = terminateProcessTree(child, { ...posix, killGroup: group.kill, spawnImpl: fakePs(NO_CHILDREN).impl });
    child.simulateExit();
    await done;

    expect(group.calls.map((c) => c.signal)).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("falls back to killing the child when the group signal fails", async () => {
    // No group of its own (child was not spawned detached), or already gone.
    const child = fakeChild(4242);
    const killGroup = vi.fn(() => {
      throw new Error("EPERM");
    });

    await terminateProcessTree(child, { ...posix, killGroup, spawnImpl: fakePs(NO_CHILDREN).impl });

    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("falls back to killing the child when there is no pid", async () => {
    const child = fakeChild(undefined);
    const group = fakeGroup({ drainsOn: "SIGTERM" });

    await terminateProcessTree(child, { ...posix, killGroup: group.kill, spawnImpl: fakePs(NO_CHILDREN).impl });

    expect(group.calls).toEqual([]);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("terminateProcessTree — POSIX freeze-verify-kill", () => {
  const posix = { platform: "linux" as NodeJS.Platform, forceKillTimeoutMs: 300, freeze: true };

  /** Reuses the POSIX describe's ps stand-in via a local copy of the shape. */
  function fakePs(listing: string | string[]) {
    const calls: string[][] = [];
    const listings = Array.isArray(listing) ? listing : [listing];
    const impl = ((command: string, args: string[]) => {
      const text = listings[Math.min(calls.length, listings.length - 1)]!;
      calls.push([command, ...args]);
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
      proc.stdout = new EventEmitter();
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from(text));
        proc.emit("close", 0);
      }, 1);
      return proc as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as typeof import("node:child_process").spawn;
    return { impl, calls };
  }

  /**
   * A signaller that records everything and models a table of live processes.
   * `groupExists` decides whether a negative pid (a process group) is accepted,
   * which is what selects the fast path.
   */
  function recorder({ groupExists }: { groupExists: boolean }) {
    const sent: { pid: number; signal: NodeJS.Signals | 0 }[] = [];
    const dead = new Set<number>();
    return {
      sent,
      dead,
      kill(pid: number, signal: NodeJS.Signals | 0): void {
        if (pid < 0 && !groupExists) throw new Error("ESRCH");
        if (signal === 0) {
          if (dead.has(pid)) throw new Error("ESRCH");
          return;
        }
        sent.push({ pid, signal });
        if (signal === "SIGKILL") dead.add(pid);
      },
    };
  }

  it("freezes and kills the whole group without enumerating, when a group exists", async () => {
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: true });
    const ps = fakePs(" 4242     1  T\n");

    await terminateProcessTree(child, { ...posix, killGroup: sig.kill, spawnImpl: ps.impl });

    // Group membership is inherited rather than listed, so both signals are atomic
    // over the tree and no process table needs reading at all.
    expect(sig.sent).toEqual([
      { pid: -4242, signal: "SIGSTOP" },
      { pid: -4242, signal: "SIGKILL" },
    ]);
    expect(ps.calls).toHaveLength(0);
  });

  it("stops the root, then every descendant, before killing anything", async () => {
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: false });
    const ps = fakePs(" 4242     1  T\n 5000  4242  T\n 6000  5000  T\n 7000     1  S\n");

    await terminateProcessTree(child, { ...posix, killGroup: sig.kill, spawnImpl: ps.impl });

    const stops = sig.sent.filter((x) => x.signal === "SIGSTOP").map((x) => x.pid);
    const kills = sig.sent.filter((x) => x.signal === "SIGKILL").map((x) => x.pid);

    // Root first, then its descendants. 7000 is unrelated and never touched.
    expect(stops).toEqual([4242, 5000, 6000]);
    // Leaves before parents.
    expect(kills).toEqual([6000, 5000, 4242]);
    // Every stop precedes every kill: nothing is killed while the tree can still fork.
    const firstKill = sig.sent.findIndex((x) => x.signal === "SIGKILL");
    const lastStop = sig.sent.map((x) => x.signal).lastIndexOf("SIGSTOP");
    expect(lastStop).toBeLessThan(firstKill);
  });

  it("never sends SIGTERM to a frozen tree", async () => {
    // SIGTERM does not reach a stopped process — it queues until SIGCONT — so
    // sending it here would be a silent no-op that looks like a graceful attempt.
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: false });
    const ps = fakePs(" 4242     1  T\n 5000  4242  T\n");

    await terminateProcessTree(child, { ...posix, killGroup: sig.kill, spawnImpl: ps.impl });

    expect(sig.sent.some((x) => x.signal === "SIGTERM")).toBe(false);
  });

  it("keeps enumerating until a pass discovers nothing new", async () => {
    // The second pass reveals a grandchild the first could not see. A fixed
    // two-round loop would still catch this one; the point is that the loop is
    // driven by discovery, so the third pass (which adds nothing) is what ends it.
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: false });
    const ps = fakePs([
      " 4242     1  T\n 5000  4242  T\n",
      " 4242     1  T\n 5000  4242  T\n 6000  5000  T\n",
      " 4242     1  T\n 5000  4242  T\n 6000  5000  T\n",
    ]);

    await terminateProcessTree(child, { ...posix, killGroup: sig.kill, spawnImpl: ps.impl });

    const stops = sig.sent.filter((x) => x.signal === "SIGSTOP").map((x) => x.pid);
    expect(stops).toEqual([4242, 5000, 6000]);
    // Three reads: one that found 5000, one that found 6000, one that found nothing.
    expect(ps.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("waits for a member that has not stopped yet before killing", async () => {
    // First read shows the child still running ('S'); the freeze is not yet proven,
    // so the kill must wait for a later read rather than trust the SIGSTOP call.
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: false });
    const ps = fakePs([
      " 4242     1  S\n 5000  4242  S\n",
      " 4242     1  S\n 5000  4242  S\n",
      " 4242     1  T\n 5000  4242  T\n",
    ]);

    await terminateProcessTree(child, { ...posix, killGroup: sig.kill, spawnImpl: ps.impl });

    expect(sig.sent.filter((x) => x.signal === "SIGKILL").map((x) => x.pid)).toEqual([5000, 4242]);
    // It re-read the table rather than killing off the first, unproven snapshot.
    expect(ps.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("treats a zombie as frozen rather than waiting for it", async () => {
    // A dead-but-unreaped process cannot execute, so it satisfies what the freeze
    // is for. Insisting on 'T' would spin until its parent reaps it.
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: false });
    const ps = fakePs(" 4242     1  T\n 5000  4242  Z\n");

    await terminateProcessTree(child, { ...posix, killGroup: sig.kill, spawnImpl: ps.impl });

    expect(sig.sent.filter((x) => x.signal === "SIGKILL")).not.toEqual([]);
    // Two reads at most: the fixpoint pass, and nothing more — no waiting on 'Z'.
    expect(ps.calls.length).toBeLessThanOrEqual(3);
  });

  it("gives up in bounded time when a member refuses to stop", async () => {
    // Nothing ever reads as stopped. The kill still happens — a bounded best-effort
    // beats hanging — but this is the case where the guarantee has degraded.
    const child = fakeChild(4242);
    const sig = recorder({ groupExists: false });
    const ps = fakePs(" 4242     1  R\n 5000  4242  R\n");

    const started = Date.now();
    await terminateProcessTree(child, {
      ...posix,
      forceKillTimeoutMs: 150,
      killGroup: sig.kill,
      spawnImpl: ps.impl,
    });

    expect(sig.sent.filter((x) => x.signal === "SIGKILL")).not.toEqual([]);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("freeze and graceful are distinct policies", () => {
  function fakePs(listing: string) {
    const impl = ((command: string, args: string[]) => {
      const proc = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
      proc.stdout = new EventEmitter();
      setTimeout(() => {
        proc.stdout.emit("data", Buffer.from(listing));
        proc.emit("close", 0);
      }, 1);
      return proc as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as typeof import("node:child_process").spawn;
    return { impl };
  }

  /** Signals sent for one policy against the same two-process tree. */
  async function signalsFor(freeze: boolean): Promise<(NodeJS.Signals | 0)[]> {
    const child = fakeChild(4242);
    const sent: (NodeJS.Signals | 0)[] = [];
    const dead = new Set<number>();
    const killGroup = (pid: number, signal: NodeJS.Signals | 0): void => {
      if (pid < 0) throw new Error("ESRCH"); // no group either way
      if (signal === 0) {
        if (dead.has(pid)) throw new Error("ESRCH");
        return;
      }
      sent.push(signal);
      if (signal === "SIGKILL") dead.add(pid);
    };

    await terminateProcessTree(child, {
      platform: "linux",
      forceKillTimeoutMs: 150,
      freeze,
      killGroup,
      spawnImpl: fakePs(" 4242     1  T\n 5000  4242  T\n").impl,
    });
    return sent;
  }

  it("freeze uses SIGSTOP then SIGKILL; graceful uses SIGTERM first and never SIGSTOP", async () => {
    // These two must not converge. Graceful shutdown wants the flush a SIGTERM
    // handler performs; the freeze path cannot offer one, because a stopped process
    // does not act on SIGTERM. A future refactor that unified them would break one
    // or the other silently, so the difference is pinned here.
    const frozen = await signalsFor(true);
    const graceful = await signalsFor(false);

    expect(frozen).toContain("SIGSTOP");
    expect(frozen).not.toContain("SIGTERM");

    expect(graceful).toContain("SIGTERM");
    expect(graceful).not.toContain("SIGSTOP");
  });
});

describe("terminateProcessTree — Windows", () => {
  const win = { platform: "win32" as NodeJS.Platform, forceKillTimeoutMs: 150 };

  /** A spawn stand-in whose taskkill reports back immediately. */
  function fakeSpawn(onSpawn?: (cmd: string, args: string[]) => void) {
    const calls: { cmd: string; args: string[] }[] = [];
    const impl = ((cmd: string, args: string[]) => {
      calls.push({ cmd, args });
      onSpawn?.(cmd, args);
      const killer = new EventEmitter();
      setTimeout(() => killer.emit("close", 0), 5);
      return killer as unknown as ReturnType<typeof import("node:child_process").spawn>;
    }) as unknown as typeof import("node:child_process").spawn;
    return { impl, calls };
  }

  it("runs taskkill against the whole tree", async () => {
    const child = fakeChild(777);
    // taskkill really does end the tree: mark the child gone when it runs.
    const spawn = fakeSpawn(() => child.simulateExit());

    await terminateProcessTree(child, { ...win, spawnImpl: spawn.impl });

    expect(spawn.calls).toEqual([
      { cmd: "taskkill", args: ["/PID", "777", "/T", "/F"] },
    ]);
    // No direct kill needed — taskkill did the job.
    expect(child.kills).toEqual([]);
  });

  it("falls back to killing the child when taskkill leaves it running", async () => {
    const child = fakeChild(777);
    const spawn = fakeSpawn(); // taskkill "succeeds" but the child survives

    await terminateProcessTree(child, { ...win, spawnImpl: spawn.impl });

    expect(spawn.calls).toHaveLength(1);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("falls back to killing the child when taskkill cannot be spawned", async () => {
    const child = fakeChild(777);
    const spawnImpl = (() => {
      throw new Error("ENOENT");
    }) as unknown as typeof import("node:child_process").spawn;

    await terminateProcessTree(child, { ...win, spawnImpl });

    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("never signals a process group on Windows", async () => {
    const child = fakeChild(777);
    const killGroup = vi.fn();
    const spawn = fakeSpawn(() => child.simulateExit());

    await terminateProcessTree(child, {
      ...win,
      spawnImpl: spawn.impl,
      killGroup,
    });

    expect(killGroup).not.toHaveBeenCalled();
  });
});

describe("terminateProcessTree — already-exited child", () => {
  it("does nothing when the child has already exited", async () => {
    const child = fakeChild(4242);
    child.simulateExit();
    const killGroup = vi.fn();
    const spawnImpl = vi.fn() as unknown as typeof import("node:child_process").spawn;

    await terminateProcessTree(child, {
      platform: "linux",
      killGroup,
      spawnImpl,
    });
    await terminateProcessTree(child, {
      platform: "win32",
      killGroup,
      spawnImpl,
    });

    expect(killGroup).not.toHaveBeenCalled();
    expect(spawnImpl).not.toHaveBeenCalled();
    expect(child.kills).toEqual([]);
  });
});
