import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}));

import { execFile, execFileSync } from "node:child_process";
import { exec, execStdout, execShellCmd, getCurrentHead } from "../../src/exec.js";

const mockExecFile = vi.mocked(execFile);
const mockExecFileSync = vi.mocked(execFileSync);

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
