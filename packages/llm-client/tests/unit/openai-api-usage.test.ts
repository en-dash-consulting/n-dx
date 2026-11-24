import { afterEach, describe, expect, it, vi } from "vitest";
import { priceTokens } from "../../src/model-pricing.js";
import { createOpenAiApiProvider, parseOpenAiTokenUsage } from "../../src/openai-api-provider.js";

const cached = { prompt_tokens: 100, completion_tokens: 20,
  prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 } };
const normalized = { input: 30, output: 20, cacheReadInput: 60, cacheCreationInput: 10 };
const provider = () => createOpenAiApiProvider({ codexConfig: { api_key: "fixture-key" }, maxRetries: 0 });
const request = { prompt: "fixture", model: "fixture-model" };
const event = (usage: unknown) => `data: ${JSON.stringify({ choices: [], usage })}\n\n`;
function streamResponse(parts: string[], interrupted = false): Response {
  let index = 0;
  return new Response(new ReadableStream({
    pull(controller) {
      if (index < parts.length) controller.enqueue(new TextEncoder().encode(parts[index++]));
      else if (interrupted) controller.error(new Error("fixture disconnect"));
      else controller.close();
    },
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("OpenAI API usage accounting", () => {
  it("splits cache reads and writes out of inclusive prompt tokens", () => {
    expect(parseOpenAiTokenUsage(cached)).toEqual(normalized);
  });
  it.each([
    [cached, normalized, "measured"],
    [{ prompt_tokens: 100, completion_tokens: 20 }, { input: 100, output: 20 }, "measured"],
    [{ prompt_tokens: 0, completion_tokens: 0 }, { input: 0, output: 0 }, "measured"],
    [{ prompt_tokens: 100 }, { input: 100, output: 0 }, "partial"],
    [undefined, undefined, "unavailable"],
    [{}, undefined, "unavailable"],
    [{ prompt_tokens: -1, completion_tokens: 20 }, { input: 0, output: 20 }, "malformed"],
  ])("normalizes blocking and streaming alike: %j", async (raw, usage, status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [], usage: raw })))
      .mockResolvedValueOnce(streamResponse([event(raw), "data: [DONE]\n\n"]));
    vi.stubGlobal("fetch", fetchMock);
    const result = await provider().complete(request);
    const chunks = await Array.fromAsync(provider().stream!(request));
    expect(result).toMatchObject({ usageStatus: status });
    expect(result.tokenUsage).toEqual(usage);
    expect(chunks.at(-1)).toEqual({ done: true, usage, usageStatus: status });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ stream_options: { include_usage: true } });
  });
  it("retains usage across fragmented, repeated and unterminated final events", async () => {
    const wire = event(cached) + event(cached) + "data: [DONE]";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([...wire])));
    expect((await Array.fromAsync(provider().stream!(request))).at(-1))
      .toEqual({ done: true, usage: normalized, usageStatus: "measured" });
  });
  it("parses a final usage event without a newline, marking missing DONE partial", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([event(cached).trim()])));
    expect((await Array.fromAsync(provider().stream!(request))).at(-1))
      .toEqual({ done: true, usage: normalized, usageStatus: "partial" });
  });
  it.each([true, false])("retains spend on interrupted stream (usage=%s)", async (hasUsage) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse(hasUsage ? [event(cached)] : [], true)));
    await expect(Array.fromAsync(provider().stream!(request))).rejects.toMatchObject({
      tokenUsage: hasUsage ? normalized : undefined,
      usageStatus: hasUsage ? "partial" : "unavailable",
    });
  });
  it("does not fabricate usage when a stream ends without usage", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([])));
    expect((await Array.fromAsync(provider().stream!(request))).at(-1))
      .toEqual({ done: true, usage: undefined, usageStatus: "unavailable" });
  });
  it("prices fresh input, output, cache reads and cache writes exactly once", () => {
    const usage = parseOpenAiTokenUsage(cached);
    const cost = priceTokens({ inputTokens: usage.input, outputTokens: usage.output,
      cacheReadTokens: usage.cacheReadInput ?? 0, cacheCreationTokens: usage.cacheCreationInput ?? 0 },
    { inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2, cacheWritePerMillion: 2.5 });
    expect(cost.totalRaw).toBeCloseTo((30 * 2 + 20 * 10 + 60 * 0.2 + 10 * 2.5) / 1_000_000, 12);
  });
  it("merges partial snapshots without summing cumulative counters", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      event(cached), event({ completion_tokens: 25 }), event(null), "data: [DONE]\n",
    ])));
    expect((await Array.fromAsync(provider().stream!(request))).at(-1))
      .toEqual({ done: true, usage: { ...normalized, output: 25 }, usageStatus: "partial" });
  });
  it.each(["data: {broken}\n", event({ prompt_tokens: "bad", completion_tokens: 1 }), event([])])(
    "retains prior accounting and surfaces malformed events: %s", async (bad) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([event(cached), bad, "data: [DONE]\n"])));
      expect((await Array.fromAsync(provider().stream!(request))).at(-1))
        .toEqual({ done: true, usage: normalized, usageStatus: "malformed" });
    },
  );
  it.each([NaN, Infinity, -1, 0.5])("rejects invalid numeric counts: %s", value => {
    expect(parseOpenAiTokenUsage({ prompt_tokens: value, completion_tokens: value }))
      .toEqual({ input: 0, output: 0 });
  });
  it("retains text across usage-only chunks", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      'data: {"choices":[{"delta":{"content":"Hello"}}],"usage":null}\n',
      event(cached), "data: [DONE]\n",
    ])));
    expect(await Array.fromAsync(provider().stream!(request))).toEqual([
      { text: "Hello" }, { done: true, usage: normalized, usageStatus: "measured" },
    ]);
  });

  it("retains valid counters from malformed snapshots before and after good snapshots", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      event({ prompt_tokens: 100, completion_tokens: "bad" }),
      event({ completion_tokens: 20 }),
      event({ prompt_tokens: "bad", completion_tokens: 40 }),
      "data: [DONE]\n",
    ])));
    expect((await Array.fromAsync(provider().stream!(request))).at(-1))
      .toEqual({ done: true, usage: { input: 100, output: 40 }, usageStatus: "malformed" });
  });
  it.each([{ prompt_tokens: 100 }, {}])("does not claim a partial final snapshot is measured: %j", async last => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(streamResponse([
      event(cached), event(last), "data: [DONE]\n",
    ])));
    expect((await Array.fromAsync(provider().stream!(request))).at(-1))
      .toEqual({ done: true, usage: normalized, usageStatus: "partial" });
  });

});


describe("OpenAI token limit dialect", () => {
  it.each([
    "o1", "o3", "o3-mini", "o4-mini", "o3-2025-04-16",
    "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.1", "gpt-5.2", "gpt-5.4",
    "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.5", "gpt-6-astra", "gpt-6-sol",
    "gpt-6-luna", "gpt-6.1-sol", "gpt-6.1-terra",
    "fixture-model", "custom-model", "gpt-4o", "gpt-6-unverified", "constructor",
  ])("uses the supported limit for %s with or without effort", async model => {
    const legacy = ["fixture-model", "custom-model", "gpt-4o", "gpt-6-unverified", "constructor"].includes(model);
    const warning = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const effort of [undefined, "high"]) {
        const fetchMock = vi.fn()
          .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [] })))
          .mockResolvedValueOnce(streamResponse(["data: [DONE]\n\n"]));
        vi.stubGlobal("fetch", fetchMock);
        const req = { prompt: "fixture", model, effort };
        const client = createOpenAiApiProvider({ codexConfig: { api_key: "fixture-key" }, maxRetries: 0, maxTokens: 1234 });
        await client.complete(req);
        await Array.fromAsync(client.stream!(req));
        for (const [, init] of fetchMock.mock.calls) {
          const body = JSON.parse(init.body);
          expect(body[legacy ? "max_tokens" : "max_completion_tokens"]).toBe(1234);
          expect(body).not.toHaveProperty(legacy ? "max_completion_tokens" : "max_tokens");
          if (!legacy && effort) expect(body.reasoning_effort).toBe(effort);
          else expect(body).not.toHaveProperty("reasoning_effort");
        }
      }
    } finally {
      warning.mockRestore();
    }
  });
});
