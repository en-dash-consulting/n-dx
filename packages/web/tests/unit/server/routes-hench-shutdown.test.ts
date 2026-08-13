/**
 * Tests for shutdownActiveExecutions — the graceful shutdown helper that
 * terminates all active hench child processes before the server exits.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

// ── Fake child-process factory ────────────────────────────────────────────
// Returns a minimal ChildProcess-compatible object without spawning any real
// OS process. The kill() implementation emits "close" on the next tick so
// that the donePromise in handleExecute resolves immediately.

function createFakeChildProcess(pid = 99999) {
  const emitter = new EventEmitter();
  const kill = vi.fn((_signal?: string): boolean => {
    // Simulate graceful exit in response to any signal
    setImmediate(() => emitter.emit("close", null));
    return true;
  });
  (emitter as any).pid = pid;
  (emitter as any).stdout = new EventEmitter();
  (emitter as any).stderr = new EventEmitter();
  (emitter as any).kill = kill;
  return emitter as typeof emitter & {
    pid: number;
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: typeof kill;
  };
}

type FakeChildProcess = ReturnType<typeof createFakeChildProcess>;

// ── Module-level spawn mock ───────────────────────────────────────────────
// handleExecute uses node:child_process spawn (not spawnManaged) so we mock
// it here. The factory captures _latestProc for inspection in tests.

let _latestProc: FakeChildProcess | null = null;

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: vi.fn((): ChildProcess => {
      _latestProc = createFakeChildProcess(99999);
      return _latestProc as unknown as ChildProcess;
    }),
  };
});

// Import module-under-test AFTER mock is registered
import {
  shutdownActiveExecutions,
  handleHenchRoute,
} from "../../../src/server/routes-hench.js";
import type { ServerContext } from "../../../src/server/types.js";
import { createServer, type Server } from "node:http";

// ── Helpers ───────────────────────────────────────────────────────────────

function startTestServer(ctx: ServerContext): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      const result = handleHenchRoute(req, res, ctx);
      if (result instanceof Promise) {
        if (!(await result)) { res.writeHead(404); res.end("Not found"); }
      } else if (!result) {
        res.writeHead(404); res.end("Not found");
      }
    });
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, port });
    });
  });
}

function makePRD(items: Array<Record<string, unknown>> = []): Record<string, unknown> {
  return { schema: "rex/v1", title: "Test PRD", items };
}

// ── Tests: empty map ──────────────────────────────────────────────────────

describe("shutdownActiveExecutions — empty", () => {
  it("resolves immediately when there are no active executions", async () => {
    await expect(shutdownActiveExecutions(500)).resolves.toBeDefined();
  });

  it("returns { terminated: 0, failed: 0 } when there are no active executions", async () => {
    const result = await shutdownActiveExecutions(500);
    expect(result).toEqual({ terminated: 0, failed: 0 });
  });

  it("does not log when there are no active executions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await shutdownActiveExecutions(500);
      expect(logSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
    }
  });
});

// ── Tests: with active process ────────────────────────────────────────────

describe("shutdownActiveExecutions — with active executions", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    _latestProc = null;
    vi.clearAllMocks();

    tmpDir = await mkdtemp(join(tmpdir(), "hench-shutdown-"));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;

    // Seed a pending task
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-1", title: "Task One", status: "pending", level: "task" },
      ]), null, 2),
    );
  });

  afterEach(async () => {
    server.close();
    // Clean up any stale executions left by the test
    await shutdownActiveExecutions(200).catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("sends SIGTERM to a running child process", async () => {
    // Trigger execution (uses mocked spawn)
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);

    const proc = _latestProc;
    expect(proc).not.toBeNull();

    // Call shutdown — the mock kill() resolves done, so it exits gracefully
    await shutdownActiveExecutions(2_000);

    // kill() must have been called at least once
    expect(proc!.kill).toHaveBeenCalled();
    // First signal should be SIGTERM (graceful)
    const firstSignal = proc!.kill.mock.calls[0][0];
    expect(firstSignal).toBe("SIGTERM");
  });

  it("returns { terminated: 1, failed: 0 } after cleanly terminating one execution", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);
    expect(_latestProc).not.toBeNull();

    const result = await shutdownActiveExecutions(2_000);
    expect(result).toEqual({ terminated: 1, failed: 0 });
  });

  it("executions map is empty after shutdown", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-1" }),
    });
    expect(res.status).toBe(202);
    expect(_latestProc).not.toBeNull();

    await shutdownActiveExecutions(2_000);

    // The status endpoint should report no active executions
    const statusRes = await fetch(`http://localhost:${port}/api/hench/execute/status`);
    const body = await statusRes.json() as { executions: unknown[] };
    expect(body.executions).toHaveLength(0);
  });

  it("handles concurrent active executions", async () => {
    const rexDir = join(tmpDir, ".rex");
    // Add a second task
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-a", title: "Task A", status: "pending", level: "task" },
        { id: "task-b", title: "Task B", status: "pending", level: "task" },
      ]), null, 2),
    );

    const procs: FakeChildProcess[] = [];

    // Track all fake processes created during the test
    const { spawn: mockSpawn } = await import("node:child_process");
    vi.mocked(mockSpawn).mockImplementation((): ChildProcess => {
      const p = createFakeChildProcess(99990 + procs.length);
      procs.push(p);
      return p as unknown as ChildProcess;
    });

    // Trigger two executions
    await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-a" }),
    });
    await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-b" }),
    });

    expect(procs.length).toBe(2);

    await shutdownActiveExecutions(2_000);

    // Both fake processes should have received SIGTERM
    for (const p of procs) {
      expect(p.kill).toHaveBeenCalled();
      expect(p.kill.mock.calls[0][0]).toBe("SIGTERM");
    }

    // Map is cleared
    const statusRes = await fetch(`http://localhost:${port}/api/hench/execute/status`);
    const body = await statusRes.json() as { executions: unknown[] };
    expect(body.executions).toHaveLength(0);
  });
});

// ── Tests: shutdown logging ───────────────────────────────────────────────

describe("shutdownActiveExecutions — logging", () => {
  let tmpDir: string;
  let ctx: ServerContext;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    _latestProc = null;
    vi.clearAllMocks();

    tmpDir = await mkdtemp(join(tmpdir(), "hench-shutdown-log-"));
    const rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await mkdir(join(tmpDir, ".hench", "runs"), { recursive: true });

    ctx = {
      projectDir: tmpDir,
      svDir: join(tmpDir, ".sourcevision"),
      rexDir,
      dev: false,
    };

    const result = await startTestServer(ctx);
    server = result.server;
    port = result.port;

    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-log-1", title: "Log Task One", status: "pending", level: "task" },
      ]), null, 2),
    );
  });

  afterEach(async () => {
    server.close();
    await shutdownActiveExecutions(200).catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("logs start and completion messages when executions are present", async () => {
    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      // Start an execution
      const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-log-1" }),
      });
      expect(res.status).toBe(202);

      await shutdownActiveExecutions(2_000);

      // Should log that it started terminating
      expect(logs.some((l) => l.includes("[shutdown] terminating") && l.includes("1 active execution"))).toBe(true);
      // Should log individual task completion (may include pid info)
      expect(logs.some((l) => l.includes("[shutdown] execution task-log-1") && l.includes("terminated"))).toBe(true);
      // Should log aggregate completion
      expect(logs.some((l) => l.includes("[shutdown] all") && l.includes("terminated"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("logs per-execution termination message for each task", async () => {
    const rexDir = join(tmpDir, ".rex");
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify(makePRD([
        { id: "task-log-a", title: "Log Task A", status: "pending", level: "task" },
        { id: "task-log-b", title: "Log Task B", status: "pending", level: "task" },
      ]), null, 2),
    );

    const procs: FakeChildProcess[] = [];
    const { spawn: mockSpawn } = await import("node:child_process");
    vi.mocked(mockSpawn).mockImplementation((): ChildProcess => {
      const p = createFakeChildProcess(99980 + procs.length);
      procs.push(p);
      return p as unknown as ChildProcess;
    });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      await fetch(`http://localhost:${port}/api/hench/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-log-a" }),
      });
      await fetch(`http://localhost:${port}/api/hench/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-log-b" }),
      });

      expect(procs.length).toBe(2);

      await shutdownActiveExecutions(2_000);

      // Should log 2 terminating + per-task (may include pid) + aggregate
      expect(logs.some((l) => l.includes("[shutdown] terminating") && l.includes("2 active execution"))).toBe(true);
      expect(logs.some((l) => l.includes("[shutdown] execution task-log-a") && l.includes("terminated"))).toBe(true);
      expect(logs.some((l) => l.includes("[shutdown] execution task-log-b") && l.includes("terminated"))).toBe(true);
      expect(logs.some((l) => l.includes("[shutdown] all 2 execution(s) terminated"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("includes the pid in the per-execution termination log", async () => {
    const { spawn: mockSpawn } = await import("node:child_process");
    vi.mocked(mockSpawn).mockImplementation((): ChildProcess => {
      return createFakeChildProcess(12345) as unknown as ChildProcess;
    });

    const logs: string[] = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      logs.push(args.join(" "));
    });

    try {
      const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: "task-log-1" }),
      });
      expect(res.status).toBe(202);

      await shutdownActiveExecutions(2_000);

      // The per-execution log should include the pid for diagnostics
      expect(logs.some((l) => l.includes("pid 12345"))).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("returns { terminated, failed } counts for verification", async () => {
    const res = await fetch(`http://localhost:${port}/api/hench/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ taskId: "task-log-1" }),
    });
    expect(res.status).toBe(202);

    // shutdownActiveExecutions should return termination counts
    const result = await shutdownActiveExecutions(2_000);

    expect(result).toHaveProperty("terminated");
    expect(result).toHaveProperty("failed");
    expect(result.terminated).toBeGreaterThanOrEqual(0);
    expect(result.failed).toBeGreaterThanOrEqual(0);
    expect(result.terminated + result.failed).toBe(1);
  });
});
