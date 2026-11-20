import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiApiProvider } from "../../src/openai-api-provider.js";

const request = { prompt: "Preserve the earlier work", model: "gpt-6-luna", taskClass: "context.summarize" };
const provider = (options: { maxRetries?: number; baseDelayMs?: number } = {}) => createOpenAiApiProvider({
  codexConfig: { api_key: "fixture-secret", model: "gpt-6-luna" }, maxRetries: 0, ...options,
});
const completion = () => Response.json({
  choices: [{ message: { content: "Earlier work and next steps" } }],
  usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 25 } },
});
const mockFetch = () => {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("OpenAI text summaries", () => {
  it("accepts Luna text without admitting it to executable agent turns", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(completion());
    const client = provider();
    expect(await client.complete(request)).toEqual({
      text: "Earlier work and next steps", usageStatus: "measured",
      tokenUsage: { input: 75, output: 20, cacheReadInput: 25 },
    });
    expect(fetch.mock.calls[0][0]).toBe("https://api.openai.com/v1/chat/completions");
    const init = fetch.mock.calls[0][1]!;
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-6-luna", max_completion_tokens: 8192,
      messages: [{ role: "user", content: request.prompt }],
    });
    expect(client.info.capabilities).not.toContain("function-calling");
    await expect(client.completeTurn!({
      model: request.model, messages: [{ role: "user", content: request.prompt }], tools: [],
    })).rejects.toThrow("no verified OpenAI agent-turn support");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["length", "content_filter"])("declines an incomplete %s summary and retains its billed usage", async finish_reason => {
    mockFetch().mockResolvedValueOnce(Response.json({
      choices: [{ finish_reason, message: { content: "All checks passed except" } }],
      usage: { prompt_tokens: 30, completion_tokens: 5 },
    }));
    await expect(provider().complete(request)).resolves.toEqual({
      text: "", tokenUsage: { input: 30, output: 5 }, usageStatus: "measured",
    });
  });

  it.each(["high", "unsupported"])("validates explicit summary effort %s", async effort => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = mockFetch().mockResolvedValueOnce(completion());
    await provider().complete({ ...request, effort });
    const body = JSON.parse(fetch.mock.calls[0][1]!.body as string);
    if (effort === "high") {
      expect(body.reasoning_effort).toBe("high");
      expect(warning).not.toHaveBeenCalled();
    } else {
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0][0]).toContain("context.summarize");
    }
  });

  it("does not send an already cancelled summary", async () => {
    const fetch = mockFetch();
    await expect(provider().complete({ ...request, signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels in-flight fetch without retrying or leaking the abort reason", async () => {
    const controller = new AbortController();
    const fetch = mockFetch().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }));
    const pending = provider({ maxRetries: 3 }).complete({ ...request, signal: controller.signal });
    controller.abort("fixture-secret");
    await expect(pending).rejects.toMatchObject({ name: "AbortError", message: "OpenAI request cancelled" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels while reading the response body", async () => {
    const controller = new AbortController();
    const result = completion();
    vi.spyOn(result, "json").mockImplementation(async () => {
      controller.abort("fixture-secret");
      throw new Error("fixture-secret");
    });
    const fetch = mockFetch().mockResolvedValueOnce(result);
    await expect(provider({ maxRetries: 3 }).complete({ ...request, signal: controller.signal }))
      .rejects.toMatchObject({ name: "AbortError", message: "OpenAI request cancelled" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("cancels the retry delay without sending another request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetch = mockFetch().mockResolvedValueOnce(new Response("fixture-secret", {
      status: 429, headers: { "Retry-After": "10" },
    }));
    const pending = provider({ maxRetries: 3 }).complete({ ...request, signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("classifies a request timeout without retrying it", async () => {
    const fetch = mockFetch().mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
    }));
    await expect(provider({ maxRetries: 3 }).complete({ ...request, timeoutMs: 1 }))
      .rejects.toMatchObject({ reason: "timeout", retryable: true });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "auth", false], [403, "auth", false], [404, "not-found", true],
    [408, "timeout", true], [429, "rate-limit", true], [500, "network", true],
  ])("classifies HTTP %s without exposing upstream content", async (status, reason, retryable) => {
    mockFetch().mockResolvedValueOnce(new Response("fixture-secret", { status: status as number }));
    const error = await provider().complete(request).catch(error => error);
    expect(error).toMatchObject({ reason, retryable });
    expect(error.message).not.toContain("fixture-secret");
  });

  it("honors a long Retry-After without retrying early", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(new Response("fixture-secret", {
      status: 429, headers: { "Retry-After": "120" },
    }));
    await expect(provider({ maxRetries: 3 }).complete(request))
      .rejects.toMatchObject({ reason: "rate-limit", retryAfterMs: 120000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries a transient rejection before returning measured summary usage", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(new Response("fixture-secret", {
      status: 429, headers: { "Retry-After": "0" },
    })).mockResolvedValueOnce(completion());
    expect(await provider({ maxRetries: 1 }).complete(request)).toMatchObject({
      text: "Earlier work and next steps", tokenUsage: { input: 75, output: 20, cacheReadInput: 25 },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("sanitizes connection failures and bounds retries", async () => {
    const fetch = mockFetch().mockRejectedValue(new Error("fixture-secret"));
    await expect(provider({ maxRetries: 1, baseDelayMs: 0 }).complete(request))
      .rejects.toMatchObject({ reason: "network", message: "OpenAI connection failed", retryable: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry malformed JSON or expose its contents", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(new Response("fixture-secret"));
    await expect(provider({ maxRetries: 3 }).complete(request))
      .rejects.toMatchObject({ reason: "unknown", message: "Invalid OpenAI text completion payload", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
