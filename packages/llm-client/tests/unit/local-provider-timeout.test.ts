import { describe, it, expect, vi, afterEach } from "vitest";
import { createLocalApiProvider, resolveLocalTimeoutMs } from "../../src/local-api-provider.js";
import { ClaudeClientError } from "../../src/types.js";

const DEFAULT = 300_000;

/** Minimal OK response for /v1/chat/completions. */
function okCompletion() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: "hi" } }] }),
  } as unknown as Response;
}

describe("resolveLocalTimeoutMs", () => {
  it("falls back to the 5 min default when nothing is configured", () => {
    expect(resolveLocalTimeoutMs()).toBe(DEFAULT);
    expect(resolveLocalTimeoutMs({})).toBe(DEFAULT);
  });

  it("reads llm.local.timeoutMs from config", () => {
    expect(resolveLocalTimeoutMs({ timeoutMs: 7_200_000 })).toBe(7_200_000);
  });

  it("treats 0 as an explicit 'no timeout', not as unset", () => {
    expect(resolveLocalTimeoutMs({ timeoutMs: 0 })).toBe(0);
    expect(resolveLocalTimeoutMs({ timeoutMs: 300_000 }, 0)).toBe(0);
  });

  it("lets an explicit override win over config", () => {
    expect(resolveLocalTimeoutMs({ timeoutMs: 1000 }, 60_000)).toBe(60_000);
  });

  it("ignores unusable config values", () => {
    expect(resolveLocalTimeoutMs({ timeoutMs: -1 })).toBe(DEFAULT);
    expect(resolveLocalTimeoutMs({ timeoutMs: Number.NaN })).toBe(DEFAULT);
    expect(resolveLocalTimeoutMs({ timeoutMs: "7200000" as unknown as number })).toBe(DEFAULT);
  });
});

describe("createLocalApiProvider timeout wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("aborts the request with a configured timeout", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeDefined();
      return okCompletion();
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLocalApiProvider({ localConfig: { timeoutMs: 7_200_000 } });
    await provider.complete({ prompt: "hello" });

    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("sends no abort signal when llm.local.timeoutMs is 0", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeUndefined();
      return okCompletion();
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLocalApiProvider({ localConfig: { timeoutMs: 0 } });
    const result = await provider.complete({ prompt: "hello" });

    expect(result.text).toBe("hi");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("names the config key in the timeout error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }));

    const provider = createLocalApiProvider({ localConfig: { timeoutMs: 1 } });

    await expect(provider.complete({ prompt: "hello" })).rejects.toThrow(ClaudeClientError);
    await expect(provider.complete({ prompt: "hello" })).rejects.toThrow(/llm\.local\.timeoutMs/);
  });
});
