import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test.
//
// `exec` SPAWNS rather than calling execFile: execFile builds its own options
// object for spawn and drops anything outside its curated set, `detached`
// included, so it cannot make a child a process-group leader. execFile stays
// mocked because execStdout and getCurrentHead still use it.
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

import { EventEmitter } from "node:events";
import { execFile, execFileSync, spawn } from "node:child_process";
import { exec, execStdout, execShellCmd, getCurrentHead } from "../../../src/process/exec.js";

const mockExecFile = vi.mocked(execFile);
const mockExecFileSync = vi.mocked(execFileSync);
const mockSpawn = vi.mocked(spawn);

/**
 * Minimal spawn stand-in: emits stream data, then `close`.
 *
 * Events fire asynchronously because `exec` attaches its listeners right after
 * spawn returns. No pid, so terminateProcessTree short-circuits to a direct kill
 * rather than calling process.kill(-pid) for real on the host.
 */
function fakeSpawn(out = "", err = "", code: number | null = 0) {
  const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = [];
  const impl = ((cmd: string, args: string[], opts: Record<string, unknown>) => {
    calls.push({ cmd, args, opts });
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    Object.assign(child, {
      pid: undefined,
      exitCode: null,
      signalCode: null,
      stdout,
      stderr,
      stdin: { end: () => {} },
      kill: () => true,
    });
    setImmediate(() => {
      if (out) stdout.emit("data", Buffer.from(out));
      if (err) stderr.emit("data", Buffer.from(err));
      child.emit("close", code, null);
    });
    return child as unknown as ReturnType<typeof spawn>;
  }) as unknown as typeof spawn;
  return { impl, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("exec", () => {
  it("resolves with structured output on success", async () => {
    mockSpawn.mockImplementation(fakeSpawn("hello world\n").impl);

    const result = await exec("echo", ["hello"], { cwd: "/tmp", timeout: 5000 });

    expect(result.stdout).toBe("hello world\n");
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(result.error).toBeNull();
  });

  it("resolves with error info on failure (never rejects)", async () => {
    mockSpawn.mockImplementation(fakeSpawn("", "some error\n", 1).impl);

    const result = await exec("false", [], { cwd: "/tmp", timeout: 5000 });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("some error\n");
    // execFile handed back its own Error; the equivalent is synthesized now, so
    // this pins content rather than object identity.
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toContain("some error");
  });

  it("passes cwd to spawn but keeps the timeout and maxBuffer itself", async () => {
    const spawned = fakeSpawn();
    mockSpawn.mockImplementation(spawned.impl);

    await exec("ls", ["-la"], { cwd: "/home", timeout: 10000, maxBuffer: 2048 });

    // Neither `timeout` nor `maxBuffer` is spawn's business now. exec owns the
    // timer so a timeout can kill the whole tree — execFile's timeout signalled
    // only the process it spawned, so anything that process started kept running
    // after the caller was told the command stopped — and it buffers output itself
    // so maxBuffer is enforced there. See @n-dx/llm-client's process-tree module.
    expect(spawned.calls[0]!.cmd).toBe("ls");
    expect(spawned.calls[0]!.args).toEqual(["-la"]);
    expect(spawned.calls[0]!.opts.cwd).toBe("/home");
    expect(spawned.calls[0]!.opts).not.toHaveProperty("timeout");
    expect(spawned.calls[0]!.opts).not.toHaveProperty("maxBuffer");
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
});

describe("execShellCmd", () => {
  it("wraps command in sh -c", async () => {
    const spawned = fakeSpawn("ok");
    mockSpawn.mockImplementation(spawned.impl);

    await execShellCmd("echo hello | head", { cwd: "/tmp", timeout: 5000 });

    expect(spawned.calls[0]!.cmd).toBe("sh");
    expect(spawned.calls[0]!.args).toEqual(["-c", "echo hello | head"]);
    expect(spawned.calls[0]!.opts.cwd).toBe("/tmp");
    // No `timeout` key — exec owns the timer. A shell is the case that most needs
    // it: `sh` dies on signal, the command it started does not.
    expect(spawned.calls[0]!.opts).not.toHaveProperty("timeout");
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
