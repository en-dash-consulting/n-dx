import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
  isLifecycleDebugEnabled,
  PLATFORM_SUPPORTS_PROCESS_GROUPS,
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

describe("PLATFORM_SUPPORTS_PROCESS_GROUPS", () => {
  it("is false on Windows", () => {
    // We can only assert the value is a boolean — the actual platform determines
    // the value.  On non-Windows CI this is true; on Windows it is false.
    expect(typeof PLATFORM_SUPPORTS_PROCESS_GROUPS).toBe("boolean");
    if (process.platform === "win32") {
      expect(PLATFORM_SUPPORTS_PROCESS_GROUPS).toBe(false);
    } else {
      expect(PLATFORM_SUPPORTS_PROCESS_GROUPS).toBe(true);
    }
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

describe("createChildProcessTracker — processGroups: true on unsupported platform", () => {
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

  it("stays silent by default so every CLI invocation is not annotated", () => {
    vi.stubEnv("NDX_DEBUG_LIFECYCLE", "");
    vi.stubEnv("NDX_DEBUG", "");

    const writes = captureStderr(() => createChildProcessTracker({ processGroups: true }));

    expect(writes.some((w) => w.includes("process group cleanup is not supported"))).toBe(false);
  });

  it("logs a one-time notice to stderr when debug is enabled", () => {
    if (PLATFORM_SUPPORTS_PROCESS_GROUPS) {
      // Cannot simulate Windows on a POSIX host without full mocking of the
      // process object — skip rather than produce a spurious false-positive.
      return;
    }

    vi.stubEnv("NDX_DEBUG_LIFECYCLE", "1");

    const writes = captureStderr(() => createChildProcessTracker({ processGroups: true }));

    expect(writes.some((w) => w.includes("process group cleanup is not supported"))).toBe(true);
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
