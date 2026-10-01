import { describe, it, expect, vi } from "vitest";
import { isChatModelId } from "../../src/vendor-model-reset.js";
import { listVendorModels } from "../../src/vendor-model-list.js";

/** Shape and ids recorded from OpenAI's GET /v1/models: chat models mixed with everything else. */
const OPENAI_LIST = {
  object: "list",
  data: [
    "gpt-4o", "gpt-4o-mini", "gpt-5", "o3", "o4-mini", "gpt-5-codex",
    "text-embedding-3-large", "text-embedding-ada-002",
    "whisper-1", "tts-1", "tts-1-hd", "dall-e-3", "gpt-image-1",
    "gpt-4o-audio-preview", "gpt-4o-realtime-preview", "gpt-4o-transcribe",
    "omni-moderation-latest", "sora-2", "davinci-002", "babbage-002",
  ].map((id) => ({ id, object: "model", owned_by: "openai" })),
};

const ANTHROPIC_LIST = {
  data: [
    { id: "claude-sonnet-4-5", type: "model" },
    { id: "claude-opus-4-1", type: "model" },
    { id: "claude-opus-4-1", type: "model" },
  ],
  has_more: false,
};

function respond(body: unknown, status = 200): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("isChatModelId", () => {
  it.each([
    "text-embedding-3-large", "whisper-1", "tts-1", "dall-e-3", "gpt-image-1",
    "gpt-4o-audio-preview", "gpt-4o-realtime-preview", "gpt-4o-transcribe",
    "gpt-4o-mini-transcribe", "omni-moderation-latest", "sora-2",
  ])("rejects %s", (id) => expect(isChatModelId(id)).toBe(false));

  it.each(["gpt-4o", "gpt-5-codex", "o3", "claude-sonnet-4-5", "gemini-2.5-pro"])(
    "accepts %s",
    (id) => expect(isChatModelId(id)).toBe(true),
  );
});

describe("listVendorModels", () => {
  it("keeps only chat models the codex vendor can run, sorted", async () => {
    const result = await listVendorModels("codex", {}, { env: { OPENAI_API_KEY: "sk-test" }, fetch: respond(OPENAI_LIST) });
    expect(result).toEqual({
      ok: true,
      models: ["gpt-4o", "gpt-4o-mini", "gpt-5", "gpt-5-codex", "o3", "o4-mini"],
    });
  });

  it("lists claude models de-duplicated, using x-api-key", async () => {
    const fetchSpy = respond(ANTHROPIC_LIST);
    const result = await listVendorModels("claude", {}, { env: { ANTHROPIC_API_KEY: "sk-ant-test" }, fetch: fetchSpy });
    expect(result).toEqual({ ok: true, models: ["claude-opus-4-1", "claude-sonnet-4-5"] });
    const [url, init] = vi.mocked(fetchSpy).mock.calls[0]!;
    expect(String(url)).toContain("api.anthropic.com/v1/models");
    expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("sk-ant-test");
  });

  it("prefers the configured key over the environment, then falls back to it", async () => {
    const fetchSpy = respond(OPENAI_LIST);
    await listVendorModels("codex", { codex: { api_key: "from-config" } }, { env: { OPENAI_API_KEY: "from-env" }, fetch: fetchSpy });
    expect((vi.mocked(fetchSpy).mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe("Bearer from-config");

    const envSpy = respond(OPENAI_LIST);
    await listVendorModels("codex", {}, { env: { OPENAI_API_KEY: "from-env" }, fetch: envSpy });
    expect((vi.mocked(envSpy).mock.calls[0]![1]!.headers as Record<string, string>).Authorization).toBe("Bearer from-env");
  });

  it("reads the claude key from the resolved claude config", async () => {
    const fetchSpy = respond(ANTHROPIC_LIST);
    await listVendorModels("claude", { claude: { api_key: "cfg-key" } }, { env: {}, fetch: fetchSpy });
    expect((vi.mocked(fetchSpy).mock.calls[0]![1]!.headers as Record<string, string>)["x-api-key"]).toBe("cfg-key");
  });

  it("reports a missing key without calling the API", async () => {
    const fetchSpy = respond(OPENAI_LIST);
    const result = await listVendorModels("codex", {}, { env: {}, fetch: fetchSpy });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports an HTTP error", async () => {
    const result = await listVendorModels("codex", {}, { env: { OPENAI_API_KEY: "k" }, fetch: respond({}, 401) });
    expect(result).toEqual({ ok: false, reason: "Models API answered HTTP 401" });
  });

  it("reports an unexpected body and an empty usable list", async () => {
    const env = { OPENAI_API_KEY: "k" };
    expect((await listVendorModels("codex", {}, { env, fetch: respond({ nope: 1 }) })).ok).toBe(false);
    expect((await listVendorModels("codex", {}, { env, fetch: respond({ data: [{ id: "whisper-1" }] }) })).ok).toBe(false);
  });

  it("reports a timeout", async () => {
    const hang = vi.fn((_url: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as unknown as typeof fetch;
    const result = await listVendorModels("codex", {}, { env: { OPENAI_API_KEY: "k" }, fetch: hang, timeoutMs: 20 });
    expect(result).toEqual({ ok: false, reason: "Models API did not answer within 20ms" });
  });

  it("never includes the key in a failure reason", async () => {
    const key = "sk-secret-value-123";
    const leaky = vi.fn(async () => {
      throw new Error(`connect failed for Bearer ${key}`);
    }) as unknown as typeof fetch;
    const result = await listVendorModels("codex", {}, { env: { OPENAI_API_KEY: key }, fetch: leaky });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(key);
  });
});
