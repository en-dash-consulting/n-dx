import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import {
  installRunInterrupt,
  trackVendorProcess,
  liveVendorProcessCount,
  forceStopVendorProcesses,
  RunInterruptedError,
} from "../../../src/process/run-interrupt.js";

function fakeProcess(): EventEmitter & Pick<NodeJS.Process, "on" | "removeListener"> {
  return new EventEmitter() as never;
}

describe("installRunInterrupt", () => {
  it("aborts on the first SIGINT, with the signal as the reason", () => {
    const target = fakeProcess();
    const onStop = vi.fn();
    const interrupt = installRunInterrupt({ target, onStop, exit: vi.fn() });

    expect(interrupt.stopping).toBe(false);
    target.emit("SIGINT");
    expect(interrupt.stopping).toBe(true);
    expect(interrupt.signal.aborted).toBe(true);
    expect(interrupt.signal.reason).toBeInstanceOf(RunInterruptedError);
    expect((interrupt.signal.reason as Error).message).toBe("Interrupted by SIGINT");
    expect(onStop).toHaveBeenCalledWith("SIGINT");
    interrupt.dispose();
  });

  it("treats SIGTERM (the dashboard's Stop) the same way", () => {
    const target = fakeProcess();
    const interrupt = installRunInterrupt({ target, exit: vi.fn() });
    target.emit("SIGTERM");
    expect((interrupt.signal.reason as Error).message).toBe("Interrupted by SIGTERM");
    interrupt.dispose();
  });

  it("a second signal stops the tracked vendor CLI before exiting, rather than orphaning it", async () => {
    const target = fakeProcess();
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    const untrack = trackVendorProcess(child);
    const closed = new Promise<void>((resolve) => child.once("close", () => resolve()));
    child.once("close", untrack);

    const exited = new Promise<number>((resolve) => {
      const interrupt = installRunInterrupt({ target, exit: (code) => resolve(code), forceTimeoutMs: 2000 });
      target.emit("SIGINT");
      target.emit("SIGINT");
      void interrupt;
    });

    expect(await exited).toBe(1);
    await closed;
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(liveVendorProcessCount()).toBe(0);
  });

  it("dispose removes the handlers", () => {
    const target = fakeProcess();
    const interrupt = installRunInterrupt({ target, exit: vi.fn() });
    interrupt.dispose();
    expect(target.listenerCount("SIGINT")).toBe(0);
    expect(target.listenerCount("SIGTERM")).toBe(0);
  });
});

describe("forceStopVendorProcesses", () => {
  afterEach(() => {
    expect(liveVendorProcessCount()).toBe(0);
  });

  it("is a no-op with nothing tracked", async () => {
    await forceStopVendorProcesses(100);
  });
});
