import { describe, it, expect } from "vitest";
import type {
  LLMProvider,
  ProviderInfo,
  ProviderAuthMode,
  ProviderCapability,
  StreamChunk,
} from "../../src/provider-interface.js";
import type { CompletionRequest, CompletionResult } from "../../src/types.js";

// ── Test helpers ──────────────────────────────────────────────────────────

/** Build a minimal ProviderInfo for test providers. */
function makeInfo(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    vendor: "claude",
    mode: "api",
    model: "claude-sonnet-4-20250514",
    capabilities: [],
    ...overrides,
  };
}

const stubResult: CompletionResult = { text: "stub response" };
const stubRequest: CompletionRequest = { prompt: "Hello", model: "test-model" };

// ── Mock provider factories ───────────────────────────────────────────────

/** Minimal provider: only implements `complete()`. */
function makeBasicProvider(infoOverrides: Partial<ProviderInfo> = {}): LLMProvider {
  return {
    info: makeInfo(infoOverrides),
    complete: async (_req: CompletionRequest): Promise<CompletionResult> => stubResult,
  };
}

/** Provider with streaming support. */
function makeStreamingProvider(): LLMProvider {
  return {
    info: makeInfo({ capabilities: ["streaming"] }),
    complete: async (_req: CompletionRequest): Promise<CompletionResult> => stubResult,
    async *stream(_req: CompletionRequest): AsyncIterable<StreamChunk> {
      yield { text: "Hello" };
      yield { text: " world" };
      yield { usage: { input: 5, output: 2 }, done: true };
    },
  };
}

/** Provider that exposes auth validation. */
function makeAuthValidatingProvider(valid: boolean): LLMProvider {
  return {
    info: makeInfo({ mode: "api" }),
    complete: async (_req: CompletionRequest): Promise<CompletionResult> => stubResult,
    validateAuth: async () => valid,
  };
}

// ── Basic provider ────────────────────────────────────────────────────────

describe("LLMProvider — basic provider", () => {
  it("satisfies the interface with only complete() implemented", () => {
    const provider = makeBasicProvider();
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
    expect(provider.stream).toBeUndefined();
    expect(provider.validateAuth).toBeUndefined();
  });

  it("exposes vendor and mode via info", () => {
    const provider = makeBasicProvider({ vendor: "codex", mode: "cli" });
    expect(provider.info.vendor).toBe("codex");
    expect(provider.info.mode).toBe("cli");
  });

  it("exposes model via info", () => {
    const provider = makeBasicProvider({ model: "claude-opus-4-20250514" });
    expect(provider.info.model).toBe("claude-opus-4-20250514");
  });

  it("info.model is optional", () => {
    const info: ProviderInfo = {
      vendor: "claude",
      mode: "cli",
      capabilities: [],
    };
    expect(info.model).toBeUndefined();
  });

  it("completes a request and returns a result", async () => {
    const provider = makeBasicProvider();
    const result = await provider.complete(stubRequest);
    expect(result.text).toBe("stub response");
  });

  it("empty capabilities array when no capabilities declared", () => {
    const provider = makeBasicProvider();
    expect(provider.info.capabilities).toEqual([]);
  });
});

// ── ProviderAuthMode ──────────────────────────────────────────────────────

describe("ProviderAuthMode", () => {
  it("accepts known mode: api", () => {
    const provider = makeBasicProvider({ mode: "api" });
    expect(provider.info.mode).toBe("api");
  });

  it("accepts known mode: cli", () => {
    const provider = makeBasicProvider({ mode: "cli" });
    expect(provider.info.mode).toBe("cli");
  });

  it("accepts known mode: oauth", () => {
    const provider = makeBasicProvider({ mode: "oauth" });
    expect(provider.info.mode).toBe("oauth");
  });

  it("accepts custom string modes for extensibility", () => {
    // Extensibility: future vendors declare their own auth modes
    const provider = makeBasicProvider({ mode: "iam" });
    expect(provider.info.mode).toBe("iam");
  });

  it("all known modes can be used in runtime comparisons", () => {
    const modes: ProviderAuthMode[] = ["api", "cli", "oauth"];
    for (const mode of modes) {
      const provider = makeBasicProvider({ mode });
      expect(provider.info.mode).toBe(mode);
    }
  });
});

// ── ProviderCapability ────────────────────────────────────────────────────

describe("ProviderCapability", () => {
  it("providers declare streaming capability", () => {
    const provider = makeBasicProvider({ capabilities: ["streaming"] });
    expect(provider.info.capabilities).toContain("streaming");
  });

  it("providers declare function-calling capability", () => {
    const provider = makeBasicProvider({ capabilities: ["function-calling"] });
    expect(provider.info.capabilities).toContain("function-calling");
  });

  it("providers declare vision capability", () => {
    const provider = makeBasicProvider({ capabilities: ["vision"] });
    expect(provider.info.capabilities).toContain("vision");
  });

  it("providers declare embeddings capability", () => {
    const provider = makeBasicProvider({ capabilities: ["embeddings"] });
    expect(provider.info.capabilities).toContain("embeddings");
  });

  it("providers can declare multiple capabilities at once", () => {
    const capabilities: ProviderCapability[] = [
      "streaming",
      "vision",
      "function-calling",
    ];
    const provider = makeBasicProvider({ capabilities });
    expect(provider.info.capabilities).toHaveLength(3);
    expect(provider.info.capabilities).toContain("streaming");
    expect(provider.info.capabilities).toContain("vision");
    expect(provider.info.capabilities).toContain("function-calling");
  });

  it("capability check pattern: Array.includes()", () => {
    const withStreaming = makeBasicProvider({ capabilities: ["streaming"] });
    const withoutStreaming = makeBasicProvider({ capabilities: [] });

    expect(withStreaming.info.capabilities.includes("streaming")).toBe(true);
    expect(withoutStreaming.info.capabilities.includes("streaming")).toBe(false);
  });
});

// ── Streaming ─────────────────────────────────────────────────────────────

describe("LLMProvider — streaming", () => {
  it("streaming provider declares streaming capability", () => {
    const provider = makeStreamingProvider();
    expect(provider.info.capabilities).toContain("streaming");
  });

  it("stream() is defined on streaming provider", () => {
    const provider = makeStreamingProvider();
    expect(typeof provider.stream).toBe("function");
  });

  it("stream() is absent on non-streaming provider", () => {
    const provider = makeBasicProvider();
    expect(provider.stream).toBeUndefined();
  });

  it("stream() yields text chunks followed by a terminal done chunk", async () => {
    const provider = makeStreamingProvider();
    const chunks: StreamChunk[] = [];

    for await (const chunk of provider.stream!(stubRequest)) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(3);
    expect(chunks[0].text).toBe("Hello");
    expect(chunks[1].text).toBe(" world");
    expect(chunks[2].done).toBe(true);
    expect(chunks[2].usage).toEqual({ input: 5, output: 2 });
  });

  it("concatenating text chunks produces the full response", async () => {
    const provider = makeStreamingProvider();
    let fullText = "";

    for await (const chunk of provider.stream!(stubRequest)) {
      if (chunk.text !== undefined) fullText += chunk.text;
    }

    expect(fullText).toBe("Hello world");
  });

  it("capability check gates stream() invocation safely", async () => {
    const provider = makeBasicProvider(); // no streaming
    let called = false;

    if (provider.info.capabilities.includes("streaming")) {
      called = true;
      for await (const _ of provider.stream!(stubRequest)) {
        // should not reach here
      }
    }

    expect(called).toBe(false);
  });
});

// ── Auth validation ───────────────────────────────────────────────────────

describe("LLMProvider — auth validation", () => {
  it("validateAuth() returns true when credentials are valid", async () => {
    const provider = makeAuthValidatingProvider(true);
    expect(typeof provider.validateAuth).toBe("function");
    await expect(provider.validateAuth!()).resolves.toBe(true);
  });

  it("validateAuth() returns false when credentials are invalid", async () => {
    const provider = makeAuthValidatingProvider(false);
    await expect(provider.validateAuth!()).resolves.toBe(false);
  });

  it("validateAuth is optional — basic providers omit it", () => {
    const provider = makeBasicProvider();
    expect(provider.validateAuth).toBeUndefined();
  });
});

// ── StreamChunk structure ─────────────────────────────────────────────────

describe("StreamChunk", () => {
  it("all fields are optional — empty chunk is valid", () => {
    const chunk: StreamChunk = {};
    expect(chunk.text).toBeUndefined();
    expect(chunk.usage).toBeUndefined();
    expect(chunk.done).toBeUndefined();
  });

  it("text-only chunk carries incremental content", () => {
    const chunk: StreamChunk = { text: "hello" };
    expect(chunk.text).toBe("hello");
    expect(chunk.done).toBeUndefined();
  });

  it("terminal done chunk carries usage and done flag", () => {
    const chunk: StreamChunk = {
      usage: { input: 10, output: 5 },
      done: true,
    };
    expect(chunk.done).toBe(true);
    expect(chunk.usage?.input).toBe(10);
    expect(chunk.usage?.output).toBe(5);
  });

  it("usage supports optional cache token fields", () => {
    const chunk: StreamChunk = {
      usage: {
        input: 10,
        output: 5,
        cacheCreationInput: 2,
        cacheReadInput: 3,
      },
      done: true,
    };
    expect(chunk.usage?.cacheCreationInput).toBe(2);
    expect(chunk.usage?.cacheReadInput).toBe(3);
  });

  it("a chunk can carry both text and done simultaneously", () => {
    const chunk: StreamChunk = { text: "final", done: true };
    expect(chunk.text).toBe("final");
    expect(chunk.done).toBe(true);
  });
});

// ── ProviderInfo shape ────────────────────────────────────────────────────

describe("ProviderInfo", () => {
  it("vendor field accepts all LLMVendor values", () => {
    const claudeInfo: ProviderInfo = {
      vendor: "claude",
      mode: "api",
      capabilities: [],
    };
    const codexInfo: ProviderInfo = {
      vendor: "codex",
      mode: "cli",
      capabilities: [],
    };
    expect(claudeInfo.vendor).toBe("claude");
    expect(codexInfo.vendor).toBe("codex");
  });

  it("model field is absent when not provided", () => {
    const info: ProviderInfo = {
      vendor: "claude",
      mode: "cli",
      capabilities: [],
    };
    expect("model" in info).toBe(false);
  });

  it("info object is fully readable", () => {
    const info = makeInfo({
      vendor: "codex",
      mode: "cli",
      model: "gpt-5-codex",
      capabilities: ["streaming"],
    });
    expect(info.vendor).toBe("codex");
    expect(info.mode).toBe("cli");
    expect(info.model).toBe("gpt-5-codex");
    expect(info.capabilities).toEqual(["streaming"]);
  });
});
