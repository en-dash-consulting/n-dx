import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiFailover } from "../../../src/agent/lifecycle/openai-failover.js";
import { ClaudeClientError, createOpenAiApiProvider } from "../../../src/prd/llm-gateway.js";
import type { LLMConfig } from "../../../src/prd/llm-gateway.js";
import type { HenchConfig } from "../../../src/schema/index.js";

const llm: LLMConfig = {
  vendor: "codex", autoFailover: true,
  codex: { auth: "api", api_key: "openai-fixture", model: "gpt-6-astra", lightModel: "gpt-6.1-sol" },
  claude: { auth: "api", api_key: "claude-fixture", model: "claude-sonnet-4-6", lightModel: "claude-haiku-4-5" },
};
const config = { maxTokens: 1024, apiKeyEnv: "ANTHROPIC_API_KEY" } as HenchConfig;
const request = { model: "gpt-6-astra", systemPrompt: "Implement", messages: [{ role: "user" as const, content: "Do it" }], signal: new AbortController().signal };
const hooks = () => ({ beforeAttempt: vi.fn(async () => {}), failed: vi.fn(), switched: vi.fn() });
const rejected = (status = 429) => new Response("secret-provider-body", { status, headers: { "Retry-After": "120" } });
const completed = (model: string) => new Response(JSON.stringify({ status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }], usage: { input_tokens: 10, output_tokens: 2 } }));
function setup(settings = llm) {
  const provider = createOpenAiApiProvider({ codexConfig: settings.codex, maxRetries: 0 });
  return { provider, executor: new OpenAiFailover(provider, request.model, settings, config) };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("OpenAI bounded API failover", () => {
  it("uses the configured light model and retains it for subsequent turns", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(rejected()).mockImplementation(async (_url, init) => completed(JSON.parse(init.body).model));
    vi.stubGlobal("fetch", fetch);
    const { executor } = setup();
    const events = hooks();
    await executor.call(request, events);
    await executor.call(request, events);
    expect(fetch.mock.calls.map(([, init]) => JSON.parse(init.body).model)).toEqual(["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-sol"]);
    expect(events.switched).toHaveBeenCalledExactlyOnceWith({ vendor: "codex", model: "gpt-6-astra" }, { vendor: "codex", model: "gpt-6.1-sol" }, "rate-limit");
  });

  it("exhausts four selections, restores selection and rethrows the identical original error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => rejected()));
    const { executor, provider } = setup();
    const original = new ClaudeClientError("Original", "rate-limit", true);
    vi.spyOn(provider, "completeTurn").mockRejectedValue(original);
    const events = hooks();
    await expect(executor.call(request, events)).rejects.toBe(original);
    expect(executor.selection).toEqual({ vendor: "codex", model: request.model });
    expect(events.failed).toHaveBeenCalledTimes(4);
    expect(events.switched).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(events.switched.mock.calls)).not.toContain("secret-provider-body");
    expect(llm.codex?.model).toBe(request.model);
  });

  it.each([false, true])("never fails over a code defect (enabled=%s)", async enabled => {
    const { executor, provider } = setup({ ...llm, autoFailover: enabled });
    const original = new TypeError("bad code");
    vi.spyOn(provider, "completeTurn").mockRejectedValue(original);
    const events = hooks();
    await expect(executor.call(request, events)).rejects.toBe(original);
    expect(events.switched).not.toHaveBeenCalled();
  });

  it("disabled failover preserves the retryable original error", async () => {
    const { executor, provider } = setup({ ...llm, autoFailover: false });
    const original = new ClaudeClientError("rate limit", "rate-limit", true);
    vi.spyOn(provider, "completeTurn").mockRejectedValue(original);
    const events = hooks();
    await expect(executor.call(request, events)).rejects.toBe(original);
    expect(events.switched).not.toHaveBeenCalled();
  });

  it("stops on a non-retryable fallback error instead of masking it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(rejected()).mockResolvedValueOnce(rejected(400)));
    const { executor } = setup();
    const events = hooks();
    await expect(executor.call(request, events)).rejects.toThrow("HTTP 400");
    expect(events.failed).toHaveBeenCalledTimes(2);
  });

  it("checks the budget before a fallback and honours cancellation", async () => {
    const { executor, provider } = setup();
    vi.spyOn(provider, "completeTurn").mockRejectedValue(new ClaudeClientError("retry", "network", true));
    const events = hooks();
    events.beforeAttempt.mockResolvedValueOnce().mockRejectedValueOnce(new Error("budget reached"));
    await expect(executor.call(request, events)).rejects.toThrow("budget reached");
    expect(events.failed).toHaveBeenCalledTimes(1);
    const controller = new AbortController();
    controller.abort();
    await expect(executor.call({ ...request, signal: controller.signal }, events)).rejects.toThrow();
    expect(events.failed).toHaveBeenCalledTimes(1);
  });

  it("does not restart the chain after a successful fallback turn", async () => {
    let fail = false;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => fail ? rejected() : completed(JSON.parse(init.body).model)));
    const { executor, provider } = setup();
    vi.spyOn(provider, "completeTurn").mockRejectedValue(new ClaudeClientError("initial", "network", true));
    const events = hooks();
    await executor.call(request, events);
    fail = true;
    await expect(executor.call(request, events)).rejects.toThrow("rate limit");
    expect(events.switched).toHaveBeenCalledTimes(3);
    expect(executor.selection).toEqual({ vendor: "codex", model: request.model });
  });

  it("retains billed failure usage before enforcing a budget on the next attempt", async () => {
    const { executor, provider } = setup();
    const error = Object.assign(new ClaudeClientError("partial response", "network", true), {
      tokenUsage: { input: 100, output: 50 }, usageStatus: "partial",
    });
    vi.spyOn(provider, "completeTurn").mockRejectedValue(error);
    const events = hooks();
    let spent = 0;
    events.failed.mockImplementation(error => { spent += error.tokenUsage.input + error.tokenUsage.output; });
    events.beforeAttempt.mockImplementation(async () => { if (spent >= 150) throw new Error("budget reached"); });
    await expect(executor.call(request, events)).rejects.toThrow("budget reached");
    expect(events.switched).not.toHaveBeenCalled();
    expect(executor.selection).toEqual({ vendor: "codex", model: request.model });
    expect(spent).toBe(150);
    expect(provider.completeTurn).toHaveBeenCalledOnce();
  });

  it("continues to Claude light when the Claude standard connection fails", async () => {
    const models: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      const { model } = JSON.parse(init.body);
      models.push(model);
      if (model === llm.claude!.model) throw new TypeError("fetch failed");
      if (model === llm.claude!.lightModel) {
        return new Response(JSON.stringify({ stop_reason: "end_turn", content: [], usage: {} }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      return rejected();
    }));
    const { executor } = setup();
    await expect(executor.call(request, hooks())).resolves.toMatchObject({ stop_reason: "end_turn" });
    expect(models).toEqual([request.model, llm.codex!.lightModel, llm.claude!.model, llm.claude!.lightModel]);
  });

  it("bounds enabled attempts and leaves disabled request timeouts unchanged", async () => {
    for (const enabled of [false, true]) {
      const { executor, provider } = setup({ ...llm, autoFailover: enabled });
      const call = vi.spyOn(provider, "completeTurn").mockRejectedValue(new Error("stop"));
      await expect(executor.call(request, hooks())).rejects.toThrow("stop");
      expect(call.mock.calls[0][0].timeoutMs).toBe(enabled ? 600_000 : undefined);
    }
  });

  it.each([[8192, 940_000], [32768, 1_800_000]])("scales the deadline for a %s-token budget with a finite ceiling", async (maxTokens, timeoutMs) => {
    const { provider } = setup();
    const call = vi.spyOn(provider, "completeTurn").mockRejectedValue(new Error("stop"));
    const executor = new OpenAiFailover(provider, request.model, llm, { ...config, maxTokens });
    await expect(executor.call(request, hooks())).rejects.toThrow("stop");
    expect(call.mock.calls[0][0].timeoutMs).toBe(timeoutMs);
  });

  it("does not consume failover for a refusal or malformed successful payload", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ status: "completed", output: [
      { type: "message", role: "assistant", content: [{ type: "refusal", refusal: "Cannot comply" }] },
    ] })).mockResolvedValueOnce(Response.json({ status: "completed", output: null }));
    vi.stubGlobal("fetch", fetch);
    const { executor } = setup();
    const events = hooks();
    expect(await executor.call(request, events)).toMatchObject({ stop_reason: "refusal" });
    await expect(executor.call(request, events)).rejects.toMatchObject({ retryable: false });
    expect(events.switched).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  function fakeDeadlines() {
    vi.useFakeTimers();
    // Node's native AbortSignal.timeout bypasses Vitest's fake clock.
    return vi.spyOn(AbortSignal, "timeout").mockImplementation(ms => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("Deadline", "TimeoutError")), ms);
      return controller.signal;
    });
  }

  it.each(["gpt-6-astra", "gpt-6.1-sol", "claude-sonnet-4-6", "claude-haiku-4-5"])(
    "allows a healthy 90-second response body on %s", async target => {
      fakeDeadlines();
      const models: string[] = [];
      vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
        const model = JSON.parse(init.body).model;
        models.push(model);
        if (model !== target) return rejected();
        return new Response(new ReadableStream({ start(controller) {
          init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
          setTimeout(() => {
            if (init.signal.aborted) return;
            const data = model.startsWith("claude")
              ? { id: "msg", type: "message", role: "assistant", model, stop_reason: "end_turn", content: [], usage: { input_tokens: 5, output_tokens: 3 } }
              : { status: "completed", model, output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Done" }] }], usage: { input_tokens: 5, output_tokens: 3 } };
            controller.enqueue(new TextEncoder().encode(JSON.stringify(data)));
            controller.close();
          }, 90_000);
        } }), { headers: { "Content-Type": "application/json" } });
      }));
      const { executor } = setup();
      const events = hooks();
      const result = expect(executor.call(request, events)).resolves.toMatchObject({ stop_reason: "end_turn" });
      await Promise.all([result, vi.advanceTimersByTimeAsync(90_000)]);
      expect(executor.selection.model).toBe(target);
      expect(models.at(-1)).toBe(target);
      expect(events.failed.mock.calls.every(([error]) => error.reason === "rate-limit")).toBe(true);
    },
  );

  it("bounds hanging primary and secondary bodies, classifying timeouts separately from caller abort", async () => {
    const deadlines = fakeDeadlines();
    const fetch = vi.fn(async (_url, init) => new Response(new ReadableStream({ start(controller) {
      init.signal.addEventListener("abort", () => controller.error(init.signal.reason), { once: true });
    } }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    const { executor } = setup();
    const events = hooks();
    const result = expect(executor.call(request, events)).rejects.toMatchObject({ reason: "timeout", retryable: true });
    await Promise.all([result, vi.advanceTimersByTimeAsync(4 * 600_000)]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(events.failed.mock.calls.map(([error]) => error.reason)).toEqual(["timeout", "timeout", "timeout", "timeout"]);
    expect(events.switched).toHaveBeenCalledTimes(3);
    expect(deadlines.mock.calls.every(([ms]) => ms === 600_000)).toBe(true);
  });

  it.each([false, true])("gives caller abort precedence over a deadline (Claude fallback=%s)", async fallback => {
    fakeDeadlines();
    const controller = new AbortController();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      calls++;
      if (fallback && calls < 3) return rejected();
      return new Response(new ReadableStream({ start(body) {
        init.signal.addEventListener("abort", () => {
          controller.abort();
          body.error(new Error("private transport failure"));
        }, { once: true });
      } }), { headers: { "Content-Type": "application/json" } });
    }));
    const { executor } = setup();
    const events = hooks();
    const result = expect(executor.call({ ...request, signal: controller.signal }, events)).rejects.toMatchObject({ name: "AbortError" });
    await Promise.all([result, vi.advanceTimersByTimeAsync(600_000)]);
    expect(calls).toBe(fallback ? 3 : 1);
    expect(events.switched).toHaveBeenCalledTimes(fallback ? 2 : 0);
  });

  it("sends Anthropic messages/tools and only Claude credentials after OpenAI auth and model failures", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      if (String(url).includes("openai")) return rejected(body.model === request.model ? 401 : 404);
      expect(String(url)).toBe("https://api.anthropic.com/v1/messages");
      const headers = new Headers(init.headers);
      expect(headers.get("x-api-key")).toBe("claude-fixture");
      expect(headers.get("authorization")).toBeNull();
      expect(body.input).toBeUndefined();
      expect(body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "assistant" })]));
      expect(body.tools[0].input_schema).toBeDefined();
      expect(JSON.stringify(body)).not.toContain("encrypted_content");
      return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: "Done" }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 4 } }), { headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetch);
    const { executor } = setup();
    const history = [...request.messages, { role: "assistant" as const, content: [{ type: "tool_use" as const, id: "call_1", name: "read_file", input: { path: "a.ts" } }] }, { role: "user" as const, content: [{ type: "tool_result" as const, tool_use_id: "call_1", content: "file" }] }];
    const result = await executor.call({ ...request, messages: history }, hooks());
    expect(result.stop_reason).toBe("end_turn");
    expect(executor.selection.vendor).toBe("claude");
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
