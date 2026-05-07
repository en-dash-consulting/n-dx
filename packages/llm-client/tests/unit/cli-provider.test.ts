import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
        model: "claude-sonnet-4-6",
      }),
    ).rejects.toThrow(ClaudeClientError);

    try {
      await client.complete({
        prompt: "test",
        model: "claude-sonnet-4-6",
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
        model: "claude-sonnet-4-6",
      });
    } catch {
      // Expected
    }
    const elapsed = Date.now() - start;

    // Should fail immediately, not wait for retries
    expect(elapsed).toBeLessThan(2000);
  });
});

describe("createCliClient — stdout error envelope", () => {
  function writeFakeCli(body: string): { dir: string; path: string } {
    const dir = mkdtempSync(join(tmpdir(), "claude-fake-"));
    const path = join(dir, "claude");
    writeFileSync(path, body, { mode: 0o755 });
    chmodSync(path, 0o755);
    return { dir, path };
  }

  it("surfaces JSON stdout error envelope when stderr is empty and exit is non-zero", async () => {
    const envelope = JSON.stringify({
      type: "result",
      is_error: true,
      api_error_status: 429,
      result: "You've hit your limit · resets Apr 23 at 12pm (America/Los_Angeles)",
    });
    const { dir, path } = writeFakeCli(
      `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${envelope.replace(/'/g, "'\\''")}'\nexit 1\n`,
    );

    try {
      const client = createCliClient({
        claudeConfig: { cli_path: path },
        maxRetries: 0,
      });
      // Pre-fix: reason would be "unknown" (stderr empty → fallback to
      // "claude exited with code 1" which matches no pattern). Post-fix the
      // stdout envelope is parsed, "HTTP 429" is appended, and classifyStderr
      // picks up the rate-limit. The outer retry loop then wraps it into a
      // terminal rate-limit error when retries are exhausted.
      await expect(
        client.complete({ prompt: "test", model: "claude-sonnet-4-6" }),
      ).rejects.toMatchObject({ reason: "rate-limit" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to the exit-code string when stdout has no error envelope", async () => {
    const { dir, path } = writeFakeCli("#!/bin/sh\ncat > /dev/null\nexit 1\n");

    try {
      const client = createCliClient({
        claudeConfig: { cli_path: path },
        maxRetries: 0,
      });
      await expect(
        client.complete({ prompt: "test", model: "claude-sonnet-4-6" }),
      ).rejects.toMatchObject({
        reason: "unknown",
        message: expect.stringContaining("claude exited with code 1"),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extracts text from JSON-array stream form (newer Claude Code CLI)", async () => {
    // Newer Claude Code CLI versions emit --output-format json as a JSON
    // array of stream events ending with a {type:"result", result:"..."} event,
    // not a single envelope. The provider must unwrap the array and pick the
    // result event's `result` field as the assistant text.
    const arrayBody = JSON.stringify([
      { type: "system", subtype: "init", session_id: "abc" },
      { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } },
      {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "ASSISTANT_PAYLOAD",
        usage: { input_tokens: 12, output_tokens: 7 },
      },
    ]);
    const { dir, path } = writeFakeCli(
      `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${arrayBody.replace(/'/g, "'\\''")}'\nexit 0\n`,
    );

    try {
      const client = createCliClient({
        claudeConfig: { cli_path: path },
        maxRetries: 0,
      });
      const result = await client.complete({ prompt: "test", model: "claude-sonnet-4-6" });
      expect(result.text).toBe("ASSISTANT_PAYLOAD");
      expect(result.tokenUsage).toMatchObject({ input: 12, output: 7 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("still supports legacy single-envelope JSON form", async () => {
    const envelope = JSON.stringify({
      result: "LEGACY_PAYLOAD",
      input_tokens: 5,
      output_tokens: 9,
    });
    const { dir, path } = writeFakeCli(
      `#!/bin/sh\ncat > /dev/null\nprintf '%s' '${envelope.replace(/'/g, "'\\''")}'\nexit 0\n`,
    );

    try {
      const client = createCliClient({
        claudeConfig: { cli_path: path },
        maxRetries: 0,
      });
      const result = await client.complete({ prompt: "test", model: "claude-sonnet-4-6" });
      expect(result.text).toBe("LEGACY_PAYLOAD");
      expect(result.tokenUsage).toMatchObject({ input: 5, output: 9 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      claudeConfig: { model: "claude-sonnet-4-6" },
    });
    expect(client.info.model).toBe("claude-sonnet-4-6");
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
