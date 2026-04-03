import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createChildProcessTracker,
  installTrackedChildProcessHandlers,
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
