import { describe, it, expect, beforeEach } from "vitest";
import {
  ProviderSession,
  createProviderSession,
} from "../../src/provider-session.js";
import {
  ProviderRegistry,
  type ProviderFactory,
} from "../../src/provider-registry.js";
import type { LLMProvider } from "../../src/provider-interface.js";
import type { LLMConfig } from "../../src/llm-types.js";
import type { CompletionRequest, CompletionResult } from "../../src/types.js";

// ── Test helpers ──────────────────────────────────────────────────────────

const stubResult: CompletionResult = { text: "stub" };

function makeStubProvider(id: string): LLMProvider {
  return {
    info: { vendor: "claude", mode: "api", capabilities: [] },
    complete: async (_req: CompletionRequest): Promise<CompletionResult> => ({
      text: id,
    }),
    _id: id, // attached for identity checks in tests
  } as unknown as LLMProvider;
}

function makeTrackingFactory(id: string): {
  factory: ProviderFactory;
  instances: LLMProvider[];
} {
  const instances: LLMProvider[] = [];
  const factory: ProviderFactory = (_config) => {
    const p = makeStubProvider(id);
    instances.push(p);
    return p;
  };
  return { factory, instances };
}

function makeTestRegistry(vendors: string[] = ["claude", "codex"]): ProviderRegistry {
  const registry = new ProviderRegistry();
  for (const v of vendors) {
    registry.register(v, (_config) => makeStubProvider(v));
  }
  return registry;
}

// ── ProviderSession — constructor ─────────────────────────────────────────

describe("ProviderSession — construction", () => {
  it("creates a session with the vendor from config", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "codex" });
    expect(session.vendor).toBe("codex");
  });

  it("defaults to claude when config.vendor is absent", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, {});
    expect(session.vendor).toBe("claude");
  });

  it("creates an initial provider immediately", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    expect(session.provider).toBeDefined();
    expect(typeof session.provider.complete).toBe("function");
  });

  it("holds the initial config", () => {
    const registry = makeTestRegistry();
    const config: LLMConfig = { vendor: "claude", claude: { api_key: "key" } };
    const session = new ProviderSession(registry, config);
    expect(session.config).toBe(config);
  });

  it("throws when the initial vendor is not registered", () => {
    const registry = new ProviderRegistry(); // empty
    expect(
      () => new ProviderSession(registry, { vendor: "claude" } as LLMConfig),
    ).toThrowError(/No provider registered for vendor "claude"/);
  });
});

// ── ProviderSession — provider accessor ───────────────────────────────────

describe("ProviderSession — provider accessor", () => {
  it("returns the same provider instance on repeated access", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    const p1 = session.provider;
    const p2 = session.provider;
    expect(p1).toBe(p2); // strict identity
  });

  it("provider is usable for completions", async () => {
    const registry = new ProviderRegistry();
    registry.register("claude", (_config) => ({
      info: { vendor: "claude", mode: "api", capabilities: [] },
      complete: async () => stubResult,
    }));
    const session = new ProviderSession(registry, {});
    const result = await session.provider.complete({
      prompt: "Hello",
      model: "test-model",
    });
    expect(result.text).toBe("stub");
  });
});

// ── ProviderSession — switchVendor ────────────────────────────────────────

describe("ProviderSession — switchVendor", () => {
  it("switches to the specified vendor", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    session.switchVendor("codex");
    expect(session.vendor).toBe("codex");
  });

  it("returns the new provider", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    const claudeProvider = session.provider;
    const codexProvider = session.switchVendor("codex");

    expect(codexProvider).toBeDefined();
    expect(codexProvider).not.toBe(claudeProvider);
  });

  it("updates session.provider to the new provider", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    const returned = session.switchVendor("codex");
    expect(session.provider).toBe(returned);
  });

  it("creates a fresh provider on each switch", () => {
    const { factory, instances } = makeTrackingFactory("codex");
    const registry = makeTestRegistry();
    registry.register("codex", factory);
    const session = new ProviderSession(registry, { vendor: "claude" });

    session.switchVendor("codex");
    session.switchVendor("claude");
    session.switchVendor("codex");

    expect(instances).toHaveLength(2); // codex provider created twice
  });

  it("accepts a new config on switch", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    const newConfig: LLMConfig = { vendor: "codex", codex: { model: "gpt-5" } };
    session.switchVendor("codex", newConfig);
    expect(session.config).toBe(newConfig);
  });

  it("uses existing config when no new config is provided", () => {
    const registry = makeTestRegistry();
    const originalConfig: LLMConfig = { vendor: "claude" };
    const session = new ProviderSession(registry, originalConfig);
    session.switchVendor("codex");
    expect(session.config).toBe(originalConfig);
  });

  it("throws when the target vendor is not registered", () => {
    const registry = makeTestRegistry(["claude"]);
    const session = new ProviderSession(registry, { vendor: "claude" });
    expect(() => session.switchVendor("unregistered")).toThrowError(
      /No provider registered for vendor "unregistered"/,
    );
  });

  it("session remains valid after a failed switch", () => {
    const registry = makeTestRegistry(["claude"]);
    const session = new ProviderSession(registry, { vendor: "claude" });
    const originalProvider = session.provider;

    try {
      session.switchVendor("missing");
    } catch {
      // expected
    }

    // Still on claude, provider unchanged
    expect(session.vendor).toBe("claude");
    expect(session.provider).toBe(originalProvider);
  });
});

// ── ProviderSession — updateConfig ────────────────────────────────────────

describe("ProviderSession — updateConfig", () => {
  it("reuses the same provider when vendor is unchanged", () => {
    const { factory, instances } = makeTrackingFactory("claude");
    const registry = new ProviderRegistry();
    registry.register("claude", factory);
    const session = new ProviderSession(registry, { vendor: "claude" });

    const providerBefore = session.provider;
    session.updateConfig({ vendor: "claude", claude: { model: "claude-opus" } });
    const providerAfter = session.provider;

    expect(providerAfter).toBe(providerBefore); // same instance
    expect(instances).toHaveLength(1); // factory called only once (at construction)
  });

  it("creates a new provider when the vendor changes", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    const original = session.provider;

    session.updateConfig({ vendor: "codex" });

    expect(session.provider).not.toBe(original);
    expect(session.vendor).toBe("codex");
  });

  it("updates session.config in both same-vendor and different-vendor cases", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });

    const sameVendorConfig: LLMConfig = {
      vendor: "claude",
      claude: { model: "claude-opus" },
    };
    session.updateConfig(sameVendorConfig);
    expect(session.config).toBe(sameVendorConfig);

    const newVendorConfig: LLMConfig = { vendor: "codex" };
    session.updateConfig(newVendorConfig);
    expect(session.config).toBe(newVendorConfig);
  });

  it("returns the active provider", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "claude" });
    const returned = session.updateConfig({ vendor: "claude" });
    expect(returned).toBe(session.provider);
  });

  it("defaults to claude when new config lacks a vendor", () => {
    const registry = makeTestRegistry();
    const session = new ProviderSession(registry, { vendor: "codex" });
    session.updateConfig({}); // no vendor — defaults to "claude"
    expect(session.vendor).toBe("claude");
  });

  it("passes updated config to the factory when vendor changes", () => {
    let capturedConfig: LLMConfig | undefined;
    const registry = makeTestRegistry(["claude"]);
    registry.register("codex", (config) => {
      capturedConfig = config;
      return makeStubProvider("codex");
    });
    const session = new ProviderSession(registry, { vendor: "claude" });

    const newConfig: LLMConfig = { vendor: "codex", codex: { model: "gpt-5" } };
    session.updateConfig(newConfig);

    expect(capturedConfig).toBe(newConfig);
  });
});

// ── createProviderSession ─────────────────────────────────────────────────

describe("createProviderSession", () => {
  it("returns a ProviderSession instance", () => {
    const session = createProviderSession({});
    expect(session).toBeInstanceOf(ProviderSession);
  });

  it("uses the default registry (claude pre-registered)", () => {
    const session = createProviderSession({});
    expect(session.vendor).toBe("claude");
    expect(session.provider).toBeDefined();
  });

  it("uses codex when config.vendor is codex", () => {
    const session = createProviderSession({ vendor: "codex" });
    expect(session.vendor).toBe("codex");
  });

  it("defaults to empty config when called with no args", () => {
    const session = createProviderSession();
    expect(session.vendor).toBe("claude");
    expect(session.provider).toBeDefined();
  });

  it("can switch vendors after creation", () => {
    const session = createProviderSession({});
    session.switchVendor("codex");
    expect(session.vendor).toBe("codex");
  });

  it("creates independent sessions on each call", () => {
    const s1 = createProviderSession({});
    const s2 = createProviderSession({});
    s1.switchVendor("codex");
    // s2 should not be affected
    expect(s2.vendor).toBe("claude");
  });
});
