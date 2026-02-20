import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createApiClient } from "../../src/api-provider.js";
import { ClaudeClientError } from "../../src/types.js";

describe("createApiClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates a client with API mode", () => {
    const client = createApiClient({
      claudeConfig: { api_key: "sk-ant-test" },
    });

    expect(client.mode).toBe("api");
  });

  it("throws ClaudeClientError when no API key available", () => {
    expect(() =>
      createApiClient({ claudeConfig: {} }),
    ).toThrow(ClaudeClientError);

    try {
      createApiClient({ claudeConfig: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeClientError);
      const clientErr = err as ClaudeClientError;
      expect(clientErr.reason).toBe("auth");
      expect(clientErr.retryable).toBe(false);
      expect(clientErr.message).toContain("API key not found");
    }
  });

  it("uses env var as fallback for API key", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";
    const client = createApiClient({ claudeConfig: {} });
    expect(client.mode).toBe("api");
  });

  it("uses custom env var name", () => {
    process.env.MY_KEY = "sk-ant-custom";
    const client = createApiClient({
      claudeConfig: {},
      apiKeyEnv: "MY_KEY",
    });
    expect(client.mode).toBe("api");
  });

  it("includes custom env var name in error message", () => {
    try {
      createApiClient({
        claudeConfig: {},
        apiKeyEnv: "MY_CUSTOM_KEY",
      });
    } catch (err) {
      expect((err as ClaudeClientError).message).toContain("MY_CUSTOM_KEY");
    }
  });
});
