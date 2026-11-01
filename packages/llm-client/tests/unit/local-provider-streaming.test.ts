/**
 * Local provider: streamed completions and malformed-output resends.
 *
 * Two failures seen running `ndx work` against LM Studio with a slow model:
 *
 *   1. Node's fetch gives up after 300 s without response headers
 *      (UND_ERR_HEADERS_TIMEOUT), and LM Studio sends none for a non-streamed
 *      completion until generation ends — so `llm.local.timeoutMs: 0` did not
 *      mean "no limit". Completions are now requested streamed, which gets the
 *      headers at once, and assembled back into the non-streamed response;
 *      `llm.local.timeoutMs` still bounds the whole request.
 *   2. A 400 saying the model's output "does not match the expected … format"
 *      ended the run. It is now resent up to `llm.local.maxFormatRetries` —
 *      and so is the same error when it arrives inside the stream, which is
 *      how LM Studio reports a failure once a streamed response has begun.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  createLocalApiProvider,
  fetchLocalCompletion,
  fetchLocalWithRetry,
  isLocalModelOutputError,
  resolveLocalRetryPolicy,
  DEFAULT_LOCAL_MAX_FORMAT_RETRIES,
} from "../../src/local-api-provider.js";
import { assembleLocalChatStream } from "../../src/local-chat-stream.js";
import { ClaudeClientError } from "../../src/types.js";

/** LM Studio's answer when the model emitted a malformed tool call. */
const MALFORMED_BODY = JSON.stringify({
  error:
    "Engine protocol predict stream returned an error: " +
    JSON.stringify({
      code: 500,
      message: "The model produced output that does not match the expected peg-native format",
      type: "server_error",
    }),
});

const CONTEXT_BODY = JSON.stringify({
  error: { message: "The request (9,000 tokens) exceeds the available context size (4,096 tokens)" },
});

/** A context overflow as LM Studio reports it inside a stream (captured from LM Studio 0.3.x). */
const IN_STREAM_CONTEXT_ERROR =
  "event: error\n" +
  "data: " + JSON.stringify({
    error: {
      message:
        "Engine protocol predict request returned 400: " +
        JSON.stringify({ error: { code: 400, message: "request (240315 tokens) exceeds the available context size (128000 tokens), try increasing it" } }),
    },
  }) + "\n\n";

const IN_STREAM_MALFORMED_ERROR =
  "event: error\n" +
  "data: " + JSON.stringify({
    error: {
      message:
        "Engine protocol predict stream returned an error: The model produced output that does not match the expected peg-native format",
    },
  }) + "\n\n";

/** The non-streamed completion the chunks below must assemble into. */
const EXPECTED_MESSAGE = {
  role: "assistant",
  content: "Reading it.",
  reasoning: "Need the file.",
  tool_calls: [
    { id: "call-a", type: "function", function: { name: "read_file", arguments: '{"path":"src/a.ts"}' } },
    { id: "call-b", type: "function", function: { name: "git", arguments: '{"subcommand":"status"}' } },
  ],
};
const EXPECTED_USAGE = { prompt_tokens: 371, completion_tokens: 39, total_tokens: 410 };

function chunk(delta: Record<string, unknown>, finish: string | null = null): string {
  return "data: " + JSON.stringify({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model: "openai/gpt-oss-20b",
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finish }],
  }) + "\n\n";
}

/**
 * A streamed completion in LM Studio's shape: reasoning, then content, then two
 * tool calls whose arguments arrive in fragments (the second interleaved with
 * the first), the finish_reason chunk, the include_usage chunk and [DONE].
 */
const STREAM_PARTS: string[] = [
  chunk({ role: "assistant", reasoning: "Need" }),
  chunk({ reasoning: " the file." }),
  chunk({ content: "Reading" }),
  chunk({ content: " it." }),
  chunk({ tool_calls: [{ index: 0, id: "call-a", type: "function", function: { name: "read_file", arguments: "" } }] }),
  chunk({ tool_calls: [{ index: 0, type: "function", function: { arguments: '{"pa' } }] }),
  chunk({ tool_calls: [{ index: 1, id: "call-b", type: "function", function: { name: "git", arguments: '{"sub' } }] }),
  chunk({ tool_calls: [{ index: 0, type: "function", function: { arguments: 'th":"src/a.ts"}' } }] }),
  chunk({ tool_calls: [{ index: 1, type: "function", function: { arguments: 'command":"status"}' } }] }),
  chunk({}, "tool_calls"),
  "data: " + JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", choices: [], usage: EXPECTED_USAGE }) + "\n\n",
  "data: [DONE]\n\n",
];

const noSleep = async (): Promise<void> => {};

let server: Server | undefined;
afterEach(async () => {
  vi.unstubAllGlobals();
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server!.close(r));
  }
  server = undefined;
});

type Handler = (req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>, call: number) => void;

/** Start a local chat server; `requests` collects every parsed request body. */
async function startServer(handler: Handler): Promise<{ baseUrl: string; requests: Array<Record<string, unknown>> }> {
  const requests: Array<Record<string, unknown>> = [];
  server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
      requests.push(body);
      handler(req, res, body, requests.length);
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { baseUrl: `http://127.0.0.1:${port}/v1`, requests };
}

/** Send headers now, then each part after `gapMs`. */
function streamParts(res: ServerResponse, parts: string[], gapMs = 5, firstDelayMs = 0): void {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  res.flushHeaders();
  let i = 0;
  const next = (): void => {
    if (res.destroyed) return;
    if (i >= parts.length) { res.end(); return; }
    res.write(parts[i++]);
    setTimeout(next, gapMs);
  };
  setTimeout(next, firstDelayMs);
}

function streamFrom(parts: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
}

describe("assembling a streamed completion", () => {
  it("gives the non-streamed shape: content, reasoning, tool calls merged by index, finish_reason, usage", async () => {
    const out = await assembleLocalChatStream(streamFrom(STREAM_PARTS));
    expect("completion" in out).toBe(true);
    const completion = (out as { completion: Record<string, unknown> }).completion;
    expect(completion["choices"]).toEqual([{ index: 0, message: EXPECTED_MESSAGE, finish_reason: "tool_calls" }]);
    expect(completion["usage"]).toEqual(EXPECTED_USAGE);
    expect(completion["model"]).toBe("openai/gpt-oss-20b");
  });

  it("survives chunks split mid-line and mid-character", async () => {
    const whole = STREAM_PARTS.join("");
    const bytes = new TextEncoder().encode(whole);
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) pieces.push(bytes.slice(i, i + 7));
    const out = await assembleLocalChatStream(new ReadableStream({
      start(c) { for (const p of pieces) c.enqueue(p); c.close(); },
    }));
    const completion = (out as { completion: Record<string, unknown> }).completion;
    expect((completion["choices"] as Array<{ message: unknown }>)[0]!.message).toEqual(EXPECTED_MESSAGE);
  });

  it("tolerates a stream with no usage chunk and no tool calls", async () => {
    const out = await assembleLocalChatStream(streamFrom([
      chunk({ role: "assistant", content: "PASS" }),
      chunk({ content: "\nLooks right." }, "stop"),
      "data: [DONE]\n\n",
    ]));
    const completion = (out as { completion: Record<string, unknown> }).completion;
    expect(completion["usage"]).toBeUndefined();
    expect(completion["choices"]).toEqual([
      { index: 0, message: { role: "assistant", content: "PASS\nLooks right." }, finish_reason: "stop" },
    ]);
  });

  it("returns an in-stream error event verbatim", async () => {
    const out = await assembleLocalChatStream(streamFrom([chunk({ role: "assistant" }), IN_STREAM_MALFORMED_ERROR]));
    expect("error" in out).toBe(true);
    expect((out as { error: string }).error).toContain("does not match the expected peg-native format");
  });
});

describe("fetchLocalCompletion", () => {
  it("asks for a stream with usage and returns the assembled completion", async () => {
    const { baseUrl, requests } = await startServer((_req, res) => streamParts(res, STREAM_PARTS));
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, { messages: [], tools: [] }, {
      baseUrl, timeoutMs: 5_000,
    });
    expect(res.status).toBe(200);
    const data = await res.json() as Record<string, unknown>;
    expect((data["choices"] as Array<{ message: unknown }>)[0]!.message).toEqual(EXPECTED_MESSAGE);
    expect(data["usage"]).toEqual(EXPECTED_USAGE);
    expect(requests[0]).toMatchObject({ stream: true, stream_options: { include_usage: true }, tools: [] });
  });

  it("passes a plain JSON answer through when the server does not stream", async () => {
    const plain = { choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } };
    const { baseUrl } = await startServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(plain));
    });
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, { baseUrl, timeoutMs: 5_000 });
    expect(await res.json()).toEqual(plain);
  });

  it("holds llm.local.timeoutMs over the whole read: headers at once, first token too late, not retried", async () => {
    const { baseUrl, requests } = await startServer((_req, res) => streamParts(res, STREAM_PARTS, 5, 600));
    const err = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, {
      baseUrl, timeoutMs: 200, sleep: noSleep,
    }).catch((e: unknown) => e);
    expect((err as Error).name).toBe("AbortError");
    expect(requests).toHaveLength(1);
  });

  it("with llm.local.timeoutMs 0 waits as long as the stream takes", async () => {
    const { baseUrl } = await startServer((_req, res) => streamParts(res, STREAM_PARTS, 5, 300));
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, { baseUrl, timeoutMs: 0 });
    expect(res.status).toBe(200);
  });

  it("retries a connection dropped mid-stream like a refused one", async () => {
    const { baseUrl, requests } = await startServer((_req, res, _body, call) => {
      if (call === 1) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(STREAM_PARTS[0]);
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      streamParts(res, STREAM_PARTS);
    });
    const notices: unknown[] = [];
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, {
      baseUrl, timeoutMs: 5_000, sleep: noSleep, onRetry: (n) => notices.push(n),
    });
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(2);
    expect(notices).toHaveLength(1);
  });
});

describe("malformed model output", () => {
  it("is recognised narrowly", () => {
    expect(isLocalModelOutputError(400, MALFORMED_BODY)).toBe(true);
    expect(isLocalModelOutputError(500, "Failed to parse tool call arguments")).toBe(true);
    expect(isLocalModelOutputError(400, "Invalid tool call: missing name")).toBe(true);
    // Ordinary 400s are not the model's output.
    expect(isLocalModelOutputError(400, CONTEXT_BODY)).toBe(false);
    expect(isLocalModelOutputError(400, '{"error":"Failed to parse request body as JSON"}')).toBe(false);
    expect(isLocalModelOutputError(400, '{"error":"\'messages\' field is required"}')).toBe(false);
    // Only 400 and 500.
    expect(isLocalModelOutputError(422, MALFORMED_BODY)).toBe(false);
  });

  it("defaults to 3 resends and reads llm.local.maxFormatRetries", () => {
    expect(DEFAULT_LOCAL_MAX_FORMAT_RETRIES).toBe(3);
    expect(resolveLocalRetryPolicy(undefined).maxFormatRetries).toBe(3);
    expect(resolveLocalRetryPolicy({ maxFormatRetries: 0 }).maxFormatRetries).toBe(0);
    expect(resolveLocalRetryPolicy({ maxFormatRetries: 5 }, { maxFormatRetries: 1 }).maxFormatRetries).toBe(1);
  });

  it("as a 400 is resent, reported once per resend, and then succeeds", async () => {
    const { baseUrl, requests } = await startServer((_req, res, _body, call) => {
      if (call <= 2) { res.writeHead(400, { "Content-Type": "application/json" }); res.end(MALFORMED_BODY); return; }
      streamParts(res, STREAM_PARTS);
    });
    const notices: Array<{ attempt: number; maxRetries: number; error: string }> = [];
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, {
      baseUrl, timeoutMs: 5_000, sleep: noSleep, onFormatRetry: (n) => notices.push(n),
    });
    expect(res.status).toBe(200);
    expect(requests).toHaveLength(3);
    expect(notices.map((n) => n.attempt)).toEqual([1, 2]);
    expect(notices[0]!.maxRetries).toBe(3);
    expect(notices[0]!.error).toContain("does not match the expected peg-native format");
  });

  it("inside the stream is resent and then succeeds", async () => {
    const { baseUrl, requests } = await startServer((_req, res, _body, call) => {
      if (call === 1) { streamParts(res, [chunk({ role: "assistant", reasoning: "Hm" }), IN_STREAM_MALFORMED_ERROR]); return; }
      streamParts(res, STREAM_PARTS);
    });
    const notices: Array<{ error: string }> = [];
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, {
      baseUrl, timeoutMs: 5_000, sleep: noSleep, onFormatRetry: (n) => notices.push(n),
    });
    const data = await res.json() as Record<string, unknown>;
    expect((data["choices"] as Array<{ message: unknown }>)[0]!.message).toEqual(EXPECTED_MESSAGE);
    expect(requests).toHaveLength(2);
    expect(notices[0]!.error).toContain("does not match the expected peg-native format");
  });

  it("is resent by the provider's complete() until it succeeds", async () => {
    const { baseUrl, requests } = await startServer((_req, res, _body, call) => {
      if (call === 1) { streamParts(res, [IN_STREAM_MALFORMED_ERROR]); return; }
      streamParts(res, STREAM_PARTS);
    });
    const port = Number(new URL(baseUrl).port);
    const provider = createLocalApiProvider({ localConfig: { host: "127.0.0.1", port }, sleep: noSleep });
    const result = await provider.complete({ prompt: "hi", model: "" });
    expect(result.text).toBe("Reading it.");
    expect(result.tokenUsage).toMatchObject({ input: 371, output: 39 });
    expect(requests).toHaveLength(2);
  });

  it("an ordinary 400 is not resent", async () => {
    const { baseUrl, requests } = await startServer((_req, res) => {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(CONTEXT_BODY);
    });
    const port = Number(new URL(baseUrl).port);
    const provider = createLocalApiProvider({ localConfig: { host: "127.0.0.1", port }, sleep: noSleep });
    const err = await provider.complete({ prompt: "hi", model: "" }).catch((e: unknown) => e);
    expect(requests).toHaveLength(1);
    expect((err as Error).message).toContain("Context window too small");
  });

  it("an ordinary in-stream error is not resent and reads like its 400", async () => {
    const { baseUrl, requests } = await startServer((_req, res) => streamParts(res, [IN_STREAM_CONTEXT_ERROR]));
    const port = Number(new URL(baseUrl).port);
    const provider = createLocalApiProvider({ localConfig: { host: "127.0.0.1", port }, sleep: noSleep });
    const err = await provider.complete({ prompt: "hi", model: "" }).catch((e: unknown) => e);
    expect(requests).toHaveLength(1);
    expect(err).toBeInstanceOf(ClaudeClientError);
    expect((err as Error).message).toContain("Context window too small");
    expect((err as Error).message).toContain("128,000");
  });

  it("when resends run out, says what happened and names llm.local.maxFormatRetries", async () => {
    const { baseUrl, requests } = await startServer((_req, res) => streamParts(res, [IN_STREAM_MALFORMED_ERROR]));
    const err = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, {
      baseUrl, timeoutMs: 5_000, sleep: noSleep, policy: { maxFormatRetries: 2 },
    }).catch((e: unknown) => e);
    expect(requests).toHaveLength(3);
    expect(err).toBeInstanceOf(ClaudeClientError);
    const message = (err as Error).message;
    expect(message).toContain("produced malformed output");
    expect(message).toContain("3 times in a row");
    expect(message).toContain("does not match the expected peg-native format");
    expect(message).toContain("llm.local.maxFormatRetries (now 2)");
  });

  it("0 disables resending (the HTTP 400 form, through fetchLocalWithRetry)", async () => {
    const fetchMock = vi.fn(async () => new Response(MALFORMED_BODY, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchLocalWithRetry("http://x/v1/c", {}, {
      baseUrl: "http://x/v1",
      timeoutMs: 0,
      sleep: noSleep,
      localConfig: { maxFormatRetries: 0 },
    })).rejects.toThrow(/llm\.local\.maxFormatRetries \(now 0\)/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("with resend: false comes back once as a 400 for the caller to judge", async () => {
    const { baseUrl, requests } = await startServer((_req, res) => streamParts(res, [IN_STREAM_MALFORMED_ERROR]));
    const res = await fetchLocalCompletion(`${baseUrl}/chat/completions`, {}, { baseUrl, timeoutMs: 5_000, resend: false });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("does not match the expected peg-native format");
    expect(requests).toHaveLength(1);
  });
});
