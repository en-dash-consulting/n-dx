import { describe, it, expect, vi, beforeEach } from "vitest";

import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { execFile, execFileSync, spawn } from "node:child_process";
import { exec, execStdout, execShellCmd, getCurrentHead, spawnTool, spawnManaged, killWithFallback, ProcessPool, ProcessLimitError } from "../../src/exec.js";

const mockExecFile = vi.mocked(execFile);
const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawn = vi.mocked(spawn);

/** Create a mock ChildProcess with event emitter and optional pipe streams. */
function createMockChild(opts?: { pipe?: boolean }) {
  const child = new EventEmitter() as EventEmitter & {
    stdout: Readable | null;
    stderr: Readable | null;
    unref: ReturnType<typeof vi.fn>;
    pid: number;
  };
  child.unref = vi.fn();
  child.pid = 12345;

  if (opts?.pipe) {
    const stdout = new EventEmitter() as Readable;
    const stderr = new EventEmitter() as Readable;
    child.stdout = stdout;
    child.stderr = stderr;
  } else {
    child.stdout = null;
    child.stderr = null;
  }

  return child;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exec", () => {
  it("resolves with structured output on success", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, "hello world\n", "");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await exec("echo", ["hello"], { cwd: "/tmp", timeout: 5000 });

    expect(result.stdout).toBe("hello world\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
  });

  it("resolves with error info on failure (never rejects)", async () => {
    const err = Object.assign(new Error("failed"), { code: 1 });
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(err, "", "some error\n");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await exec("false", [], { cwd: "/tmp", timeout: 5000 });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("some error\n");
    expect(result.error).toBe(err);
  });

  it("returns null exitCode on ETIMEDOUT", async () => {
    const err = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(err, "", "");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await exec("sleep", ["100"], { cwd: "/tmp", timeout: 1000 });

    expect(result.exitCode).toBeNull();
    expect(result.error).toBe(err);
  });

  it("passes cwd, timeout, and maxBuffer to execFile", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });

    await exec("ls", ["-la"], { cwd: "/home", timeout: 10000, maxBuffer: 2048 });

    expect(mockExecFile).toHaveBeenCalledWith(
      "ls",
      ["-la"],
      { cwd: "/home", timeout: 10000, maxBuffer: 2048 },
      expect.any(Function),
    );
  });

  it("uses default maxBuffer of 1 MiB when not specified", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, "", "");
      return {} as ReturnType<typeof execFile>;
    });

    await exec("ls", [], { cwd: "/tmp", timeout: 5000 });

    expect(mockExecFile).toHaveBeenCalledWith(
      "ls",
      [],
      { cwd: "/tmp", timeout: 5000, maxBuffer: 1024 * 1024 },
      expect.any(Function),
    );
  });

  it("handles null stdout/stderr gracefully", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, null, null);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await exec("test", [], { cwd: "/tmp", timeout: 5000 });

    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
  });
});

describe("execStdout", () => {
  it("returns only stdout, ignoring errors", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(new Error("exit 1"), "output text", "error text");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await execStdout("git", ["status"], { cwd: "/tmp", timeout: 5000 });

    expect(result).toBe("output text");
  });

  it("returns empty string when stdout is null", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, null, null);
      return {} as ReturnType<typeof execFile>;
    });

    const result = await execStdout("test", [], { cwd: "/tmp", timeout: 5000 });

    expect(result).toBe("");
  });
});

describe("execShellCmd", () => {
  it("wraps command in sh -c", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, "ok", "");
      return {} as ReturnType<typeof execFile>;
    });

    await execShellCmd("echo hello | head", { cwd: "/tmp", timeout: 5000 });

    expect(mockExecFile).toHaveBeenCalledWith(
      "sh",
      ["-c", "echo hello | head"],
      expect.objectContaining({ cwd: "/tmp", timeout: 5000 }),
      expect.any(Function),
    );
  });

  it("returns ExecResult from the shell invocation", async () => {
    mockExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
      (callback as Function)(null, "hello\n", "");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await execShellCmd("echo hello", { cwd: "/tmp", timeout: 5000 });

    expect(result.stdout).toBe("hello\n");
    expect(result.exitCode).toBe(0);
  });
});

describe("getCurrentHead", () => {
  it("returns trimmed HEAD hash on success", () => {
    mockExecFileSync.mockReturnValue("abc123\n");

    expect(getCurrentHead("/project")).toBe("abc123");
    expect(mockExecFileSync).toHaveBeenCalledWith(
      "git",
      ["rev-parse", "HEAD"],
      { cwd: "/project", encoding: "utf-8" },
    );
  });

  it("returns undefined when git fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not a git repo");
    });

    expect(getCurrentHead("/tmp")).toBeUndefined();
  });
});

describe("spawnTool", () => {
  it("resolves with exit code on success (inherit stdio)", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["script.js"], { cwd: "/project" });

    // Simulate process exit
    child.emit("close", 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(mockSpawn).toHaveBeenCalledWith("node", ["script.js"], {
      cwd: "/project",
      env: undefined,
      stdio: "inherit",
    });
  });

  it("resolves with non-zero exit code on failure", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["bad.js"]);
    child.emit("close", 1);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("captures stdout and stderr when stdio is pipe", async () => {
    const child = createMockChild({ pipe: true });
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["script.js"], { stdio: "pipe" });

    // Simulate output
    child.stdout!.emit("data", Buffer.from("hello "));
    child.stdout!.emit("data", Buffer.from("world\n"));
    child.stderr!.emit("data", Buffer.from("warning\n"));
    child.emit("close", 0);

    const result = await promise;

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello world\n");
    expect(result.stderr).toBe("warning\n");
    expect(mockSpawn).toHaveBeenCalledWith("node", ["script.js"], {
      cwd: undefined,
      env: undefined,
      stdio: ["ignore", "pipe", "pipe"],
    });
  });

  it("resolves with exitCode 1 on spawn error", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("nonexistent", []);
    child.emit("error", new Error("ENOENT"));

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("handles detached mode — fire and forget", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const result = await spawnTool("node", ["daemon.js"], { detached: true });

    expect(result.exitCode).toBe(0);
    expect(child.unref).toHaveBeenCalled();
    expect(mockSpawn).toHaveBeenCalledWith("node", ["daemon.js"], {
      cwd: undefined,
      env: undefined,
      stdio: "ignore",
      detached: true,
    });
  });

  it("defaults exitCode to 1 when close code is null", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["script.js"]);
    child.emit("close", null);

    const result = await promise;
    expect(result.exitCode).toBe(1);
  });

  it("passes env to spawn options", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const env = { ...process.env, FOO: "bar" };
    const promise = spawnTool("node", ["script.js"], { env });
    child.emit("close", 0);

    await promise;

    expect(mockSpawn).toHaveBeenCalledWith("node", ["script.js"], {
      cwd: undefined,
      env,
      stdio: "inherit",
    });
  });
});

describe("spawnManaged", () => {
  it("resolves done promise when child exits (inherit stdio)", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"], { cwd: "/project" });

    expect(handle.pid).toBe(12345);
    child.emit("close", 0);

    const result = await handle.done;
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("captures piped stdout and stderr", async () => {
    const child = createMockChild({ pipe: true });
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"], { stdio: "pipe" });

    child.stdout!.emit("data", Buffer.from("output\n"));
    child.stderr!.emit("data", Buffer.from("warning\n"));
    child.emit("close", 0);

    const result = await handle.done;
    expect(result.stdout).toBe("output\n");
    expect(result.stderr).toBe("warning\n");
  });

  it("kill sends signal to child process", async () => {
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"]);

    expect(handle.kill("SIGINT")).toBe(true);
    expect(child.kill).toHaveBeenCalledWith("SIGINT");

    child.emit("close", null, "SIGINT");
    const result = await handle.done;
    expect(result.exitCode).toBeNull();
  });

  it("kill returns false when child already exited", async () => {
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockImplementation(() => {
      throw new Error("process already exited");
    });
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"]);

    expect(handle.kill("SIGTERM")).toBe(false);

    child.emit("close", 0);
    await handle.done;
  });

  it("resolves with exitCode 1 on spawn error", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("nonexistent", []);
    child.emit("error", new Error("ENOENT"));

    const result = await handle.done;
    expect(result.exitCode).toBe(1);
  });

  it("kills child and resolves with null exitCode on timeout", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["slow.js"], { timeout: 5000 });

    // Advance past the timeout
    vi.advanceTimersByTime(5000);

    const result = await handle.done;
    expect(result.exitCode).toBeNull();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.useRealTimers();
  });

  it("clears timeout when child exits before deadline", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn();
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["fast.js"], { timeout: 10000 });

    // Child exits normally before the timeout
    child.emit("close", 0);

    const result = await handle.done;
    expect(result.exitCode).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();

    vi.useRealTimers();
  });
});

describe("spawnTool timeout", () => {
  it("kills child and resolves with null exitCode on timeout", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["slow.js"], { timeout: 3000 });

    vi.advanceTimersByTime(3000);

    const result = await promise;
    expect(result.exitCode).toBeNull();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.useRealTimers();
  });

  it("escalates to SIGKILL after grace period", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    spawnTool("node", ["stuck.js"], { timeout: 1000 });

    // Trigger initial timeout
    vi.advanceTimersByTime(1000);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Advance to SIGKILL escalation (5 seconds)
    vi.advanceTimersByTime(5000);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    vi.useRealTimers();
  });

  it("clears timeout when child exits before deadline", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn();
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["fast.js"], { timeout: 10000 });

    child.emit("close", 0);

    const result = await promise;
    expect(result.exitCode).toBe(0);
    expect(child.kill).not.toHaveBeenCalled();

    vi.useRealTimers();
  });

  it("does not apply timeout when timeout is 0", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn();
    mockSpawn.mockReturnValue(child as never);

    const promise = spawnTool("node", ["script.js"], { timeout: 0 });

    // Advance well past what would be a timeout
    vi.advanceTimersByTime(60000);
    expect(child.kill).not.toHaveBeenCalled();

    child.emit("close", 0);
    const result = await promise;
    expect(result.exitCode).toBe(0);

    vi.useRealTimers();
  });
});

describe("ProcessPool", () => {
  it("rejects limit < 1", () => {
    expect(() => new ProcessPool(0)).toThrow(RangeError);
    expect(() => new ProcessPool(-1)).toThrow(RangeError);
  });

  it("exposes limit and active count", () => {
    const pool = new ProcessPool(3);
    expect(pool.limit).toBe(3);
    expect(pool.active).toBe(0);
  });

  it("tracks active count for spawn()", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const pool = new ProcessPool(2);
    const promise = pool.spawn("node", ["a.js"]);
    expect(pool.active).toBe(1);

    child.emit("close", 0);
    await promise;
    expect(pool.active).toBe(0);
  });

  it("tracks active count for spawnManaged()", async () => {
    const child = createMockChild();
    mockSpawn.mockReturnValue(child as never);

    const pool = new ProcessPool(2);
    const handle = pool.spawnManaged("node", ["a.js"]);
    expect(pool.active).toBe(1);

    child.emit("close", 0);
    await handle.done;

    // Allow the .then cleanup to run
    await new Promise((r) => setTimeout(r, 0));
    expect(pool.active).toBe(0);
  });

  it("throws ProcessLimitError when pool is full (spawn)", () => {
    const children = [createMockChild(), createMockChild()];
    let idx = 0;
    mockSpawn.mockImplementation(() => children[idx++] as never);

    const pool = new ProcessPool(2);
    pool.spawn("node", ["a.js"]);
    pool.spawn("node", ["b.js"]);

    expect(() => pool.spawn("node", ["c.js"])).toThrow(ProcessLimitError);
    expect(() => pool.spawn("node", ["c.js"])).toThrow("Concurrent process limit reached (max 2)");
  });

  it("throws ProcessLimitError when pool is full (spawnManaged)", () => {
    const children = [createMockChild(), createMockChild()];
    let idx = 0;
    mockSpawn.mockImplementation(() => children[idx++] as never);

    const pool = new ProcessPool(2);
    pool.spawnManaged("node", ["a.js"]);
    pool.spawnManaged("node", ["b.js"]);

    expect(() => pool.spawnManaged("node", ["c.js"])).toThrow(ProcessLimitError);
  });

  it("releases slot after process completes, allowing new spawns", async () => {
    const child1 = createMockChild();
    const child2 = createMockChild();
    let idx = 0;
    const children = [child1, child2];
    mockSpawn.mockImplementation(() => children[idx++] as never);

    const pool = new ProcessPool(1);
    const p1 = pool.spawn("node", ["a.js"]);
    expect(pool.active).toBe(1);

    // Can't spawn more
    expect(() => pool.spawn("node", ["b.js"])).toThrow(ProcessLimitError);

    // Complete first process
    child1.emit("close", 0);
    await p1;
    expect(pool.active).toBe(0);

    // Now we can spawn again
    const p2 = pool.spawn("node", ["b.js"]);
    expect(pool.active).toBe(1);
    child2.emit("close", 0);
    await p2;
  });
});

describe("killWithFallback", () => {
  it("sends SIGTERM and resolves when process exits within grace period", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"]);
    const shutdownPromise = killWithFallback(handle, 5_000);

    // SIGTERM should be sent immediately
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Process exits cleanly before grace period
    child.emit("close", 0);

    await shutdownPromise;

    // SIGKILL should NOT have been sent
    expect(child.kill).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it("sends SIGKILL after grace period if process does not exit", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["stuck.js"]);
    const shutdownPromise = killWithFallback(handle, 2_000);

    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    // Advance past the grace period — process still running
    await vi.advanceTimersByTimeAsync(2_000);

    // SIGKILL should have been sent
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");

    // Process finally exits (after SIGKILL)
    child.emit("close", null);
    await shutdownPromise;

    vi.useRealTimers();
  });

  it("resolves immediately when pid is undefined", async () => {
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn();
    child.pid = undefined as unknown as number;
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"]);
    // Should resolve without sending any signals
    await killWithFallback(handle, 5_000);

    expect(child.kill).not.toHaveBeenCalled();
  });

  it("does not send SIGKILL when process exits right at grace period boundary", async () => {
    vi.useFakeTimers();
    const child = createMockChild() as ReturnType<typeof createMockChild> & {
      kill: ReturnType<typeof vi.fn>;
    };
    child.kill = vi.fn().mockReturnValue(true);
    mockSpawn.mockReturnValue(child as never);

    const handle = spawnManaged("node", ["script.js"]);
    const shutdownPromise = killWithFallback(handle, 1_000);

    // Process exits just before the grace period
    child.emit("close", 0);
    await vi.advanceTimersByTimeAsync(500);

    await shutdownPromise;

    // Only SIGTERM, no SIGKILL
    expect(child.kill).toHaveBeenCalledTimes(1);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");

    vi.useRealTimers();
  });
});
