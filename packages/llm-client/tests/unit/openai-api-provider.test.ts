import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createOpenAiApiProvider,
  resolveOpenAiApiKey,
  parseOpenAiTokenUsage,
} from "../../src/openai-api-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import type { LLMProvider } from "../../src/provider-interface.js";

// ── resolveOpenAiApiKey ───────────────────────────────────────────────────

describe("resolveOpenAiApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns config api_key when set", () => {
    expect(resolveOpenAiApiKey({ api_key: "sk-cfg" })).toBe("sk-cfg");
  });

  it("falls back to OPENAI_API_KEY env var", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    expect(resolveOpenAiApiKey()).toBe("sk-env");
  });

  it("prefers config over env var", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    expect(resolveOpenAiApiKey({ api_key: "sk-cfg" })).toBe("sk-cfg");
  });

  it("returns undefined when neither config nor env is available", () => {
    expect(resolveOpenAiApiKey()).toBeUndefined();
  });

  it("uses custom env var name", () => {
    process.env.MY_OPENAI_KEY = "sk-custom";
    expect(resolveOpenAiApiKey(undefined, "MY_OPENAI_KEY")).toBe("sk-custom");
  });
});

// ── parseOpenAiTokenUsage ─────────────────────────────────────────────────

describe("parseOpenAiTokenUsage", () => {
  it("parses prompt_tokens and completion_tokens", () => {
    const usage = parseOpenAiTokenUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
    expect(usage).toEqual({ input: 100, output: 50 });
  });

  it("defaults to 0 when fields are missing", () => {
    const usage = parseOpenAiTokenUsage({});
    expect(usage).toEqual({ input: 0, output: 0 });
  });

  it("handles partial usage (only prompt_tokens)", () => {
    const usage = parseOpenAiTokenUsage({ prompt_tokens: 42 });
    expect(usage).toEqual({ input: 42, output: 0 });
  });

  it("handles partial usage (only completion_tokens)", () => {
    const usage = parseOpenAiTokenUsage({ completion_tokens: 77 });
    expect(usage).toEqual({ input: 0, output: 77 });
  });

  it("ignores non-numeric values", () => {
    const usage = parseOpenAiTokenUsage({
      prompt_tokens: "not a number",
      completion_tokens: null,
    });
    expect(usage).toEqual({ input: 0, output: 0 });
  });
});

// ── createOpenAiApiProvider — construction ────────────────────────────────

describe("createOpenAiApiProvider — construction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws ClaudeClientError when no API key available", () => {
    expect(() =>
      createOpenAiApiProvider({ codexConfig: {} }),
    ).toThrow(ClaudeClientError);

    try {
      createOpenAiApiProvider({ codexConfig: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeClientError);
      const clientErr = err as ClaudeClientError;
      expect(clientErr.reason).toBe("auth");
      expect(clientErr.retryable).toBe(false);
      expect(clientErr.message).toContain("OpenAI API key not found");
    }
  });

  it("creates provider with config api_key", () => {
    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
  });

  it("creates provider with env var api key", () => {
    process.env.OPENAI_API_KEY = "sk-env";
    const provider = createOpenAiApiProvider();
    expect(provider).toBeDefined();
  });

  it("uses custom env var name", () => {
    process.env.MY_KEY = "sk-custom";
    const provider = createOpenAiApiProvider({ apiKeyEnv: "MY_KEY" });
    expect(provider).toBeDefined();
  });

  it("includes custom env var name in error message", () => {
    try {
      createOpenAiApiProvider({ apiKeyEnv: "MY_CUSTOM_KEY" });
    } catch (err) {
      expect((err as ClaudeClientError).message).toContain("MY_CUSTOM_KEY");
    }
  });
});

// ── createOpenAiApiProvider — LLMProvider interface ───────────────────────

describe("createOpenAiApiProvider — LLMProvider interface", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeProvider(): LLMProvider {
    return createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
  }

  it("returns an object satisfying the LLMProvider interface", () => {
    const provider: LLMProvider = makeProvider();
    expect(provider).toBeDefined();
  });

  it("exposes info.vendor as 'codex'", () => {
    const provider = makeProvider();
    expect(provider.info.vendor).toBe("codex");
  });

  it("exposes info.mode as 'api'", () => {
    const provider = makeProvider();
    expect(provider.info.mode).toBe("api");
  });

  it("exposes info.capabilities including streaming and function-calling", () => {
    const provider = makeProvider();
    expect(provider.info.capabilities).toContain("streaming");
    expect(provider.info.capabilities).toContain("function-calling");
  });

  it("uses default model when no model configured", () => {
    const provider = makeProvider();
    expect(provider.info.model).toBe("gpt-4o");
  });

  it("sets info.model when model is configured", () => {
    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test", model: "gpt-4-turbo" },
    });
    expect(provider.info.model).toBe("gpt-4-turbo");
  });

  it("exposes validateAuth as a function", () => {
    const provider = makeProvider();
    expect(typeof provider.validateAuth).toBe("function");
  });

  it("exposes stream as a function (streaming capability declared)", () => {
    const provider = makeProvider();
    expect(typeof provider.stream).toBe("function");
  });
});

// ── createOpenAiApiProvider — complete() with mocked fetch ───────────────

describe("createOpenAiApiProvider — complete()", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  function mockFetchResponse(body: unknown, status = 200): void {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    });
  }

  it("sends request to /chat/completions endpoint", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "Hello!" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("/chat/completions");
  });

  it("includes Authorization header with Bearer token", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "Hello!" } }],
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test-key" },
    });
    await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer sk-test-key");
  });

  it("returns text from first choice message", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "Hello world!" } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    expect(result.text).toBe("Hello world!");
  });

  it("returns parsed token usage", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "OK" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
  });

  it("returns empty text when choices are empty", async () => {
    mockFetchResponse({
      choices: [],
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    expect(result.text).toBe("");
  });

  it("returns undefined tokenUsage when usage is not present", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "hi" } }],
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    expect(result.tokenUsage).toBeUndefined();
  });

  it("uses custom API endpoint", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "OK" } }],
    });

    const provider = createOpenAiApiProvider({
      codexConfig: {
        api_key: "sk-test",
        api_endpoint: "https://custom.openai.com/v1",
      },
    });
    await provider.complete({ prompt: "Hi", model: "gpt-4o" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toBe("https://custom.openai.com/v1/chat/completions");
  });

  it("uses configured model as default when request model is empty", async () => {
    mockFetchResponse({
      choices: [{ message: { content: "OK" } }],
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test", model: "gpt-4-turbo" },
    });
    await provider.complete({ prompt: "Hi", model: "" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.model).toBe("gpt-4-turbo");
  });

  it("throws ClaudeClientError with reason 'auth' on 401", async () => {
    mockFetchResponse({ error: { message: "Unauthorized" } }, 401);

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-bad" },
    });

    await expect(
      provider.complete({ prompt: "Hi", model: "gpt-4o" }),
    ).rejects.toThrow(ClaudeClientError);

    try {
      await provider.complete({ prompt: "Hi", model: "gpt-4o" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
      expect((err as ClaudeClientError).retryable).toBe(false);
    }
  });

  it("throws ClaudeClientError with reason 'auth' on 403", async () => {
    mockFetchResponse({ error: { message: "Forbidden" } }, 403);

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-bad" },
    });

    try {
      await provider.complete({ prompt: "Hi", model: "gpt-4o" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
    }
  });

  it("retries on 429 and eventually throws rate-limit error", async () => {
    // Always return 429
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "Rate limited",
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
      maxRetries: 1,
      baseDelayMs: 1, // minimal delay for test speed
    });

    try {
      await provider.complete({ prompt: "Hi", model: "gpt-4o" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("rate-limit");
      expect((err as ClaudeClientError).retryable).toBe(true);
    }

    // Should have been called maxRetries + 1 times (initial + retries)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
});

// ── createOpenAiApiProvider — validateAuth() with mocked fetch ───────────

describe("createOpenAiApiProvider — validateAuth()", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("returns true when models endpoint returns 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    const valid = await provider.validateAuth!();
    expect(valid).toBe(true);
  });

  it("returns false when models endpoint returns 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-bad" },
    });
    const valid = await provider.validateAuth!();
    expect(valid).toBe(false);
  });

  it("returns false when models endpoint returns 403", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-bad" },
    });
    const valid = await provider.validateAuth!();
    expect(valid).toBe(false);
  });

  it("throws ClaudeClientError on unexpected status codes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });

    await expect(provider.validateAuth!()).rejects.toThrow(ClaudeClientError);
  });

  it("calls the /models endpoint", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [] }),
    });

    const provider = createOpenAiApiProvider({
      codexConfig: { api_key: "sk-test" },
    });
    await provider.validateAuth!();

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("/models");
  });
});

// ── Provider registry integration ─────────────────────────────────────────

describe("OpenAI provider — registry integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("codex factory creates API provider when OPENAI_API_KEY is set", async () => {
    // We need to import dynamically to test the registry behavior
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");

    process.env.OPENAI_API_KEY = "sk-test";
    const registry = createDefaultRegistry();
    const provider = registry.create("codex", {});

    expect(provider.info.vendor).toBe("codex");
    expect(provider.info.mode).toBe("api");
    expect(provider.info.capabilities).toContain("streaming");
  });

  it("codex factory creates CLI provider when no API key is available", async () => {
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");

    const registry = createDefaultRegistry();
    const provider = registry.create("codex", {});

    expect(provider.info.vendor).toBe("codex");
    expect(provider.info.mode).toBe("cli");
  });

  it("codex factory prefers config api_key over env var for mode selection", async () => {
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");

    const registry = createDefaultRegistry();
    const provider = registry.create("codex", {
      codex: { api_key: "sk-config" },
    });

    expect(provider.info.mode).toBe("api");
  });
});

// ── detectLLMAuthMode integration ────────────────────────────────────────

describe("detectLLMAuthMode — codex vendor", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 'api' when OPENAI_API_KEY is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { detectLLMAuthMode } = await import("../../src/llm-client.js");
    const mode = detectLLMAuthMode({ vendor: "codex" });
    expect(mode).toBe("api");
  });

  it("returns 'cli' when no API key is available", async () => {
    const { detectLLMAuthMode } = await import("../../src/llm-client.js");
    const mode = detectLLMAuthMode({ vendor: "codex" });
    expect(mode).toBe("cli");
  });

  it("returns 'api' when codex config has api_key", async () => {
    const { detectLLMAuthMode } = await import("../../src/llm-client.js");
    const mode = detectLLMAuthMode({
      vendor: "codex",
      llmConfig: { codex: { api_key: "sk-cfg" } },
    });
    expect(mode).toBe("api");
  });
});
