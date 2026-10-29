/**
 * Local provider connection retries.
 *
 * A run against LM Studio died with "Cannot reach local server …: fetch
 * failed" because a refused connection was retried three times over ~7 s and
 * then thrown as a non-retryable "unknown" error — a model reload outlasts
 * that. Network failures are now retried on `llm.local.maxRetries` /
 * `retryBaseDelayMs` / `retryMaxDelayMs` (about two minutes by default) and,
 * once those run out, thrown as a retryable "network" error that names the
 * server, the attempts and the settings to raise.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createLocalApiProvider,
  fetchLocalWithRetry,
  isLocalNetworkError,
  resolveLocalRetryPolicy,
  DEFAULT_LOCAL_MAX_RETRIES,
  DEFAULT_LOCAL_RETRY_BASE_DELAY_MS,
  DEFAULT_LOCAL_RETRY_MAX_DELAY_MS,
} from "../../src/local-api-provider.js";
import { loadLLMConfig } from "../../src/llm-config.js";
import { ClaudeClientError } from "../../src/types.js";
import { mapErrorReasonToFailureCategory } from "../../src/runtime-contract.js";

/** A port nothing listens on: bind one, then let it go. */
async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((r) => probe.close(() => r()));
  return port;
}

/** A fake LM Studio: answers every chat completion with `text`. */
function chatServer(text: string): Server {
  return createServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{ message: { role: "assistant", content: text } }],
        usage: { prompt_tokens: 10, completion_tokens: 2 },
      }));
    });
  });
}

function fetchFailed(code: string): TypeError {
  const err = new TypeError("fetch failed");
  (err as { cause?: unknown }).cause = Object.assign(new Error(`connect ${code} 127.0.0.1:1234`), { code });
  return err;
}

const servers: Server[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  for (const s of servers.splice(0)) await new Promise<void>((r) => s.close(() => r()));
});

describe("local provider connection retries", () => {
  it("survives a server that is down for 60 s and then answers", async () => {
    const port = await freePort();
    let virtualMs = 0;
    let started = false;
    // Real refused connections against a real port; the waits run on a
    // virtual clock, and the server comes up once 60 s of them have passed.
    const sleep = async (ms: number) => {
      virtualMs += ms;
      if (virtualMs >= 60_000 && !started) {
        started = true;
        const server = chatServer("back online");
        servers.push(server);
        await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
      }
    };
    const provider = createLocalApiProvider({
      localConfig: { host: "127.0.0.1", port },
      sleep,
    });

    const result = await provider.complete({ prompt: "hello", model: "" });

    expect(result.text).toBe("back online");
    expect(virtualMs).toBeGreaterThanOrEqual(60_000);
    // The default schedule: 2 + 4 + 8 + 16 + 32 s before the sixth attempt.
    expect(virtualMs).toBe(62_000);
  });

  it("retries the streaming connection too", async () => {
    const encoder = new TextEncoder();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async () => {
      calls++;
      if (calls < 3) throw fetchFailed("ECONNRESET");
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      }), { status: 200 });
    }));
    const provider = createLocalApiProvider({ sleep: async () => {} });

    const chunks: string[] = [];
    for await (const chunk of provider.stream!({ prompt: "x", model: "" })) {
      if (chunk.text) chunks.push(chunk.text);
    }
    expect(chunks.join("")).toBe("hi");
    expect(calls).toBe(3);
  });

  it("throws a retryable network error naming the server, attempts and settings when retries run out", async () => {
    const port = await freePort();
    const provider = createLocalApiProvider({
      localConfig: { host: "127.0.0.1", port, maxRetries: 2, retryBaseDelayMs: 1000 },
      sleep: async () => {},
    });

    const err = await provider.complete({ prompt: "x", model: "" }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ClaudeClientError);
    const e = err as ClaudeClientError;
    expect(e.reason).toBe("network");
    expect(e.retryable).toBe(true);
    expect(e.message).toContain(`http://127.0.0.1:${port}/v1`);
    expect(e.message).toContain("after 3 attempts");
    expect(e.message).toContain("llm.local.maxRetries (now 2)");
    expect(e.message).toContain("llm.local.retryBaseDelayMs (now 1000)");
    expect(e.message).toContain("llm.local.retryMaxDelayMs");
    expect(mapErrorReasonToFailureCategory(e.reason)).toBe("transient_exhausted");
  });

  it("does not retry a timeout, which keeps its own error", async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException("This operation was aborted", "AbortError");
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = createLocalApiProvider({ timeoutMs: 50, sleep: async () => {} });

    const err = await provider.complete({ prompt: "x", model: "" }).catch((e: unknown) => e) as ClaudeClientError;

    expect(err.reason).toBe("timeout");
    expect(err.message).toContain("llm.local.timeoutMs");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an error that is not a connection failure", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Invalid URL");
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchLocalWithRetry("http://x/v1/chat/completions", {}, { baseUrl: "http://x/v1", timeoutMs: 0, sleep: async () => {} }),
    ).rejects.toThrow("Invalid URL");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps each wait at retryMaxDelayMs and reports every retry", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw fetchFailed("ECONNREFUSED"); }));
    const waits: number[] = [];
    const notices: number[] = [];
    await fetchLocalWithRetry("http://h/v1/x", {}, {
      baseUrl: "http://h/v1",
      timeoutMs: 0,
      localConfig: { maxRetries: 4, retryBaseDelayMs: 1000, retryMaxDelayMs: 3000 },
      sleep: async (ms) => { waits.push(ms); },
      onRetry: (n) => notices.push(n.attempt),
    }).catch(() => undefined);
    expect(waits).toEqual([1000, 2000, 3000, 3000]);
    expect(notices).toEqual([1, 2, 3, 4]);
  });
});

describe("isLocalNetworkError", () => {
  it.each(["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"])(
    "is true for fetch failed caused by %s",
    (code) => {
      expect(isLocalNetworkError(fetchFailed(code))).toBe(true);
    },
  );

  it("is true for a bare 'fetch failed' and a socket hang up", () => {
    expect(isLocalNetworkError(new TypeError("fetch failed"))).toBe(true);
    expect(isLocalNetworkError(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }))).toBe(true);
  });

  it("is false for timeouts and for other errors", () => {
    expect(isLocalNetworkError(new DOMException("aborted", "AbortError"))).toBe(false);
    expect(isLocalNetworkError(new DOMException("timed out", "TimeoutError"))).toBe(false);
    expect(isLocalNetworkError(new Error("Unexpected token < in JSON"))).toBe(false);
    expect(isLocalNetworkError(undefined)).toBe(false);
  });
});

describe("local retry settings", () => {
  it("defaults to a schedule that outlasts a model reload", () => {
    expect(resolveLocalRetryPolicy()).toEqual({
      maxRetries: DEFAULT_LOCAL_MAX_RETRIES,
      baseDelayMs: DEFAULT_LOCAL_RETRY_BASE_DELAY_MS,
      maxDelayMs: DEFAULT_LOCAL_RETRY_MAX_DELAY_MS,
    });
    expect(DEFAULT_LOCAL_MAX_RETRIES).toBe(6);
    expect(DEFAULT_LOCAL_RETRY_BASE_DELAY_MS).toBe(2000);
    expect(DEFAULT_LOCAL_RETRY_MAX_DELAY_MS).toBe(60_000);
  });

  it("takes llm.local.* over the defaults and explicit options over both", () => {
    const local = { maxRetries: 0, retryBaseDelayMs: 500, retryMaxDelayMs: 5000 };
    expect(resolveLocalRetryPolicy(local)).toEqual({ maxRetries: 0, baseDelayMs: 500, maxDelayMs: 5000 });
    expect(resolveLocalRetryPolicy(local, { maxRetries: 9 })).toEqual({ maxRetries: 9, baseDelayMs: 500, maxDelayMs: 5000 });
    // A negative value is skipped, not trusted.
    expect(resolveLocalRetryPolicy({ maxRetries: -1 }).maxRetries).toBe(DEFAULT_LOCAL_MAX_RETRIES);
  });

  it("reads llm.local.maxRetries, retryBaseDelayMs and retryMaxDelayMs from .n-dx.json", async () => {
    const dir = await mkdtemp(join(tmpdir(), "llm-local-retry-"));
    try {
      await writeFile(join(dir, ".n-dx.json"), JSON.stringify({
        llm: { vendor: "local", local: { maxRetries: 10, retryBaseDelayMs: 3000, retryMaxDelayMs: 90000 } },
      }));
      const cfg = await loadLLMConfig(dir);
      expect(cfg.local?.maxRetries).toBe(10);
      expect(cfg.local?.retryBaseDelayMs).toBe(3000);
      expect(cfg.local?.retryMaxDelayMs).toBe(90000);
      expect(resolveLocalRetryPolicy(cfg.local)).toEqual({ maxRetries: 10, baseDelayMs: 3000, maxDelayMs: 90000 });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
