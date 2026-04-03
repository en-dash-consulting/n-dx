import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
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

describe("createChildProcessTracker — processGroups: true on unsupported platform", () => {
  it("logs a one-time warning to stderr when process groups are unavailable", () => {
    if (PLATFORM_SUPPORTS_PROCESS_GROUPS) {
      // Cannot simulate Windows on a POSIX host without full mocking of the
      // process object — skip rather than produce a spurious false-positive.
      return;
    }

    const writes = [];
    const originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk, ...rest) => {
      writes.push(String(chunk));
      return originalWrite(chunk, ...rest);
    };

    try {
      createChildProcessTracker({ processGroups: true });
      expect(writes.some((w) => w.includes("process group cleanup is not supported"))).toBe(true);
    } finally {
      process.stderr.write = originalWrite;
    }
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
