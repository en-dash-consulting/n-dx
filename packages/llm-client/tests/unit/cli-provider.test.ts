import { describe, it, expect } from "vitest";
import { createCliClient } from "../../src/cli-provider.js";
import { ClaudeClientError } from "../../src/types.js";

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
