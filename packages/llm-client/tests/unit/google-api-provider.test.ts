import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createGoogleApiProvider,
  resolveGoogleApiKey,
  parseGeminiTokenUsage,
  validateGeminiModelId,
} from "../../src/google-api-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import type { LLMProvider } from "../../src/provider-interface.js";

// ── resolveGoogleApiKey ───────────────────────────────────────────────────

describe("resolveGoogleApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns config api_key when set", () => {
    expect(resolveGoogleApiKey({ api_key: "AIza-cfg" })).toBe("AIza-cfg");
  });

  it("falls back to GEMINI_API_KEY env var by default", () => {
    process.env.GEMINI_API_KEY = "AIza-env";
    expect(resolveGoogleApiKey()).toBe("AIza-env");
  });

  it("prefers config over env var", () => {
    process.env.GEMINI_API_KEY = "AIza-env";
    expect(resolveGoogleApiKey({ api_key: "AIza-cfg" })).toBe("AIza-cfg");
  });

  it("returns undefined when neither config nor env is available", () => {
    expect(resolveGoogleApiKey()).toBeUndefined();
  });

  it("uses custom env var name", () => {
    process.env.MY_GOOGLE_KEY = "AIza-custom";
    expect(resolveGoogleApiKey(undefined, "MY_GOOGLE_KEY")).toBe("AIza-custom");
  });
});

// ── parseGeminiTokenUsage ─────────────────────────────────────────────────

describe("parseGeminiTokenUsage", () => {
  it("parses promptTokenCount and candidatesTokenCount", () => {
    const usage = parseGeminiTokenUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 50,
      totalTokenCount: 150,
    });
    expect(usage).toEqual({ input: 100, output: 50 });
  });

  it("defaults to 0 when fields are missing", () => {
    const usage = parseGeminiTokenUsage({});
    expect(usage).toEqual({ input: 0, output: 0 });
  });

  it("handles partial usage (only promptTokenCount)", () => {
    const usage = parseGeminiTokenUsage({ promptTokenCount: 42 });
    expect(usage).toEqual({ input: 42, output: 0 });
  });

  it("handles partial usage (only candidatesTokenCount)", () => {
    const usage = parseGeminiTokenUsage({ candidatesTokenCount: 77 });
    expect(usage).toEqual({ input: 0, output: 77 });
  });

  it("ignores non-numeric values", () => {
    const usage = parseGeminiTokenUsage({
      promptTokenCount: "not a number",
      candidatesTokenCount: null,
    });
    expect(usage).toEqual({ input: 0, output: 0 });
  });
});

// ── validateGeminiModelId ─────────────────────────────────────────────────

describe("validateGeminiModelId", () => {
  it("accepts gemini-2.5-pro", () => {
    expect(() => validateGeminiModelId("gemini-2.5-pro")).not.toThrow();
  });

  it("accepts gemini-2.5-flash", () => {
    expect(() => validateGeminiModelId("gemini-2.5-flash")).not.toThrow();
  });

  it("accepts gemini-2.0-flash", () => {
    expect(() => validateGeminiModelId("gemini-2.0-flash")).not.toThrow();
  });

  it("accepts empty string (uses default)", () => {
    expect(() => validateGeminiModelId("")).not.toThrow();
  });

  it("rejects non-Gemini model IDs (gpt-4o)", () => {
    expect(() => validateGeminiModelId("gpt-4o")).toThrow(ClaudeClientError);
    try {
      validateGeminiModelId("gpt-4o");
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("not-found");
      expect((err as ClaudeClientError).message).toContain("gemini-2.5-pro");
    }
  });

  it("rejects non-Gemini model IDs (claude-sonnet-4-6)", () => {
    expect(() => validateGeminiModelId("claude-sonnet-4-6")).toThrow(ClaudeClientError);
    try {
      validateGeminiModelId("claude-sonnet-4-6");
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("not-found");
    }
  });
});

// ── createGoogleApiProvider — construction ────────────────────────────────

describe("createGoogleApiProvider — construction", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("throws ClaudeClientError when no API key available", () => {
    expect(() => createGoogleApiProvider({ googleConfig: {} })).toThrow(ClaudeClientError);

    try {
      createGoogleApiProvider({ googleConfig: {} });
    } catch (err) {
      expect(err).toBeInstanceOf(ClaudeClientError);
      const clientErr = err as ClaudeClientError;
      expect(clientErr.reason).toBe("auth");
      expect(clientErr.retryable).toBe(false);
      expect(clientErr.message).toContain("Google API key not found");
    }
  });

  it("includes env var name in auth error message", () => {
    try {
      createGoogleApiProvider({ apiKeyEnv: "MY_GOOGLE_KEY" });
    } catch (err) {
      expect((err as ClaudeClientError).message).toContain("MY_GOOGLE_KEY");
    }
  });

  it("creates provider with config api_key", () => {
    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
  });

  it("creates provider with env var api key", () => {
    process.env.GEMINI_API_KEY = "AIza-env";
    const provider = createGoogleApiProvider();
    expect(provider).toBeDefined();
  });

  it("throws ClaudeClientError with reason 'not-found' for invalid model ID", () => {
    expect(() =>
      createGoogleApiProvider({
        googleConfig: { api_key: "AIza-test", model: "gpt-4o" },
      }),
    ).toThrow(ClaudeClientError);

    try {
      createGoogleApiProvider({
        googleConfig: { api_key: "AIza-test", model: "gpt-4o" },
      });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("not-found");
    }
  });

  it("accepts gemini-2.5-pro at construction", () => {
    expect(() =>
      createGoogleApiProvider({
        googleConfig: { api_key: "AIza-test", model: "gemini-2.5-pro" },
      }),
    ).not.toThrow();
  });

  it("accepts gemini-2.0-flash at construction", () => {
    expect(() =>
      createGoogleApiProvider({
        googleConfig: { api_key: "AIza-test", model: "gemini-2.0-flash" },
      }),
    ).not.toThrow();
  });
});

// ── createGoogleApiProvider — LLMProvider interface ───────────────────────

describe("createGoogleApiProvider — LLMProvider interface", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  function makeProvider(): LLMProvider {
    return createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
  }

  it("returns an object satisfying the LLMProvider interface", () => {
    const provider: LLMProvider = makeProvider();
    expect(provider).toBeDefined();
  });

  it("exposes info.vendor as 'google'", () => {
    const provider = makeProvider();
    expect(provider.info.vendor).toBe("google");
  });

  it("exposes info.mode as 'api'", () => {
    const provider = makeProvider();
    expect(provider.info.mode).toBe("api");
  });

  it("exposes info.capabilities including streaming", () => {
    const provider = makeProvider();
    expect(provider.info.capabilities).toContain("streaming");
  });

  it("uses default model when no model configured", () => {
    const provider = makeProvider();
    expect(provider.info.model).toBe("gemini-2.5-pro");
  });

  it("sets info.model when model is configured", () => {
    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test", model: "gemini-2.0-flash" },
    });
    expect(provider.info.model).toBe("gemini-2.0-flash");
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

// ── createGoogleApiProvider — complete() with mocked fetch ───────────────

describe("createGoogleApiProvider — complete()", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
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

  function makeGeminiResponse(text: string, inputTokens = 10, outputTokens = 5): unknown {
    return {
      candidates: [
        {
          content: { parts: [{ text }], role: "model" },
          finishReason: "STOP",
        },
      ],
      usageMetadata: {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
        totalTokenCount: inputTokens + outputTokens,
      },
    };
  }

  it("happy path — returns text from candidates", async () => {
    mockFetchResponse(makeGeminiResponse("Hello world!"));

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    expect(result.text).toBe("Hello world!");
  });

  it("happy path — returns parsed token usage", async () => {
    mockFetchResponse(makeGeminiResponse("OK", 100, 50));

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    expect(result.tokenUsage).toEqual({ input: 100, output: 50 });
  });

  it("sends request to generateContent endpoint", async () => {
    mockFetchResponse(makeGeminiResponse("OK"));

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    await provider.complete({ prompt: "Hi", model: "gemini-2.0-flash" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("gemini-2.0-flash");
    expect(fetchCall[0]).toContain(":generateContent");
  });

  it("includes API key as query parameter", async () => {
    mockFetchResponse(makeGeminiResponse("OK"));

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test-key" },
    });
    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("key=AIza-test-key");
  });

  it("returns empty text when no candidates", async () => {
    mockFetchResponse({ candidates: [], usageMetadata: {} });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    expect(result.text).toBe("");
  });

  it("returns undefined tokenUsage when usageMetadata is absent", async () => {
    mockFetchResponse({
      candidates: [{ content: { parts: [{ text: "hi" }], role: "model" } }],
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    const result = await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    expect(result.tokenUsage).toBeUndefined();
  });

  it("throws ClaudeClientError with reason 'auth' on 401", async () => {
    mockFetchResponse({ error: { code: 401, message: "API_KEY_INVALID" } }, 401);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-bad" },
    });

    try {
      await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
      expect((err as ClaudeClientError).retryable).toBe(false);
    }
  });

  it("throws ClaudeClientError with reason 'auth' on 403", async () => {
    mockFetchResponse({ error: { code: 403, message: "PERMISSION_DENIED" } }, 403);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-bad" },
    });

    try {
      await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
    }
  });

  it("throws ClaudeClientError with reason 'rate-limit' on 429 after retries", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "RESOURCE_EXHAUSTED",
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
      maxRetries: 1,
      baseDelayMs: 1,
    });

    try {
      await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("rate-limit");
      expect((err as ClaudeClientError).retryable).toBe(true);
    }

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws ClaudeClientError with reason 'not-found' at call time for invalid model", async () => {
    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });

    await expect(
      provider.complete({ prompt: "Hi", model: "gpt-4o" }),
    ).rejects.toThrow(ClaudeClientError);

    try {
      await provider.complete({ prompt: "Hi", model: "gpt-4o" });
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("not-found");
    }
  });

  it("uses default model when request model is empty", async () => {
    mockFetchResponse(makeGeminiResponse("OK"));

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test", model: "gemini-2.0-flash" },
    });
    await provider.complete({ prompt: "Hi", model: "" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("gemini-2.0-flash");
  });

  it("uses custom API endpoint", async () => {
    mockFetchResponse(makeGeminiResponse("OK"));

    const provider = createGoogleApiProvider({
      googleConfig: {
        api_key: "AIza-test",
        api_endpoint: "https://custom.googleapis.com/v1",
      },
    });
    await provider.complete({ prompt: "Hi", model: "gemini-2.5-pro" });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("custom.googleapis.com");
  });
});

// ── createGoogleApiProvider — stream() with mocked fetch ─────────────────

describe("createGoogleApiProvider — stream()", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  function buildSsePayload(text: string, inputTokens?: number, outputTokens?: number): string {
    const event: Record<string, unknown> = {
      candidates: [
        { content: { parts: [{ text }], role: "model" } },
      ],
    };
    if (inputTokens !== undefined && outputTokens !== undefined) {
      event.usageMetadata = {
        promptTokenCount: inputTokens,
        candidatesTokenCount: outputTokens,
        totalTokenCount: inputTokens + outputTokens,
      };
    }
    return `data: ${JSON.stringify(event)}\n\n`;
  }

  function mockStreamResponse(chunks: string[], status = 200): void {
    const body = chunks.join("");
    const encoder = new TextEncoder();
    const encoded = encoder.encode(body);

    let pos = 0;
    const readable = new ReadableStream({
      pull(controller) {
        if (pos >= encoded.length) {
          controller.close();
          return;
        }
        // Emit one chunk at a time (simulate streaming)
        const end = Math.min(pos + 64, encoded.length);
        controller.enqueue(encoded.slice(pos, end));
        pos = end;
      },
    });

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      body: readable,
      text: async () => body,
    });
  }

  it("happy path — emits text chunks from SSE stream", async () => {
    mockStreamResponse([
      buildSsePayload("Hello "),
      buildSsePayload("world!", 10, 5),
    ]);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });

    const chunks: string[] = [];
    for await (const chunk of provider.stream!({ prompt: "Hi", model: "gemini-2.5-pro" })) {
      if (chunk.text) chunks.push(chunk.text);
    }

    expect(chunks.join("")).toContain("Hello");
    expect(chunks.join("")).toContain("world!");
  });

  it("emits done chunk with usage at stream end", async () => {
    mockStreamResponse([
      buildSsePayload("Hello", 10, 5),
    ]);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });

    let finalChunk: import("../../src/provider-interface.js").StreamChunk | undefined;
    for await (const chunk of provider.stream!({ prompt: "Hi", model: "gemini-2.5-pro" })) {
      if (chunk.done) finalChunk = chunk;
    }

    expect(finalChunk).toBeDefined();
    expect(finalChunk?.done).toBe(true);
    expect(finalChunk?.usage).toEqual({ input: 10, output: 5 });
  });

  it("sends request to streamGenerateContent endpoint with alt=sse", async () => {
    mockStreamResponse([buildSsePayload("OK")]);

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });

    for await (const _ of provider.stream!({ prompt: "Hi", model: "gemini-2.5-pro" })) {
      // consume
    }

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain(":streamGenerateContent");
    expect(fetchCall[0]).toContain("alt=sse");
  });

  it("throws ClaudeClientError with reason 'rate-limit' on 429", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "RESOURCE_EXHAUSTED",
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });

    const gen = provider.stream!({ prompt: "Hi", model: "gemini-2.5-pro" });
    await expect(gen.next()).rejects.toThrow(ClaudeClientError);

    try {
      for await (const _ of provider.stream!({ prompt: "Hi", model: "gemini-2.5-pro" })) {
        // should throw before yielding
      }
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("rate-limit");
    }
  });

  it("rejects non-Gemini model ID in stream call", async () => {
    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });

    const gen = provider.stream!({ prompt: "Hi", model: "gpt-4o" });
    await expect(gen.next()).rejects.toThrow(ClaudeClientError);
  });
});

// ── createGoogleApiProvider — validateAuth() with mocked fetch ───────────

describe("createGoogleApiProvider — validateAuth()", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
  });

  it("returns true when models endpoint returns 200", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    expect(await provider.validateAuth!()).toBe(true);
  });

  it("returns false when models endpoint returns 401", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-bad" },
    });
    expect(await provider.validateAuth!()).toBe(false);
  });

  it("returns false when models endpoint returns 403", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-bad" },
    });
    expect(await provider.validateAuth!()).toBe(false);
  });

  it("throws ClaudeClientError on unexpected status codes", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
    });
    await expect(provider.validateAuth!()).rejects.toThrow(ClaudeClientError);
  });

  it("calls the /models endpoint with API key", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ models: [] }),
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-validate-key" },
    });
    await provider.validateAuth!();

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain("/models");
    expect(fetchCall[0]).toContain("AIza-validate-key");
  });
});

// ── Provider registry integration ─────────────────────────────────────────

describe("Google provider — registry integration", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("google factory creates API provider when GEMINI_API_KEY is set", async () => {
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");

    process.env.GEMINI_API_KEY = "AIza-test";
    const registry = createDefaultRegistry();
    const provider = registry.create("google", {});

    expect(provider.info.vendor).toBe("google");
    expect(provider.info.mode).toBe("api");
    expect(provider.info.capabilities).toContain("streaming");
  });

  it("google factory uses config api_key", async () => {
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");

    const registry = createDefaultRegistry();
    const provider = registry.create("google", {
      google: { api_key: "AIza-config" },
    });

    expect(provider.info.vendor).toBe("google");
    expect(provider.info.mode).toBe("api");
  });

  it("google factory throws auth error when no key available", async () => {
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");

    const registry = createDefaultRegistry();
    expect(() => registry.create("google", {})).toThrow(ClaudeClientError);
  });

  it("registry lists google as a vendor", async () => {
    const { createDefaultRegistry } = await import("../../src/provider-registry.js");
    const registry = createDefaultRegistry();
    expect(registry.vendors()).toContain("google");
  });
});

// ── createGoogleApiProvider — generateContentWithTools() ─────────────────

describe("createGoogleApiProvider — generateContentWithTools()", () => {
  const originalEnv = process.env;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GEMINI_API_KEY;
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

  const TOOLS = [{
    functionDeclarations: [{
      name: "read_file",
      description: "Read a file.",
      parameters: { type: "OBJECT" as const, properties: { path: { type: "STRING" as const } }, required: ["path"] },
    }],
  }];

  it("declares the function-calling capability", () => {
    const provider = createGoogleApiProvider({ googleConfig: { api_key: "AIza-test" } });
    expect(provider.info.capabilities).toContain("function-calling");
  });

  it("parses a functionCall response into functionCalls + parts", async () => {
    mockFetchResponse({
      candidates: [{
        content: {
          role: "model",
          parts: [{ functionCall: { name: "read_file", args: { path: "a.ts" } } }],
        },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 12 },
    });

    const provider = createGoogleApiProvider({ googleConfig: { api_key: "AIza-test" } });
    const result = await provider.generateContentWithTools({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: "read a.ts" }] }],
      tools: TOOLS,
    });

    expect(result.functionCalls).toEqual([{ name: "read_file", args: { path: "a.ts" } }]);
    expect(result.parts).toEqual([{ functionCall: { name: "read_file", args: { path: "a.ts" } } }]);
    expect(result.text).toBe("");
    expect(result.finishReason).toBe("STOP");
    expect(result.usage).toEqual({ input: 30, output: 12 });
  });

  it("parses a text-only STOP response (no function calls)", async () => {
    mockFetchResponse({
      candidates: [{
        content: { role: "model", parts: [{ text: "All done." }] },
        finishReason: "STOP",
      }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3 },
    });

    const provider = createGoogleApiProvider({ googleConfig: { api_key: "AIza-test" } });
    const result = await provider.generateContentWithTools({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: TOOLS,
    });

    expect(result.functionCalls).toEqual([]);
    expect(result.text).toBe("All done.");
    expect(result.finishReason).toBe("STOP");
  });

  it("sends contents, tools, and systemInstruction in the request body", async () => {
    mockFetchResponse({
      candidates: [{ content: { role: "model", parts: [{ text: "ok" }] }, finishReason: "STOP" }],
    });

    const provider = createGoogleApiProvider({ googleConfig: { api_key: "AIza-test" } });
    await provider.generateContentWithTools({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: "go" }] }],
      tools: TOOLS,
      systemInstruction: "You are a coding agent.",
    });

    const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall[0]).toContain(":generateContent");
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: "go" }] }]);
    expect(body.tools).toEqual(TOOLS);
    expect(body.systemInstruction).toEqual({ parts: [{ text: "You are a coding agent." }] });
  });

  it("throws ClaudeClientError with reason 'auth' on 401 (non-retryable)", async () => {
    mockFetchResponse({ error: { code: 401 } }, 401);

    const provider = createGoogleApiProvider({ googleConfig: { api_key: "AIza-bad" } });
    try {
      await provider.generateContentWithTools({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: TOOLS,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("auth");
      expect((err as ClaudeClientError).retryable).toBe(false);
    }
  });

  it("retries on 429 then throws rate-limit after exhaustion", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => "RESOURCE_EXHAUSTED",
      json: async () => ({ error: { code: 429 } }),
    });

    const provider = createGoogleApiProvider({
      googleConfig: { api_key: "AIza-test" },
      maxRetries: 1,
      baseDelayMs: 1,
    });

    try {
      await provider.generateContentWithTools({
        contents: [{ role: "user", parts: [{ text: "hi" }] }],
        tools: TOOLS,
      });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as ClaudeClientError).reason).toBe("rate-limit");
      expect((err as ClaudeClientError).retryable).toBe(true);
    }
    // 1 initial attempt + 1 retry
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects a non-Gemini model ID", async () => {
    const provider = createGoogleApiProvider({ googleConfig: { api_key: "AIza-test" } });
    await expect(provider.generateContentWithTools({
      model: "gpt-4o",
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: TOOLS,
    })).rejects.toThrow(ClaudeClientError);
  });
});
