/**
 * Tests for registerShutdownHandlers — the unified signal handler that
 * co-ordinates graceful shutdown of all dashboard components.
 *
 * Key properties under test:
 *   - Cleanup executes in dependency order (hench → ws → http → port file)
 *   - Step progress is logged for each component (step N/4 messages)
 *   - Signal name is included in the startup log
 *   - A second signal while shutdown is running forces immediate exit(1)
 *   - An overall timeout forces exit(1) to prevent indefinite hangs
 *   - Port file is removed on a clean exit
 *   - A verification summary is logged after all steps complete
 *   - Failed components are identified by name in the verification log
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { constants } from "node:fs";

// ── Mock routes-hench so shutdownActiveExecutions is controllable ─────────
vi.mock("../../../src/server/routes-hench.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/server/routes-hench.js")>();
  return {
    ...original,
    // Default: resolves immediately with no failures
    shutdownActiveExecutions: vi.fn(async () => ({ terminated: 0, failed: 0 })),
    // These are also imported by start.ts; keep as stubs so the import works
    startHeartbeatMonitor: vi.fn(),
    handleHenchRoute: vi.fn(async () => false),
  };
});

// ── Mock routes-rex so shutdownRexExecution is controllable ──────────────
vi.mock("../../../src/server/routes-rex.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../src/server/routes-rex.js")>();
  return {
    ...original,
    // Default: no active process
    shutdownRexExecution: vi.fn(async () => ({ hadActiveProcess: false, terminated: false })),
    handleRexRoute: vi.fn(async () => false),
  };
});

// Import the module-under-test AFTER the mock is registered.
// Vitest hoists vi.mock() calls so this ordering in source is fine.
import {
  registerShutdownHandlers,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
} from "../../../src/server/start.js";
import { shutdownActiveExecutions } from "../../../src/server/routes-hench.js";
import { shutdownRexExecution } from "../../../src/server/routes-rex.js";

// ── Helpers ───────────────────────────────────────────────────────────────

function createMockServer() {
  return {
    close: vi.fn((cb: (err?: Error) => void) => {
      // Simulate an async-ish close (mirrors the real Node.js behaviour)
      setImmediate(() => cb());
    }),
  };
}

function createMockWs() {
  return { shutdown: vi.fn() };
}

// ── Suite ─────────────────────────────────────────────────────────────────

describe("registerShutdownHandlers", () => {
  let tmpDir: string;
  let portFilePath: string;
  let mockExit: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    mockExit = vi.fn();

    vi.mocked(shutdownActiveExecutions).mockReset();
    // Default: completes quickly with no failures
    vi.mocked(shutdownActiveExecutions).mockResolvedValue({ terminated: 0, failed: 0 });

    vi.mocked(shutdownRexExecution).mockReset();
    // Default: no active rex process
    vi.mocked(shutdownRexExecution).mockResolvedValue({ hadActiveProcess: false, terminated: false });

    tmpDir = await mkdtemp(join(tmpdir(), "shutdown-handler-test-"));
    portFilePath = join(tmpDir, ".n-dx-web.port");
    await writeFile(portFilePath, "3117\n", "utf-8");
  });

  afterEach(async () => {
    // Remove all signal listeners added by the test to avoid cross-test
    // interference. Vitest workers do not rely on SIGINT/SIGTERM themselves.
    process.removeAllListeners("SIGINT");
    process.removeAllListeners("SIGTERM");
    process.removeAllListeners("exit");

    vi.clearAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Registration ─────────────────────────────────────────────────────────

  it("registers SIGINT and SIGTERM listeners on the process", () => {
    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    expect(process.listenerCount("SIGINT")).toBeGreaterThanOrEqual(1);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThanOrEqual(1);
  });

  // ── Cleanup order ─────────────────────────────────────────────────────────

  it("executes cleanup steps in dependency order: hench → ws → http", async () => {
    const callOrder: string[] = [];

    vi.mocked(shutdownActiveExecutions).mockImplementation(async () => {
      callOrder.push("shutdownActiveExecutions");
      return { terminated: 0, failed: 0 };
    });

    const server = {
      close: vi.fn((cb: (err?: Error) => void) => {
        callOrder.push("server.close");
        setImmediate(() => cb());
      }),
    };
    const ws = {
      shutdown: vi.fn(() => {
        callOrder.push("ws.shutdown");
      }),
    };

    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });

    expect(callOrder).toEqual([
      "shutdownActiveExecutions",
      "ws.shutdown",
      "server.close",
    ]);
  });

  // ── Signal name logging ───────────────────────────────────────────────────

  it("logs the signal name when SIGINT triggers shutdown", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(
      logs.some((l) => l.includes("[shutdown] graceful shutdown initiated (SIGINT)")),
    ).toBe(true);
  });

  it("logs the signal name when SIGTERM triggers shutdown", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGTERM");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(
      logs.some((l) => l.includes("[shutdown] graceful shutdown initiated (SIGTERM)")),
    ).toBe(true);
  });

  // ── Double-signal handling ────────────────────────────────────────────────

  it("forces exit(1) when a second SIGINT arrives during shutdown", () => {
    // Make shutdown stall permanently at step 1
    vi.mocked(shutdownActiveExecutions).mockImplementation(() => new Promise(() => {}));

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    // First signal — starts graceful shutdown (blocks at shutdownActiveExecutions).
    // The second-signal handler is registered synchronously before the first await.
    process.emit("SIGINT");

    // Second signal — must force exit immediately.
    process.emit("SIGINT");

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("forces exit(1) when a second SIGTERM arrives during shutdown", () => {
    vi.mocked(shutdownActiveExecutions).mockImplementation(() => new Promise(() => {}));

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGTERM"); // starts graceful (hangs)
    process.emit("SIGTERM"); // second signal → force exit

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("logs a message when force-exiting on second signal", () => {
    vi.mocked(shutdownActiveExecutions).mockImplementation(() => new Promise(() => {}));

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");
    process.emit("SIGINT");

    logSpy.mockRestore();

    expect(
      logs.some((l) => l.includes("forcing immediate exit")),
    ).toBe(true);
  });

  // ── Timeout mechanism ─────────────────────────────────────────────────────

  it("forces exit(1) when shutdown exceeds timeoutMs", async () => {
    vi.useFakeTimers();

    try {
      vi.mocked(shutdownActiveExecutions).mockImplementation(() => new Promise(() => {}));

      const server = createMockServer();
      const ws = createMockWs();
      const TIMEOUT = 500;
      registerShutdownHandlers(server, ws, portFilePath, 3117, TIMEOUT, { exit: mockExit });

      process.emit("SIGINT");

      // Advance time past the timeout; advanceTimersByTimeAsync also flushes
      // any microtasks that run as a side-effect.
      await vi.advanceTimersByTimeAsync(TIMEOUT + 50);

      expect(mockExit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("logs an error message when the shutdown timeout expires", async () => {
    vi.useFakeTimers();

    try {
      vi.mocked(shutdownActiveExecutions).mockImplementation(() => new Promise(() => {}));

      const errors: string[] = [];
      const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
        errors.push(args.join(" "));
      });

      const server = createMockServer();
      const ws = createMockWs();
      const TIMEOUT = 200;
      registerShutdownHandlers(server, ws, portFilePath, 3117, TIMEOUT, { exit: mockExit });

      process.emit("SIGINT");
      await vi.advanceTimersByTimeAsync(TIMEOUT + 50);

      errorSpy.mockRestore();

      expect(errors.some((e) => e.includes("[shutdown] timed out"))).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call exit(1) via timeout when shutdown completes in time", async () => {
    // Use real timers + a long timeout so the deadline never fires during the test.
    // shutdownActiveExecutions resolves immediately (default mock) so the
    // full sequence should complete well within the vi.waitFor window.
    const server = {
      close: vi.fn((cb: (err?: Error) => void) => cb()),
    };
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });

    // Deadline should not have fired
    expect(mockExit).not.toHaveBeenCalledWith(1);
  });

  // ── Port file cleanup ─────────────────────────────────────────────────────

  it("removes the port file on a clean exit", async () => {
    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });

    // The port file should no longer exist
    await expect(
      access(portFilePath, constants.F_OK),
    ).rejects.toThrow();
  });

  it("logs '[shutdown] complete' after all steps finish", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(logs.some((l) => l.includes("[shutdown] complete"))).toBe(true);
  });

  // ── Default timeout constant ──────────────────────────────────────────────

  it("exports DEFAULT_SHUTDOWN_TIMEOUT_MS as 30 seconds", () => {
    expect(DEFAULT_SHUTDOWN_TIMEOUT_MS).toBe(30_000);
  });

  // ── Step progress logging ─────────────────────────────────────────────────

  it("logs step 1/4 progress before terminating child processes", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(logs.some((l) => l.includes("[shutdown] step 1/4"))).toBe(true);
  });

  it("logs step 2/4 progress before closing WebSocket connections", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(logs.some((l) => l.includes("[shutdown] step 2/4"))).toBe(true);
  });

  it("logs step 3/4 progress before closing HTTP server", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(logs.some((l) => l.includes("[shutdown] step 3/4"))).toBe(true);
  });

  it("logs step 4/4 progress before removing port file", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(logs.some((l) => l.includes("[shutdown] step 4/4"))).toBe(true);
  });

  // ── Cleanup verification summary ──────────────────────────────────────────

  it("logs a verification summary after all components shut down cleanly", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    logSpy.mockRestore();

    expect(
      logs.some((l) => l.includes("[shutdown] verified:") && l.includes("shut down cleanly")),
    ).toBe(true);
  });

  it("logs an error when a component fails during shutdown", async () => {
    // Simulate hench executions failing to terminate
    vi.mocked(shutdownActiveExecutions).mockResolvedValue({ terminated: 0, failed: 1 });

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const server = createMockServer();
    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    errorSpy.mockRestore();
    logSpy.mockRestore();

    expect(
      errors.some((e) => e.includes("[shutdown] verification failed:") && e.includes("hench-executions")),
    ).toBe(true);
  });

  it("includes the component name in the verification failure log", async () => {
    // Simulate the HTTP server failing to close
    const server = {
      close: vi.fn((cb: (err?: Error) => void) => {
        setImmediate(() => cb(new Error("ENOTCONN")));
      }),
    };

    const errors: string[] = [];
    const errorSpy = vi.spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const ws = createMockWs();
    registerShutdownHandlers(server, ws, portFilePath, 3117, 30_000, { exit: mockExit });

    process.emit("SIGINT");

    await vi.waitFor(() => expect(mockExit).toHaveBeenCalledWith(0), { timeout: 5_000 });
    errorSpy.mockRestore();
    logSpy.mockRestore();

    expect(
      errors.some((e) => e.includes("[shutdown] verification failed:") && e.includes("http-server")),
    ).toBe(true);
  });
});
