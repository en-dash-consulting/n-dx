import { describe, it, expect } from "vitest";
import { createCliClient } from "../../src/cli-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import type { LLMProvider } from "../../src/provider-interface.js";

describe("createCliClient", () => {
  it("creates a client with CLI mode", () => {
    const client = createCliClient({
      claudeConfig: {},
    });

    expect(client.mode).toBe("cli");
  });

  it("uses custom CLI path from config", () => {
    const client = createCliClient({
      claudeConfig: { cli_path: "/custom/claude" },
    });

    expect(client.mode).toBe("cli");
  });

  it("throws ClaudeClientError with not-found reason for missing binary", async () => {
    const client = createCliClient({
      claudeConfig: { cli_path: "/nonexistent/claude-binary-that-does-not-exist" },
      maxRetries: 0,
    });

    await expect(
      client.complete({
        prompt: "test",
        model: "claude-sonnet-4-20250514",
      }),
    ).rejects.toThrow(ClaudeClientError);

    try {
      await client.complete({
        prompt: "test",
        model: "claude-sonnet-4-20250514",
      });
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeClientError);
      const clientErr = err as ClaudeClientError;
      expect(clientErr.reason).toBe("not-found");
      expect(clientErr.retryable).toBe(false);
    }
  });

  it("does not retry not-found errors", async () => {
    const client = createCliClient({
      claudeConfig: { cli_path: "/nonexistent/claude-binary-that-does-not-exist" },
      maxRetries: 3,
    });

    const start = Date.now();
    try {
      await client.complete({
        prompt: "test",
        model: "claude-sonnet-4-20250514",
      });
    } catch {
      // Expected
    }
    const elapsed = Date.now() - start;

    // Should fail immediately, not wait for retries
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("createCliClient — LLMProvider interface", () => {
  it("returns an object satisfying the LLMProvider interface", () => {
    const client = createCliClient({ claudeConfig: {} });
    // TypeScript compile-time check: assignment must satisfy LLMProvider
    const provider: LLMProvider = client;
    expect(provider).toBeDefined();
  });

  it("exposes info.vendor as 'claude'", () => {
    const client = createCliClient({ claudeConfig: {} });
    expect(client.info.vendor).toBe("claude");
  });

  it("exposes info.mode as 'cli'", () => {
    const client = createCliClient({ claudeConfig: {} });
    expect(client.info.mode).toBe("cli");
  });

  it("exposes info.capabilities as an array", () => {
    const client = createCliClient({ claudeConfig: {} });
    expect(Array.isArray(client.info.capabilities)).toBe(true);
  });

  it("omits info.model when no model is configured", () => {
    const client = createCliClient({ claudeConfig: {} });
    expect(client.info.model).toBeUndefined();
  });

  it("sets info.model when model is configured", () => {
    const client = createCliClient({
      claudeConfig: { model: "claude-sonnet-4-20250514" },
    });
    expect(client.info.model).toBe("claude-sonnet-4-20250514");
  });

  it("does not expose validateAuth (CLI auth cannot be probed)", () => {
    const client = createCliClient({ claudeConfig: {} });
    expect(client.validateAuth).toBeUndefined();
  });

  it("does not expose stream (not implemented)", () => {
    const client = createCliClient({ claudeConfig: {} });
    expect(client.stream).toBeUndefined();
  });
});
