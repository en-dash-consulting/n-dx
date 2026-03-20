import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError, BudgetExceededError, formatCLIError, handleCLIError, requireRexDir } from "../../../src/cli/errors.js";

describe("CLIError", () => {
  it("stores message and suggestion", () => {
    const err = new CLIError("something broke", "try this instead");
    expect(err.message).toBe("something broke");
    expect(err.suggestion).toBe("try this instead");
    expect(err.name).toBe("CLIError");
  });

  it("works without a suggestion", () => {
    const err = new CLIError("something broke");
    expect(err.message).toBe("something broke");
    expect(err.suggestion).toBeUndefined();
  });

  it("is an instance of Error", () => {
    const err = new CLIError("test");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("BudgetExceededError", () => {
  it("has exitCode 2 to distinguish from general errors", () => {
    const err = new BudgetExceededError(["token limit exceeded"]);
    expect(err.exitCode).toBe(2);
  });

  it("formats warnings into message", () => {
    const err = new BudgetExceededError(["token limit exceeded", "cost limit exceeded"]);
    expect(err.message).toContain("token limit exceeded");
    expect(err.message).toContain("cost limit exceeded");
  });

  it("includes budget adjustment suggestion", () => {
    const err = new BudgetExceededError(["exceeded"]);
    expect(err.suggestion).toContain("budget");
  });

  it("is an instance of CLIError", () => {
    const err = new BudgetExceededError([]);
    expect(err).toBeInstanceOf(CLIError);
    expect(err.name).toBe("BudgetExceededError");
  });
});

describe("formatCLIError", () => {
  it("formats CLIError with suggestion", () => {
    const err = new CLIError("File missing", "Run init first");
    const result = formatCLIError(err);
    expect(result).toBe("Error: File missing\nHint: Run init first");
  });

  it("formats CLIError without suggestion", () => {
    const err = new CLIError("Something failed");
    const result = formatCLIError(err);
    expect(result).toBe("Error: Something failed");
  });

  it("never includes stack traces for Error instances", () => {
    const err = new Error("kaboom");
    const result = formatCLIError(err);
    expect(result).not.toContain("at ");
    expect(result).not.toContain(".ts:");
    expect(result).not.toContain(".js:");
    expect(result).toBe("Error: kaboom");
  });

  it("handles non-Error values", () => {
    expect(formatCLIError("string error")).toBe("Error: string error");
    expect(formatCLIError(42)).toBe("Error: 42");
    expect(formatCLIError(null)).toBe("Error: null");
    expect(formatCLIError(undefined)).toBe("Error: undefined");
  });

  it("matches ENOENT .rex pattern", () => {
    const err = new Error("ENOENT: no such file or directory, open '/tmp/.rex/prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain("Rex directory not found");
    expect(result).toContain("Hint:");
    expect(result).toContain("n-dx init");
  });

  it("matches ENOENT prd.json pattern", () => {
    const err = new Error("ENOENT: no such file or directory, open 'prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain("PRD file not found");
    expect(result).toContain("Hint:");
  });

  it("matches Invalid prd.json pattern", () => {
    const err = new Error("Invalid prd.json: missing required field 'schema'");
    const result = formatCLIError(err);
    expect(result).toContain("corrupted or has an invalid format");
    expect(result).toContain("Hint:");
  });

  it("matches EACCES pattern", () => {
    const err = new Error("EACCES: permission denied, open '/tmp/.rex/config.json'");
    const result = formatCLIError(err);
    expect(result).toContain("Permission denied");
    expect(result).toContain("Hint:");
  });

  it("matches Unexpected token (JSON parse) pattern", () => {
    const err = new Error("Unexpected token } in JSON at position 42");
    const result = formatCLIError(err);
    expect(result).toContain("parse JSON");
    expect(result).toContain("Hint:");
  });

  it("matches 'not found' pattern with original message", () => {
    const err = new Error('Item "abc-123" not found');
    const result = formatCLIError(err);
    expect(result).toContain('Item "abc-123" not found');
    expect(result).toContain("Hint:");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    const result = formatCLIError(err);
    expect(result).toBe("Error: some weird internal error");
    expect(result).not.toContain("Hint:");
  });
});

describe("handleCLIError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints formatted error and exits with code 1", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new CLIError("test error", "try something");

    handleCLIError(err);

    expect(mockStderr).toHaveBeenCalledWith("Error: test error\nHint: try something");
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("respects custom exitCode on CLIError subclasses", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new BudgetExceededError(["token limit exceeded"]);

    handleCLIError(err);

    expect(mockStderr).toHaveBeenCalled();
    expect(mockExit).toHaveBeenCalledWith(2);
  });

  it("exits with code 1 for plain Error objects", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCLIError(new Error("plain error"));

    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("requireRexDir", () => {
  it("throws CLIError when .rex/ does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rex-test-"));
    try {
      expect(() => requireRexDir(tmp)).toThrow(CLIError);
      expect(() => requireRexDir(tmp)).toThrow(/Rex directory not found/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("includes n-dx init suggestion in the error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rex-test-"));
    try {
      let caught: CLIError | undefined;
      try {
        requireRexDir(tmp);
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("n-dx init");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("does not throw when .rex/ exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "rex-test-"));
    mkdirSync(join(tmp, ".n-dx", "rex"), { recursive: true });
    try {
      expect(() => requireRexDir(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
