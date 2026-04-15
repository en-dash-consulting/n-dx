import { describe, it, expect, vi, afterEach } from "vitest";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { CLI_ERROR_CODES } from "@n-dx/llm-client";
import { CLIError, formatCLIError, handleCLIError, requireHenchDir, requireClaudeCLI } from "../../../src/cli/errors.js";
import { TaskNotActionableError } from "../../../src/agent/planning/brief.js";
import { ClaudeClientError } from "../../../src/prd/llm-gateway.js";

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
    const err = new CLIError("File missing", "Run init first", CLI_ERROR_CODES.CONFIG_NOT_FOUND);
    expect(formatCLIError(err)).toBe(`Error: [${CLI_ERROR_CODES.CONFIG_NOT_FOUND}] File missing\nHint: Run init first`);
  });

  it("never includes stack traces", () => {
    const err = new Error("kaboom");
    const result = formatCLIError(err);
    expect(result).not.toContain("at ");
    expect(result).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] kaboom`);
  });

  it("handles non-Error values", () => {
    expect(formatCLIError("string error")).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] string error`);
  });

  it("matches ENOENT .hench pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.hench/config.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.NOT_INITIALIZED}]`);
    expect(result).toContain("Hench directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches ENOENT .rex pattern", () => {
    const err = new Error("ENOENT: no such file, open '/tmp/.rex/prd.json'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.NOT_INITIALIZED}]`);
    expect(result).toContain("Rex directory not found");
    expect(result).toContain("Hint:");
  });

  it("matches claude not found pattern", () => {
    const err = new Error("claude: not found");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.LLM_CLI_NOT_FOUND}]`);
    expect(result).toContain("Claude CLI not found");
    expect(result).toContain("Hint:");
  });

  it("matches ANTHROPIC_API_KEY pattern", () => {
    const err = new Error("Missing ANTHROPIC_API_KEY environment variable");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.API_KEY_MISSING}]`);
    expect(result).toContain("API key not configured");
    expect(result).toContain("Hint:");
  });

  it("matches Invalid hench config pattern", () => {
    const err = new Error("Invalid hench config: missing required field 'provider'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.INVALID_CONFIGURATION}]`);
    expect(result).toContain("corrupted or has an invalid format");
    expect(result).toContain("Hint:");
    expect(result).toContain(".hench/config.json");
  });

  it("matches Invalid run record pattern", () => {
    const err = new Error("Invalid run record abc-123: missing required field 'status'");
    const result = formatCLIError(err);
    expect(result).toContain(`[${CLI_ERROR_CODES.INVALID_RUN_RECORD}]`);
    expect(result).toContain("Run record is corrupted");
    expect(result).toContain("Hint:");
    expect(result).toContain(".hench/runs/");
  });

  it("falls back to generic message for unknown errors", () => {
    const err = new Error("some weird internal error");
    expect(formatCLIError(err)).toBe(`Error: [${CLI_ERROR_CODES.GENERIC}] some weird internal error`);
  });

  // ── Vendor-neutral ClaudeClientError formatting ──

  it("formats ClaudeClientError with auth reason using category label", () => {
    const err = new ClaudeClientError("Error: invalid api key", "auth", false);
    const result = formatCLIError(err);
    expect(result).toContain("[authentication failure]");
    expect(result).toContain("invalid api key");
    expect(result).toContain("Hint:");
  });

  it("formats ClaudeClientError with rate-limit reason using category label", () => {
    const err = new ClaudeClientError("429 Too Many Requests", "rate-limit", true);
    const result = formatCLIError(err);
    expect(result).toContain("[rate limit exceeded]");
    expect(result).toContain("Hint:");
  });

  it("formats ClaudeClientError with timeout reason using category label", () => {
    const err = new ClaudeClientError("codex exec timed out after 30000ms", "timeout", true);
    const result = formatCLIError(err);
    expect(result).toContain("[operation timed out]");
    expect(result).toContain("Hint:");
  });

  it("formats ClaudeClientError with unknown reason without hint", () => {
    const err = new ClaudeClientError("something unexpected", "unknown", false);
    const result = formatCLIError(err);
    expect(result).toContain("[unexpected error]");
    expect(result).not.toContain("Hint:");
  });

  // ── Codex-specific error patterns ──

  it("matches codex not found pattern", () => {
    const err = new Error("codex: not found");
    const result = formatCLIError(err);
    expect(result).toContain("Codex CLI not found");
    expect(result).toContain("Hint:");
  });

  it("matches OPENAI_API_KEY pattern", () => {
    const err = new Error("Missing OPENAI_API_KEY environment variable");
    const result = formatCLIError(err);
    expect(result).toContain("OpenAI API key not configured");
    expect(result).toContain("Hint:");
  });

  it("formats TaskNotActionableError for completed tasks", () => {
    const err = new TaskNotActionableError(
      "task-1", "completed",
      "This task is already complete. Run 'n-dx status' to see remaining work.",
      "Setup CI",
    );
    const result = formatCLIError(err);
    expect(result).toContain("Error:");
    expect(result).toContain("completed");
    expect(result).toContain("Hint:");
    expect(result).toContain("n-dx status");
  });

  it("formats TaskNotActionableError for deferred tasks", () => {
    const err = new TaskNotActionableError(
      "task-2", "deferred",
      "This task has been deferred. To reactivate it, run:\n  rex update task-2 --status=pending",
    );
    const result = formatCLIError(err);
    expect(result).toContain("Error:");
    expect(result).toContain("deferred");
    expect(result).toContain("Hint:");
    expect(result).toContain("rex update");
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

    expect(mockStderr).toHaveBeenCalledWith(`Error: [${CLI_ERROR_CODES.GENERIC}] test error\nHint: try something`);
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});

describe("requireClaudeCLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws CLIError when claude is not on PATH", () => {
    // Override PATH to ensure claude won't be found
    const original = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      expect(() => requireClaudeCLI()).toThrow(CLIError);
      expect(() => requireClaudeCLI()).toThrow(/Claude CLI not found/);
    } finally {
      process.env.PATH = original;
    }
  });

  it("includes install instructions in the suggestion", () => {
    const original = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      let caught: CLIError | undefined;
      try {
        requireClaudeCLI();
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("npm install -g @anthropic-ai/claude-code");
    } finally {
      process.env.PATH = original;
    }
  });

  it("suggests API provider as fallback", () => {
    const original = process.env.PATH;
    try {
      process.env.PATH = "/nonexistent";
      let caught: CLIError | undefined;
      try {
        requireClaudeCLI();
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("hench.provider");
      expect(caught!.suggestion).toContain("api");
    } finally {
      process.env.PATH = original;
    }
  });

  it("does not throw when claude is available", () => {
    // This test only passes if claude is on PATH — skip otherwise
    let hasClaude = false;
    try {
      execFileSync("which", ["claude"], { stdio: "pipe" });
      hasClaude = true;
    } catch {
      // claude not installed, skip
    }

    if (hasClaude) {
      expect(() => requireClaudeCLI()).not.toThrow();
    }
  });
});

describe("requireHenchDir", () => {
  it("throws CLIError when .hench/ does not exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hench-test-"));
    try {
      expect(() => requireHenchDir(tmp)).toThrow(CLIError);
      expect(() => requireHenchDir(tmp)).toThrow(/Hench directory not found/);
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("includes n-dx init suggestion in the error", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hench-test-"));
    try {
      let caught: CLIError | undefined;
      try {
        requireHenchDir(tmp);
      } catch (err) {
        caught = err as CLIError;
      }
      expect(caught).toBeInstanceOf(CLIError);
      expect(caught!.suggestion).toContain("n-dx init");
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });

  it("does not throw when .hench/ exists", () => {
    const tmp = mkdtempSync(join(tmpdir(), "hench-test-"));
    mkdirSync(join(tmp, ".hench"));
    try {
      expect(() => requireHenchDir(tmp)).not.toThrow();
    } finally {
      rmSync(tmp, { recursive: true });
    }
  });
});
