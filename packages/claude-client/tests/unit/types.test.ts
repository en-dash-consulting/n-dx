import { describe, it, expect } from "vitest";
import { ClaudeClientError, CLIError } from "../../src/types.js";

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
  });

  it("suggestion is undefined when not provided", () => {
    const err = new CLIError("Something failed");
    expect(err.suggestion).toBeUndefined();
  });
});
