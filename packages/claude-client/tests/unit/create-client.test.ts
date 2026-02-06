import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createClient, detectAuthMode } from "../../src/create-client.js";
import { ClaudeClientError } from "../../src/types.js";
import type { ClaudeConfig } from "../../src/types.js";

describe("detectAuthMode", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 'api' when api_key is in config", () => {
    const mode = detectAuthMode({
      claudeConfig: { api_key: "sk-ant-test" },
    });
    expect(mode).toBe("api");
  });

  it("returns 'api' when ANTHROPIC_API_KEY is in env", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";
    const mode = detectAuthMode({ claudeConfig: {} });
    expect(mode).toBe("api");
  });

  it("returns 'cli' when no API key is available", () => {
    const mode = detectAuthMode({ claudeConfig: {} });
    expect(mode).toBe("cli");
  });

  it("uses custom env var name", () => {
    process.env.CUSTOM_KEY = "sk-ant-custom";
    const mode = detectAuthMode({
      claudeConfig: {},
      apiKeyEnv: "CUSTOM_KEY",
    });
    expect(mode).toBe("api");
  });
});

describe("createClient", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("creates API client when mode is 'api' and key is available", () => {
    const client = createClient({
      claudeConfig: { api_key: "sk-ant-test" },
      mode: "api",
    });

    expect(client.mode).toBe("api");
  });

  it("creates CLI client when mode is 'cli'", () => {
    const client = createClient({
      claudeConfig: {},
      mode: "cli",
    });

    expect(client.mode).toBe("cli");
  });

  it("throws when mode is 'api' but no key is available", () => {
    expect(() =>
      createClient({
        claudeConfig: {},
        mode: "api",
      }),
    ).toThrow(ClaudeClientError);
  });

  it("auto-selects API when api_key is in config", () => {
    const client = createClient({
      claudeConfig: { api_key: "sk-ant-test" },
    });

    expect(client.mode).toBe("api");
  });

  it("auto-selects CLI when no API key is available", () => {
    const client = createClient({
      claudeConfig: {},
    });

    expect(client.mode).toBe("cli");
  });

  it("auto-selects API when env var is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";
    const client = createClient({ claudeConfig: {} });

    expect(client.mode).toBe("api");
  });
});
