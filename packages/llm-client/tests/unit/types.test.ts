import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { CLI_ERROR_CODES, ClaudeClientError, CLIError } from "../../src/types.js";

function parseDocumentedCliErrorCodes() {
  const docPath = new URL("../../../../docs/contributing/cli-smoke-parity.md", import.meta.url);
  const markdown = readFileSync(docPath, "utf-8");
  return Array.from(
    markdown.matchAll(/^\|\s*`(NDX_CLI_[A-Z_]+)`\s*\|.*\|\s*(Yes|No)\s*\|.*$/gm),
    ([, code, comparable]) => ({ code, comparable }),
  );
}

describe("ClaudeClientError", () => {
  it("stores reason and retryable fields", () => {
    const err = new ClaudeClientError("test error", "auth", false);

    expect(err.message).toBe("test error");
    expect(err.reason).toBe("auth");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("ClaudeClientError");
  });

  it("is an instance of Error", () => {
    const err = new ClaudeClientError("test", "unknown", true);
    expect(err).toBeInstanceOf(Error);
  });

  it("supports rate-limit as retryable", () => {
    const err = new ClaudeClientError("429", "rate-limit", true);
    expect(err.retryable).toBe(true);
    expect(err.reason).toBe("rate-limit");
  });

  it("supports timeout reason", () => {
    const err = new ClaudeClientError("timed out", "timeout", true);
    expect(err.reason).toBe("timeout");
    expect(err.retryable).toBe(true);
  });

  it("supports not-found reason", () => {
    const err = new ClaudeClientError("CLI not found", "not-found", false);
    expect(err.reason).toBe("not-found");
    expect(err.retryable).toBe(false);
  });
});

describe("CLIError", () => {
  it("extends ClaudeClientError with cli reason", () => {
    const err = new CLIError("dir not found");

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ClaudeClientError);
    expect(err).toBeInstanceOf(CLIError);
    expect(err.reason).toBe("cli");
    expect(err.retryable).toBe(false);
    expect(err.name).toBe("CLIError");
  });

  it("stores optional suggestion", () => {
    const err = new CLIError("Not initialized", "Run 'n-dx init' first");

    expect(err.message).toBe("Not initialized");
    expect(err.suggestion).toBe("Run 'n-dx init' first");
    expect(err.code).toBe(CLI_ERROR_CODES.GENERIC);
  });

  it("suggestion is undefined when not provided", () => {
    const err = new CLIError("Something failed");
    expect(err.suggestion).toBeUndefined();
  });

  it("stores an explicit stable CLI error code", () => {
    const err = new CLIError(
      "Unknown command: statis",
      "Run 'ndx help' for usage.",
      CLI_ERROR_CODES.UNKNOWN_COMMAND,
    );

    expect(err.code).toBe(CLI_ERROR_CODES.UNKNOWN_COMMAND);
  });

  it("documents every exported CLI error code in the smoke parity guide", () => {
    const documented = parseDocumentedCliErrorCodes();
    const documentedCodes = documented.map((entry) => entry.code).sort();
    const exportedCodes = Object.values(CLI_ERROR_CODES).sort();

    expect(documentedCodes).toEqual(exportedCodes);
    expect(new Set(documentedCodes).size).toBe(documentedCodes.length);
  });
});
