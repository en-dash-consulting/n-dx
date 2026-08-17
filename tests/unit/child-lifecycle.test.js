import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as childLifecycle from "../../packages/core/child-lifecycle.js";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
  isLifecycleDebugEnabled,
  terminateTree,
  treeKillSpawnOptions,
} from "../../packages/core/child-lifecycle.js";

class FakeChildProcess extends EventEmitter {
  constructor(onKill) {
    super();
    this.exitCode = null;
    this.signalCode = null;
    this.killSignals = [];
    this.onKill = onKill;
  }

  kill(signal) {
    this.killSignals.push(signal);
    this.onKill?.(signal, this);
    return true;
  }

  close(code = 0, signal = null) {
    this.exitCode = code;
    this.signalCode = signal;
    this.emit("exit", code, signal);
    this.emit("close", code, signal);
  }
}

class FakeProcess extends EventEmitter {
  constructor() {
    super();
    this.exitCalls = [];
  }

  exit(code) {
    this.exitCalls.push(code);
  }
}

/**
 * A fake taskkill child: an EventEmitter that records how it was invoked and
 * lets the test decide the exit code (0 = killed, 128 = "process not found").
 */
function makeFakeSpawn({ exitCode = 0, emit = true } = {}) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const proc = new EventEmitter();
    calls.push({ binary, args, options });
    if (emit) {
      // Defer so the caller can attach listeners first.
      setTimeout(() => proc.emit("close", exitCode), 0);
    }
    return proc;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
}

describe("PLATFORM_SUPPORTS_PROCESS_GROUPS is no longer public", () => {
  it("is not exported — callers must not branch on platform themselves", () => {
    expect("PLATFORM_SUPPORTS_PROCESS_GROUPS" in childLifecycle).toBe(false);
  });
});

describe("treeKillSpawnOptions", () => {
  it("requests a new process group on POSIX so the group can be signalled", () => {
    expect(treeKillSpawnOptions("linux")).toEqual({ detached: true });
    expect(treeKillSpawnOptions("darwin")).toEqual({ detached: true });
  });

  it("requests nothing on Windows, where detached means 'new console'", () => {
    expect(treeKillSpawnOptions("win32")).toEqual({});
  });

  it("defaults to the running platform", () => {
    const expected = process.platform === "win32" ? {} : { detached: true };
    expect(treeKillSpawnOptions()).toEqual(expected);
  });
});

describe("terminateTree — POSIX process-group strategy", () => {
  it("signals the process group, escalating to SIGKILL when the child survives", async () => {
    const child = new FakeChildProcess();
    child.pid = 4321;
    const groupSignals = [];

    await terminateTree(child, {
      forceKillTimeoutMs: 5,
      platform: "linux",
      killGroup: (pid, signal) => groupSignals.push([pid, signal]),
    });

    expect(groupSignals).toEqual([
      [-4321, "SIGTERM"],
      [-4321, "SIGKILL"],
    ]);
  });

  it("stops after SIGTERM when the group exits during the grace period", async () => {
    const child = new FakeChildProcess();
    child.pid = 4321;
    const groupSignals = [];

    const pending = terminateTree(child, {
      forceKillTimeoutMs: 500,
      platform: "linux",
      killGroup: (pid, signal) => {
        groupSignals.push([pid, signal]);
        setTimeout(() => child.close(0, "SIGTERM"), 0);
      },
    });

    await pending;
    expect(groupSignals).toEqual([[-4321, "SIGTERM"]]);
  });

  it("falls back to a direct child kill when the group signal fails", async () => {
    const child = new FakeChildProcess();
    child.pid = 4321;

    await terminateTree(child, {
      forceKillTimeoutMs: 5,
      platform: "linux",
      killGroup: () => {
        throw new Error("ESRCH");
      },
    });

    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("terminateTree — Windows taskkill strategy", () => {
  it("invokes taskkill with /T for the child's PID and never signals a group", async () => {
    const child = new FakeChildProcess();
    child.pid = 9876;
    const spawnImpl = makeFakeSpawn({ exitCode: 0 });
    let groupCalls = 0;

    // The fake taskkill does not actually stop the child, so close it as the
    // real one would; otherwise the fallback path muddies the assertion.
    setTimeout(() => child.close(1, null), 2);

    await terminateTree(child, {
      forceKillTimeoutMs: 200,
      platform: "win32",
      spawnCliImpl: spawnImpl,
      killGroup: () => { groupCalls += 1; },
    });

    expect(spawnImpl.calls).toHaveLength(1);
    expect(spawnImpl.calls[0].binary).toBe("taskkill");
    expect(spawnImpl.calls[0].args).toEqual(["/PID", "9876", "/T", "/F"]);
    expect(groupCalls).toBe(0);
  });

  it("treats a non-zero taskkill exit (process already gone) as success", async () => {
    const child = new FakeChildProcess();
    child.pid = 9876;
    // 128 is taskkill's "process not found" — a normal shutdown race.
    const spawnImpl = makeFakeSpawn({ exitCode: 128 });
    setTimeout(() => child.close(1, null), 2);

    await expect(
      terminateTree(child, {
        forceKillTimeoutMs: 200,
        platform: "win32",
        spawnCliImpl: spawnImpl,
      }),
    ).resolves.toBeUndefined();
  });

  it("does not throw when taskkill itself cannot be spawned", async () => {
    const child = new FakeChildProcess();
    child.pid = 9876;
    const spawnImpl = () => {
      throw new Error("ENOENT: taskkill missing");
    };

    await expect(
      terminateTree(child, {
        forceKillTimeoutMs: 5,
        platform: "win32",
        spawnCliImpl: spawnImpl,
      }),
    ).resolves.toBeUndefined();

    // Falls back to the direct kill so the child is still dealt with.
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("falls back to a direct child kill when taskkill leaves the child alive", async () => {
    const child = new FakeChildProcess();
    child.pid = 9876;
    const spawnImpl = makeFakeSpawn({ exitCode: 0 });

    await terminateTree(child, {
      forceKillTimeoutMs: 5,
      platform: "win32",
      spawnCliImpl: spawnImpl,
    });

    expect(spawnImpl.calls).toHaveLength(1);
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });

  it("does not hang when taskkill never exits — the wait is bounded", async () => {
    const child = new FakeChildProcess();
    child.pid = 9876;
    const spawnImpl = makeFakeSpawn({ emit: false });

    await expect(
      terminateTree(child, {
        forceKillTimeoutMs: 5,
        platform: "win32",
        spawnCliImpl: spawnImpl,
      }),
    ).resolves.toBeUndefined();
  });

  it("skips taskkill entirely when the child has no PID", async () => {
    const child = new FakeChildProcess();
    child.pid = undefined;
    const spawnImpl = makeFakeSpawn({ exitCode: 0 });

    await terminateTree(child, {
      forceKillTimeoutMs: 5,
      platform: "win32",
      spawnCliImpl: spawnImpl,
    });

    expect(spawnImpl.calls).toHaveLength(0);
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
  });
});

describe("terminateTree — strategy tracing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function captureStderrAsync() {
    const writes = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      writes.push(String(chunk));
      return originalWrite(chunk, ...rest);
    };
    return {
      writes,
      restore: () => {
        process.stderr.write = originalWrite;
      },
    };
  }

  it("names the Windows strategy when NDX_DEBUG_LIFECYCLE is set", async () => {
    vi.stubEnv("NDX_DEBUG_LIFECYCLE", "1");
    const child = new FakeChildProcess();
    child.pid = 9876;
    setTimeout(() => child.close(1, null), 2);

    const cap = captureStderrAsync();
    try {
      await terminateTree(child, {
        forceKillTimeoutMs: 200,
        platform: "win32",
        spawnCliImpl: makeFakeSpawn({ exitCode: 0 }),
      });
    } finally {
      cap.restore();
    }

    expect(cap.writes.join("")).toContain("taskkill");
  });

  it("names the POSIX strategy when NDX_DEBUG_LIFECYCLE is set", async () => {
    vi.stubEnv("NDX_DEBUG_LIFECYCLE", "1");
    const child = new FakeChildProcess();
    child.pid = 4321;

    const cap = captureStderrAsync();
    try {
      await terminateTree(child, {
        forceKillTimeoutMs: 5,
        platform: "linux",
        killGroup: () => {},
      });
    } finally {
      cap.restore();
    }

    expect(cap.writes.join("")).toContain("process group");
  });

  it("stays silent without the debug flag", async () => {
    vi.stubEnv("NDX_DEBUG_LIFECYCLE", "");
    vi.stubEnv("NDX_DEBUG", "");
    const child = new FakeChildProcess();
    child.pid = 4321;

    const cap = captureStderrAsync();
    try {
      await terminateTree(child, {
        forceKillTimeoutMs: 5,
        platform: "linux",
        killGroup: () => {},
      });
    } finally {
      cap.restore();
    }

    expect(cap.writes.join("")).toBe("");
  });
});

describe("isLifecycleDebugEnabled", () => {
  it("is off when neither variable is set", () => {
    expect(isLifecycleDebugEnabled({})).toBe(false);
  });

  it("accepts 1 / true / yes on either variable", () => {
    for (const value of ["1", "true", "yes"]) {
      expect(isLifecycleDebugEnabled({ NDX_DEBUG_LIFECYCLE: value })).toBe(true);
      expect(isLifecycleDebugEnabled({ NDX_DEBUG: value })).toBe(true);
    }
  });

  it("rejects other values", () => {
    for (const value of ["", "0", "false", "no", "on"]) {
      expect(isLifecycleDebugEnabled({ NDX_DEBUG: value })).toBe(false);
    }
  });

  it("lets the scoped variable override the global one", () => {
    expect(isLifecycleDebugEnabled({ NDX_DEBUG_LIFECYCLE: "0", NDX_DEBUG: "1" })).toBe(false);
  });
});

describe("createChildProcessTracker — treeKill construction", () => {
  /** Collect stderr writes produced while `fn` runs. */
  function captureStderr(fn) {
    const writes = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      writes.push(String(chunk));
      return originalWrite(chunk, ...rest);
    };

    try {
      fn();
    } finally {
      process.stderr.write = originalWrite;
    }

    return writes;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("says nothing at construction time, even with debug enabled", () => {
    // The old construction-time notice claimed Windows was "falling back to
    // direct child kill". That is no longer true — Windows tree-kills via
    // taskkill — and a capability announcement fired on every `ndx` invocation
    // regardless of whether a child was ever spawned. Strategy reporting now
    // happens in terminateTree, at the point a strategy actually runs.
    vi.stubEnv("NDX_DEBUG_LIFECYCLE", "1");

    const writes = captureStderr(() => createChildProcessTracker({ treeKill: true }));

    expect(writes.join("")).toBe("");
  });
});

describe("child process lifecycle tracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for graceful child shutdown before cleanup resolves", async () => {
    const tracker = createChildProcessTracker({ forceKillTimeoutMs: 50 });
    const child = tracker.register(new FakeChildProcess((signal, proc) => {
      if (signal === "SIGTERM") {
        setTimeout(() => proc.close(0, signal), 10);
      }
    }));

    const cleanupPromise = tracker.cleanup();
    await vi.advanceTimersByTimeAsync(10);
    await cleanupPromise;

    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(tracker.size()).toBe(0);
  });

  it("force kills children that ignore graceful termination", async () => {
    const tracker = createChildProcessTracker({ forceKillTimeoutMs: 50 });
    const child = tracker.register(new FakeChildProcess((signal, proc) => {
      if (signal === "SIGKILL") {
        proc.close(null, signal);
      }
    }));

    const cleanupPromise = tracker.cleanup();
    await vi.advanceTimersByTimeAsync(50);
    await vi.advanceTimersByTimeAsync(0);
    await cleanupPromise;

    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(tracker.size()).toBe(0);
  });

  it("runs tracked cleanup before exiting on SIGTERM", async () => {
    const tracker = createChildProcessTracker({ forceKillTimeoutMs: 50 });
    const processRef = new FakeProcess();
    const child = tracker.register(new FakeChildProcess((signal, proc) => {
      if (signal === "SIGTERM") {
        proc.close(0, signal);
      }
    }));

    installTrackedChildProcessHandlers({ processRef, tracker });
    processRef.emit("SIGTERM");
    await vi.advanceTimersByTimeAsync(0);

    expect(child.killSignals).toEqual(["SIGTERM"]);
    expect(processRef.exitCalls).toEqual([143]);
  });
});
