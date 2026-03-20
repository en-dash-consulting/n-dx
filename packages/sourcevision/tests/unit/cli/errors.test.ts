import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLIError, formatCLIError, handleCLIError, requireSvDir } from "../../../src/cli/errors.js";

describe("CLIError", () => {
  it("stores message and suggestion", () => {
    const err = new CLIError("something broke", "try this instead");
    expect(err.message).toBe("something broke");
    expect(err.suggestion).toBe("try this instead");
    expect(err.name).toBe("CLIError");
  });

  it("is an instance of Error", () => {
    expect(new CLIError("test")).toBeInstanceOf(Error);
  });
});

describe("formatCLIError", () => {
  it("formats CLIError with suggestion", () => {
    const err = new CLIError("File missing", "Run init first");
    expect(formatCLIError(err)).toBe("Error: File missing\nHint: Run init first");
  });

  it("never includes stack traces", () => {
    const err = new Error("kaboom");
    const result = formatCLIError(err);
    expect(result).not.toContain("at ");
    expect(result).toBe("Error: kaboom");
  });

  it("handles non-Error values", () => {
    expect(formatCLIError("string error")).toBe("Error: string error");
  });

  it("matches ENOENT .sourcevision pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.sourcevision/manifest.json'");
    const result = formatCLIError(err);
    expect(result).toContain("Sourcevision directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches EACCES pattern", () => {
    const err = new Error("EACCES: permission denied");
    const result = formatCLIError(err);
    expect(result).toContain("Permission denied");
    expect(result).toContain("Hint:");
  });

  it("matches Unexpected token pattern", () => {
    const err = new Error("Unexpected token } in JSON at position 42");
    const result = formatCLIError(err);
    expect(result).toContain("parse JSON");
    expect(result).toContain("Hint:");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    expect(formatCLIError(err)).toBe("Error: some weird internal error");
  });
});

describe("handleCLIError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("prints formatted error and exits with code 1", () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const mockStderr = vi.spyOn(console, "error").mockImplementation(() => {});

    handleCLIError(new CLIError("test error", "try something"));

    expect(mockStderr).toHaveBeenCalledWith("Error: test error\nHint: try something");
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("requireSvDir", () => {
  it("throws CLIError when .sourcevision/ does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sv-test-"));
    try {
      expect(() => requireSvDir(tmp)).toThrow(CLIError);
      expect(() => requireSvDir(tmp)).toThrow(/Sourcevision directory not found/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("includes n-dx init suggestion in the error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sv-test-"));
    try {
      let caught: CLIError | undefined;
      try {
        requireSvDir(tmp);
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("n-dx init");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("does not throw when .sourcevision/ exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "sv-test-"));
    mkdirSync(join(tmp, ".n-dx/sourcevision"), { recursive: true });
    try {
      expect(() => requireSvDir(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
