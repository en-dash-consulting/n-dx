/**
 * `createLocalApiProvider` refuses a saved host or port that fails the shape
 * rule before it builds `http://${host}:${port}/v1`. A hand-edited
 * `.n-dx.json` used to reach the URL sink unchecked: `127.0.0.1/x?` fetched
 * `/x?:1234/v1/…`, `u@127.0.0.1` sent credentials, and a port written as the
 * string `"1234"` was interpolated as though it were a number.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { createLocalApiProvider } from "../../src/local-api-provider.js";
import { ClaudeClientError } from "../../src/types.js";
import type { LocalConfig } from "../../src/llm-types.js";

/** A saved config as a hand edit can leave it, past what the type allows. */
const saved = (local: Record<string, unknown>): LocalConfig => local as LocalConfig;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("createLocalApiProvider endpoint shape", () => {
  it.each([
    ["127.0.0.1/x?", "a path and query"],
    ["u@127.0.0.1", "credentials"],
    ["localhost:9999", "a second port"],
    ["a b", "whitespace"],
  ])("refuses the saved host %j (%s) without fetching", (host) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      createLocalApiProvider({ localConfig: saved({ host, port: 1234 }) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ClaudeClientError);
    const error = caught as ClaudeClientError;
    expect(error.reason).toBe("unknown");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("Invalid LLM host");
    expect(error.message).toContain(JSON.stringify(host));
    expect(error.message).toContain("llm.local.host");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["1234", "a string-typed port"],
    [0, "zero"],
    [70000, "above TCP's range"],
    [1.5, "a fraction"],
  ])("refuses the saved port %j (%s) without fetching", (port) => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    let caught: unknown;
    try {
      createLocalApiProvider({ localConfig: saved({ host: "localhost", port }) });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ClaudeClientError);
    const error = caught as ClaudeClientError;
    expect(error.reason).toBe("unknown");
    expect(error.retryable).toBe(false);
    expect(error.message).toContain("Invalid LLM port");
    expect(error.message).toContain(JSON.stringify(port));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("builds the URL from the defaults when nothing is saved", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    const provider = createLocalApiProvider();
    await provider.complete({ prompt: "hello" });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://localhost:1234/v1/chat/completions");
  });

  it("treats a cleared host as absent and keeps a LAN box as written", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: "hi" } }] }),
    }) as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);

    expect(() => createLocalApiProvider({ localConfig: saved({ host: "" }) })).not.toThrow();

    const provider = createLocalApiProvider({ localConfig: { host: "gpu-box.lan", port: 11434 } });
    await provider.complete({ prompt: "hello" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://gpu-box.lan:11434/v1/chat/completions");
  });
});
