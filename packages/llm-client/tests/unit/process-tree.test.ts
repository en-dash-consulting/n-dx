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
  const posix = { platform: "linux" as NodeJS.Platform, forceKillTimeoutMs: 150 };

  it("signals the process group, not the child", async () => {
    const child = fakeChild(4242);
    const group = fakeGroup({ drainsOn: "SIGTERM" });

    await terminateProcessTree(child, { ...posix, killGroup: group.kill });

    // Negative pid is what makes this reach descendants rather than just the child.
    expect(group.calls).toEqual([{ pid: -4242, signal: "SIGTERM" }]);
    expect(child.kills).toEqual([]);
  });

  it("escalates to SIGKILL when the group outlives SIGTERM", async () => {
    const child = fakeChild(4242);
    const group = fakeGroup({ drainsOn: "SIGKILL" });

    await terminateProcessTree(child, { ...posix, killGroup: group.kill });

    expect(group.calls.map((c) => c.signal)).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("keeps escalating after the child itself has exited", async () => {
    // The shell exits promptly on SIGTERM while the command it started ignores
    // it. Treating the child's exit as "the tree is gone" is precisely the bug,
    // so the child going away here must not stop the escalation.
    const child = fakeChild(4242);
    const group = fakeGroup({ drainsOn: "SIGKILL" });

    const done = terminateProcessTree(child, { ...posix, killGroup: group.kill });
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

    await terminateProcessTree(child, { ...posix, killGroup });

    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("falls back to killing the child when there is no pid", async () => {
    const child = fakeChild(undefined);
    const group = fakeGroup({ drainsOn: "SIGTERM" });

    await terminateProcessTree(child, { ...posix, killGroup: group.kill });

    expect(group.calls).toEqual([]);
    expect(child.kills).toEqual(["SIGTERM", "SIGKILL"]);
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
