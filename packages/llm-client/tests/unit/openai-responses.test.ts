import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenAiApiProvider } from "../../src/openai-api-provider.js";
import type { ProviderTurnRequest, ProviderTurnEvent } from "../../src/provider-interface.js";

const tool = { name: "read_file", description: "Read a file", inputSchema: {
  type: "object" as const, properties: { path: { type: "string" as const }, optional: { type: "boolean" as const } }, required: ["path"],
} };
const request: ProviderTurnRequest = { model: "gpt-6.1-sol", messages: [{ role: "user", content: "Inspect files" }], tools: [tool], effort: "high" };
const call = (id = "a", path = "a.txt") => ({ type: "function_call", id: `fc_${id}`, call_id: id, name: tool.name, arguments: JSON.stringify({ path }), status: "completed" });
const message = (text = "Finished") => ({ type: "message", role: "assistant", content: [{ type: "output_text", text }] });
const reasoning = { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "fixture-encrypted-state" };
const usage = { input_tokens: 100, output_tokens: 20, input_tokens_details: { cached_tokens: 30, cache_write_tokens: 10 }, output_tokens_details: { reasoning_tokens: 12 } };
const response = (output: unknown[] = [message()], status = "completed") => ({ id: "resp_1", model: request.model, status, output, usage });
const provider = (options = {}) => createOpenAiApiProvider({ codexConfig: { api_key: "fixture-secret", model: request.model }, maxRetries: 0, ...options });
const mockFetch = () => vi.spyOn(globalThis, "fetch");
const sse = (events: unknown[], width = 7) => {
  const bytes = new TextEncoder().encode(events.map(e => `event: ${String((e as {type:string}).type)}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(""));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += width) controller.enqueue(bytes.slice(i, i + width));
    controller.close();
  } }));
};
async function collect(input = request) {
  const events: ProviderTurnEvent[] = [];
  for await (const event of provider().streamTurn!(input)) events.push(event);
  return events;
}
afterEach(() => { vi.restoreAllMocks(); });

describe("Responses agent turns", () => {
  it("requests encrypted reasoning so a stateless transport accepts the next tool turn without retries", async () => {
    const fetch = mockFetch().mockImplementation(async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      if (body.input.some((item: any) => item.type === "function_call_output")) {
        const replay = body.input.find((item: any) => item.type === "reasoning");
        if (!replay?.encrypted_content) return new Response(null, { status: 400 });
        return Response.json(response());
      }
      const { encrypted_content, ...plain } = reasoning;
      return Response.json(response([body.include?.includes("reasoning.encrypted_content") ? reasoning : plain, call()]));
    });
    const client = provider({ maxRetries: 2 });
    const first = await client.completeTurn!(request);
    const next = await client.completeTurn!({ ...request, messages: [...request.messages, first.message,
      { role: "tool", toolCallId: "a", content: "read result" }] });
    expect(next.stopReason).toBe("end_turn");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([[], [reasoning], [{ ...message("Halfway"), status: "incomplete" }],
    [reasoning, call("finished"), { ...call("partial"), status: "incomplete", arguments: '{"path":' }],
  ].map(items => [items]))("resumes token exhaustion with measured usage and no unanswered calls: %j", async items => {
    const fetch = mockFetch().mockResolvedValueOnce(Response.json({ ...response(items, "incomplete"),
      incomplete_details: { reason: "max_output_tokens" } })).mockResolvedValueOnce(Response.json(response()));
    const client = provider();
    const first = await client.completeTurn!(request);
    expect(first).toMatchObject({ stopReason: "max_tokens", usageStatus: "measured",
      tokenUsage: { input: 60, output: 20 }, message: { toolCalls: [] } });
    await client.completeTurn!({ ...request, messages: [...request.messages, first.message,
      { role: "user", content: "Continue; retry any unfinished tool call." }] });
    const replay = JSON.parse(fetch.mock.calls[1][1]!.body as string).input;
    expect(replay.some((item: any) => item.type === "function_call")).toBe(false);
    expect(replay.some((item: any) => item.status === "incomplete")).toBe(false);
  });

  it("continues to reject truncated context summaries with their measured spend", async () => {
    mockFetch().mockResolvedValue(Response.json({ ...response([message("Unfinished summary")], "incomplete"),
      incomplete_details: { reason: "max_output_tokens" } }));
    await expect(provider().completeTurn!({ ...request, tools: [], taskClass: "context.summarize" }))
      .rejects.toMatchObject({ retryable: false, usageStatus: "measured", tokenUsage: { output: 20 } });
  });

  it.each([
    { ...response([], "incomplete"), incomplete_details: { reason: "content_filter" } },
    { ...response([null], "incomplete"), incomplete_details: { reason: "max_output_tokens" } },
    { ...response([{ ...call(), arguments: 42 }], "incomplete"), incomplete_details: { reason: "max_output_tokens" } },
    { ...response([{ ...message(), content: null }], "incomplete"), incomplete_details: { reason: "max_output_tokens" } },
  ])("rejects non-token and malformed incomplete payloads: %j", async data => {
    const fetch = mockFetch().mockResolvedValue(Response.json(data));
    await expect(provider({ maxRetries: 2 }).completeTurn!(request)).rejects.toMatchObject({ retryable: false, tokenUsage: { output: 20 } });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("round trips parallel calls, failed results and encrypted reasoning over multiple turns", async () => {
    const fetch = mockFetch()
      .mockResolvedValueOnce(Response.json(response([reasoning, call("a"), call("b", "b.txt")])))
      .mockResolvedValueOnce(Response.json(response([call("c", "c.txt")])))
      .mockResolvedValueOnce(Response.json(response()));
    const client = provider();
    const first = await client.completeTurn!(request);
    expect(first.stopReason).toBe("tool_use");
    expect(first.message.toolCalls).toEqual([
      { id: "a", name: tool.name, arguments: { path: "a.txt" } },
      { id: "b", name: tool.name, arguments: { path: "b.txt" } },
    ]);
    expect(first.tokenUsage).toEqual({ input: 60, output: 20, cacheReadInput: 30, cacheCreationInput: 10 });
    expect(first).toMatchObject({ effort: "high", usageStatus: "measured", model: request.model });
    const next: ProviderTurnRequest = { ...request, messages: [...request.messages, first.message,
      { role: "tool", toolCallId: "b", content: "permission denied", isError: true },
      { role: "tool", toolCallId: "a", content: "file contents" }] };
    const second = await client.completeTurn!(next);
    const third = await client.completeTurn!({ ...next, messages: [...next.messages, second.message, { role: "tool", toolCallId: "c", content: "ok" }] });
    expect(third).toMatchObject({ stopReason: "end_turn", text: "Finished" });
    const [url, init] = fetch.mock.calls[1];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init).toMatchObject({ redirect: "error", headers: { Authorization: "Bearer fixture-secret" } });
    const body = JSON.parse(init!.body as string);
    expect(body).toMatchObject({ store: false, max_output_tokens: 8192, reasoning: { effort: "high" },
      tools: [{ type: "function", name: tool.name, strict: false, parameters: { required: ["path"] } }] });
    expect(body.input.slice(1, 4)).toEqual([reasoning, call("a"), call("b", "b.txt")]);
    expect(body.input[4]).toEqual({ type: "function_call_output", call_id: "b", output: '{"error":"permission denied"}' });
    expect(JSON.stringify(first)).not.toContain("fixture-secret");
    expect(JSON.stringify(body)).not.toContain("fixture-secret");
  });

  it("reports only verified tool capabilities and rejects unsupported pins before fetch", async () => {
    const fetch = mockFetch();
    expect(provider().info.capabilities).toEqual(["streaming", "function-calling"]);
    const client = provider({ codexConfig: { api_key: "fixture-secret", model: "custom-model" } });
    expect(client.info.capabilities).toEqual(["streaming"]);
    await expect(client.completeTurn!({ ...request, model: "custom-model" })).rejects.toThrow("no verified");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps configured endpoints and explicit model pins", async () => {
    const fetch = mockFetch().mockResolvedValue(Response.json(response()));
    await provider({ codexConfig: { api_key: "fixture-secret", api_endpoint: "https://trusted.example/v1" } })
      .completeTurn!({ ...request, model: "gpt-6-astra" });
    expect(fetch.mock.calls[0][0]).toBe("https://trusted.example/v1/responses");
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string).model).toBe("gpt-6-astra");
  });

  it.each([401, 403])("classifies authentication %s without echoing secrets or retrying", async status => {
    const fetch = mockFetch().mockResolvedValue(new Response("fixture-secret", { status }));
    await expect(provider({ maxRetries: 3 }).completeTurn!(request)).rejects.toMatchObject({ reason: "auth", retryable: false, httpStatus: status, message: "OpenAI authentication failed" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a long Retry-After without waiting or retrying early", async () => {
    const fetch = mockFetch().mockResolvedValue(new Response("fixture-secret", { status: 429, headers: { "retry-after": "120" } }));
    await expect(provider({ maxRetries: 3 }).completeTurn!(request)).rejects.toMatchObject({ reason: "rate-limit", retryAfterMs: 120000 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sanitizes network errors and exhausts the retry budget", async () => {
    const fetch = mockFetch().mockRejectedValue(new Error("fixture-secret"));
    await expect(provider({ maxRetries: 1, baseDelayMs: 0 }).completeTurn!(request)).rejects.toMatchObject({ message: "OpenAI connection failed", reason: "network", retryable: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves usage provenance when counters are missing or malformed", async () => {
    const fetch = mockFetch();
    for (const [usageValue, usageStatus] of [[undefined, "unavailable"], [{ input_tokens: 10 }, "partial"], [{ input_tokens: -1, output_tokens: 3 }, "malformed"]] as const) {
      fetch.mockResolvedValueOnce(Response.json({ ...response(), usage: usageValue }));
      expect((await provider().completeTurn!(request)).usageStatus).toBe(usageStatus);
    }
  });

  it("omits unsupported effort once without relabeling it as effective", async () => {
    const warning = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetch = mockFetch().mockResolvedValue(Response.json(response()));
    const result = await provider().completeTurn!({ ...request, effort: "none" });
    expect(JSON.parse(fetch.mock.calls[0][1]!.body as string)).not.toHaveProperty("reasoning");
    expect(result.effort).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("retries transient HTTP errors within a finite budget", async () => {
    const fetch = mockFetch().mockResolvedValueOnce(new Response("secret", { status: 429 })).mockResolvedValueOnce(Response.json(response()));
    expect((await provider({ maxRetries: 1, baseDelayMs: 0 }).completeTurn!(request)).text).toBe("Finished");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    response([{ ...call(), arguments: "{broken" }]),
    response([{ ...call(), arguments: "[]" }]),
    response([call(), call()]),
    response([{ ...call(), name: "unadvertised_tool" }]),
    response([{ type: "computer_call" }]),
    response([call()], "incomplete"),
    response([], "completed"),
    { ...response(), output: null },
  ])("rejects malformed/incomplete output without releasing calls", async data => {
    mockFetch().mockResolvedValue(Response.json(data));
    await expect(provider().completeTurn!(request)).rejects.toMatchObject({ retryable: false, tokenUsage: { input: 60, output: 20 } });
  });

  it("does not retry invalid JSON and does not leak it", async () => {
    const fetch = mockFetch().mockResolvedValue(new Response("fixture-secret"));
    await expect(provider({ maxRetries: 3 }).completeTurn!(request)).rejects.toMatchObject({ message: "Invalid OpenAI Responses payload or conversation", retryable: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("surfaces refusal without tools", async () => {
    mockFetch().mockResolvedValue(Response.json(response([{ type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Cannot comply" }] }])));
    expect(await provider().completeTurn!(request)).toMatchObject({ stopReason: "refusal", text: "Cannot comply", message: { toolCalls: [] } });
  });

  it("rejects missing, duplicate and orphan tool results before sending", async () => {
    const fetch = mockFetch();
    const assistant = { role: "assistant" as const, content: "", toolCalls: [{ id: "a", name: tool.name, arguments: {} }] };
    for (const messages of [
      [...request.messages, assistant],
      [...request.messages, { role: "tool" as const, content: "orphan", toolCallId: "a" }],
      [...request.messages, assistant, { role: "tool" as const, content: "ok", toolCallId: "a" }, { role: "tool" as const, content: "duplicate", toolCallId: "a" }],
    ]) await expect(provider().completeTurn!({ ...request, messages })).rejects.toThrow("conversation");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    response([call("a")]),
    ...[call("a"), { ...call("b"), name: "unadvertised_tool" }].map(item => ({
      ...response([{ ...item, status: "incomplete", arguments: "{" }], "incomplete"),
      incomplete_details: { reason: "max_output_tokens" },
    })),
  ])("rejects reused call IDs and unadvertised tools even when arguments are truncated", async data => {
    mockFetch().mockResolvedValue(Response.json(data));
    await expect(provider().completeTurn!({ ...request, messages: [...request.messages,
      { role: "assistant", content: "", toolCalls: [{ id: "a", name: tool.name, arguments: {} }] },
      { role: "tool", toolCallId: "a", content: "already executed" },
    ] })).rejects.toMatchObject({ retryable: false, tokenUsage: { output: 20 } });
  });

  it("does not replay opaque context across models", async () => {
    const fetch = mockFetch().mockResolvedValue(Response.json(response()));
    const result = await provider().completeTurn!(request);
    await expect(provider().completeTurn!({ ...request, model: "gpt-6-astra", messages: [...request.messages, result.message] })).rejects.toThrow("conversation");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves cancellation during backoff with no second request", async () => {
    const abort = new AbortController();
    const fetch = mockFetch().mockImplementation(async () => {
      setTimeout(() => abort.abort(), 0);
      return new Response("fixture-secret", { status: 429 });
    });
    await expect(provider({ maxRetries: 3, baseDelayMs: 10000 }).completeTurn!({ ...request, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError", message: "OpenAI request cancelled" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("passes cancellation into fetch and makes timeout distinct", async () => {
    mockFetch().mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("fixture-secret")), { once: true });
    }));
    await expect(provider().completeTurn!({ ...request, timeoutMs: 1 })).rejects.toMatchObject({ reason: "timeout", retryable: true });
  });

  it("does not fetch an already cancelled request", async () => {
    const fetch = mockFetch();
    await expect(provider().completeTurn!({ ...request, signal: AbortSignal.abort("fixture-secret") })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Responses SSE", () => {
  it("finishes a token-limited stream without releasing or replaying any function calls", async () => {
    const partial = { ...call(), arguments: '{"path":', status: "incomplete" };
    const fetch = mockFetch().mockResolvedValueOnce(sse([
      { type: "response.output_item.added", output_index: 2, item: { ...partial, arguments: "", status: "in_progress" } },
      { type: "response.function_call_arguments.delta", output_index: 2, item_id: partial.id, delta: partial.arguments },
      { type: "response.output_text.delta", delta: "Working" },
      { type: "response.incomplete", response: { ...response([reasoning, { ...message("Working"), status: "incomplete" }, partial], "incomplete"), incomplete_details: { reason: "max_output_tokens" } } },
    ])).mockResolvedValueOnce(Response.json(response()));
    const events = await collect();
    expect(events).toHaveLength(2);
    const final = events[1];
    expect(final).toMatchObject({ type: "completed", result: { stopReason: "max_tokens", usageStatus: "measured", tokenUsage: { output: 20 }, message: { toolCalls: [] } } });
    if (final.type !== "completed") throw new Error("missing terminal result");
    await provider().completeTurn!({ ...request, messages: [...request.messages, final.result.message, { role: "user", content: "Continue" }] });
    expect(JSON.parse(fetch.mock.calls[1][1]!.body as string).input.some((item: any) => item.type === "function_call")).toBe(false);
  });

  it.each([[], [reasoning]].map(items => [items]))("accepts reasoning-only token exhaustion over SSE: %j", async items => {
    mockFetch().mockResolvedValue(sse([{ type: "response.incomplete", response: {
      ...response(items, "incomplete"), incomplete_details: { reason: "max_output_tokens" },
    } }]));
    expect(await collect()).toMatchObject([{ type: "completed", result: { stopReason: "max_tokens", text: "", usageStatus: "measured" } }]);
  });

  it("retains earlier usage as partial when a token-limited terminal event omits counters", async () => {
    mockFetch().mockResolvedValue(sse([
      { type: "response.in_progress", response: response([], "in_progress") },
      { type: "response.incomplete", response: { ...response([], "incomplete"), usage: undefined,
        incomplete_details: { reason: "max_output_tokens" } } },
    ]));
    expect(await collect()).toMatchObject([{ type: "completed", result: {
      stopReason: "max_tokens", usageStatus: "partial", tokenUsage: { input: 60, output: 20 },
    } }]);
  });

  it.each([
    { type: "response.completed", response: { ...response([], "incomplete"), incomplete_details: { reason: "max_output_tokens" } } },
    { type: "response.incomplete", response: response() },
    { type: "response.failed", response: response() },
    { type: "response.incomplete", response: { ...response([], "incomplete"), incomplete_details: { reason: "content_filter" } } },
  ])("rejects inconsistent or unsupported terminal events: %j", async event => {
    mockFetch().mockResolvedValue(sse([event]));
    await expect(collect()).rejects.toMatchObject({ retryable: false, tokenUsage: { output: 20 } });
  });

  it("handles split UTF-8, CRLF, interleaved calls, and terminal usage exactly once", async () => {
    const a = call("a"); const b = call("b", "b.txt");
    mockFetch().mockResolvedValue(sse([
      { type: "response.output_item.added", output_index: 1, item: { ...a, arguments: "", status: "in_progress" } },
      { type: "response.output_item.added", output_index: 2, item: { ...b, arguments: "", status: "in_progress" } },
      { type: "response.function_call_arguments.delta", output_index: 2, item_id: b.id, delta: b.arguments },
      { type: "response.output_text.delta", delta: "Voilà" },
      { type: "response.function_call_arguments.delta", output_index: 1, item_id: a.id, delta: a.arguments.slice(0, 3) },
      { type: "response.function_call_arguments.delta", output_index: 1, item_id: a.id, delta: a.arguments.slice(3) },
      { type: "response.function_call_arguments.done", output_index: 1, item_id: a.id, arguments: a.arguments },
      { type: "response.completed", response: response([message("Voilà"), a, b, reasoning]) },
    ], 1));
    const events = await collect();
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: "text_delta", text: "Voilà" });
    expect(events[1]).toMatchObject({ type: "completed", result: { stopReason: "tool_use", tokenUsage: { input: 60, output: 20 }, message: { toolCalls: [{ id: "a" }, { id: "b" }] } } });
  });

  it.each([
    [{ type: "response.function_call_arguments.delta", item_id: "missing", output_index: 0, delta: "{}" }],
    [{ type: "response.output_item.added", output_index: 0, item: { ...call(), arguments: "" } }, { type: "response.completed", response: response([call()]) }],
    [{ type: "response.completed", response: response([{ ...call(), arguments: "nope" }]) }],
    [{ type: "response.incomplete", response: response([call()], "incomplete") }],
    [{ type: "error", code: "invalid_api_key", message: "fixture-secret" }],
    [{ type: "response.failed", response: { ...response([], "failed"), error: { code: "server_error", message: "fixture-secret" } } }],
  ])("rejects damaged/error streams without a completed event", async (...events) => {
    mockFetch().mockResolvedValue(sse(events));
    await expect(collect()).rejects.toBeInstanceOf(Error);
  });

  it("honors cancellation between events from the same read", async () => {
    const abort = new AbortController();
    mockFetch().mockResolvedValue(sse([
      { type: "response.output_text.delta", delta: "ready" },
      { type: "response.completed", response: response([message("ready"), call()]) },
    ], 65536));
    const stream = provider().streamTurn!({ ...request, signal: abort.signal })[Symbol.asyncIterator]();
    expect((await stream.next()).value).toEqual({ type: "text_delta", text: "ready" });
    abort.abort();
    await expect(stream.next()).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects EOF before the terminal SSE record delimiter", async () => {
    const event = { type: "response.completed", response: response([call()]) };
    mockFetch().mockResolvedValue(new Response(`data: ${JSON.stringify(event)}\n`));
    await expect(collect()).rejects.toMatchObject({ reason: "network" });
  });

  it("retains usage on premature EOF but never reports completion", async () => {
    mockFetch().mockResolvedValue(sse([{ type: "response.in_progress", response: response([], "in_progress") }]));
    await expect(collect()).rejects.toMatchObject({ reason: "network", usageStatus: "partial", tokenUsage: { input: 60, output: 20 } });
  });

  it.each([undefined, { input_tokens: "broken", output_tokens: 21 }])("retains earlier spend when terminal usage is damaged: %s", async terminal => {
    mockFetch().mockResolvedValue(sse([
      { type: "response.in_progress", response: response([], "in_progress") },
      { type: "response.completed", response: { ...response(), usage: terminal } },
    ]));
    const events = await collect();
    expect(events[0]).toMatchObject({ type: "completed", result: {
      tokenUsage: { input: 60, output: terminal ? 21 : 20, cacheReadInput: 30, cacheCreationInput: 10 },
      usageStatus: terminal ? "malformed" : "partial",
    } });
  });

  it("rejects malformed SSE JSON", async () => {
    mockFetch().mockResolvedValue(new Response('data: {fixture-secret\n\n'));
    await expect(collect()).rejects.toMatchObject({ message: "Invalid OpenAI Responses payload or conversation" });
  });

  it("keeps stream cancellation non-retryable even when reader cleanup rejects", async () => {
    const abort = new AbortController();
    mockFetch().mockImplementation(async (_url, init) => new Response(new ReadableStream({
      start(controller) {
        init!.signal!.addEventListener("abort", () => controller.error(new Error("fixture-secret")), { once: true });
        setTimeout(() => abort.abort("fixture-secret"), 0);
      },
    })));
    await expect(collect({ ...request, signal: abort.signal })).rejects.toMatchObject({ name: "AbortError", message: "OpenAI request cancelled" });
  });

  it("classifies streamed authentication failures without exposing payload text", async () => {
    mockFetch().mockResolvedValue(sse([{ type: "error", code: "invalid_api_key", message: "fixture-secret" }]));
    await expect(collect()).rejects.toMatchObject({ reason: "auth", retryable: false, message: "OpenAI authentication failed" });
  });

  it("cancels the reader on early consumer return", async () => {
    const cancel = vi.fn();
    mockFetch().mockResolvedValue(new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"response.output_text.delta","delta":"hi"}\n\n')); }, cancel,
    })));
    for await (const event of provider().streamTurn!(request)) { expect(event.type).toBe("text_delta"); break; }
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
