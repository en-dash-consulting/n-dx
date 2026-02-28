import { describe, it, expect, beforeEach } from "vitest";
import {
  ProviderRegistry,
  createDefaultRegistry,
  defaultRegistry,
  type ProviderFactory,
} from "../../src/provider-registry.js";
import type { LLMProvider } from "../../src/provider-interface.js";
import type { LLMConfig } from "../../src/llm-types.js";
import type { CompletionRequest, CompletionResult } from "../../src/types.js";

// ── Test helpers ──────────────────────────────────────────────────────────

const stubResult: CompletionResult = { text: "stub" };

function makeStubProvider(vendor = "stub"): LLMProvider {
  return {
    info: {
      vendor: "claude", // satisfies the LLMVendor type
      mode: "api",
      capabilities: [],
    },
    complete: async (_req: CompletionRequest): Promise<CompletionResult> =>
      stubResult,
  };
}

function makeStubFactory(vendor = "stub"): ProviderFactory {
  return (_config: LLMConfig) => makeStubProvider(vendor);
}

// ── ProviderRegistry ──────────────────────────────────────────────────────

describe("ProviderRegistry — registration", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("registers a factory and reports it as present", () => {
    registry.register("test", makeStubFactory());
    expect(registry.has("test")).toBe(true);
  });

  it("has() returns false for unregistered vendor", () => {
    expect(registry.has("missing")).toBe(false);
  });

  it("vendors() returns empty array when nothing is registered", () => {
    expect(registry.vendors()).toEqual([]);
  });

  it("vendors() lists all registered vendors", () => {
    registry.register("a", makeStubFactory());
    registry.register("b", makeStubFactory());
    expect(registry.vendors()).toContain("a");
    expect(registry.vendors()).toContain("b");
    expect(registry.vendors()).toHaveLength(2);
  });

  it("vendors() preserves insertion order", () => {
    registry.register("first", makeStubFactory());
    registry.register("second", makeStubFactory());
    registry.register("third", makeStubFactory());
    expect(registry.vendors()).toEqual(["first", "second", "third"]);
  });

  it("overwrites an existing factory on re-register", () => {
    const factoryA = makeStubFactory("a");
    const factoryB = makeStubFactory("b");

    registry.register("vendor", factoryA);
    registry.register("vendor", factoryB);

    // Only one entry expected
    expect(registry.vendors()).toHaveLength(1);
    // The new factory is used
    const provider = registry.create("vendor", {});
    expect(provider).toBeDefined();
  });
});

// ── ProviderRegistry — unregister ─────────────────────────────────────────

describe("ProviderRegistry — unregister", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("unregister() removes the factory and returns true", () => {
    registry.register("vendor", makeStubFactory());
    const removed = registry.unregister("vendor");
    expect(removed).toBe(true);
    expect(registry.has("vendor")).toBe(false);
  });

  it("unregister() returns false when vendor was not registered", () => {
    const removed = registry.unregister("nonexistent");
    expect(removed).toBe(false);
  });

  it("unregister() removes the vendor from vendors() list", () => {
    registry.register("keep", makeStubFactory());
    registry.register("remove", makeStubFactory());
    registry.unregister("remove");
    expect(registry.vendors()).toEqual(["keep"]);
  });
});

// ── ProviderRegistry — create ─────────────────────────────────────────────

describe("ProviderRegistry — create", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
  });

  it("create() calls the factory with config and returns the provider", () => {
    let receivedConfig: LLMConfig | undefined;
    const factory: ProviderFactory = (config) => {
      receivedConfig = config;
      return makeStubProvider();
    };

    registry.register("myvendor", factory);
    const config: LLMConfig = { vendor: "claude", claude: { api_key: "key" } };
    const provider = registry.create("myvendor", config);

    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
    expect(receivedConfig).toBe(config);
  });

  it("create() throws when vendor is not registered", () => {
    expect(() => registry.create("unknown", {})).toThrowError(
      /No provider registered for vendor "unknown"/,
    );
  });

  it("error message lists known vendors", () => {
    registry.register("alpha", makeStubFactory());
    registry.register("beta", makeStubFactory());
    expect(() => registry.create("gamma", {})).toThrowError(/alpha/);
  });

  it("each create() call invokes the factory (no implicit caching)", () => {
    let callCount = 0;
    registry.register("counter", (_config) => {
      callCount++;
      return makeStubProvider();
    });

    registry.create("counter", {});
    registry.create("counter", {});
    expect(callCount).toBe(2);
  });
});

// ── ProviderRegistry — getActiveProvider ──────────────────────────────────

describe("ProviderRegistry — getActiveProvider", () => {
  let registry: ProviderRegistry;

  beforeEach(() => {
    registry = new ProviderRegistry();
    registry.register("claude", makeStubFactory("claude"));
    registry.register("codex", makeStubFactory("codex"));
  });

  it("uses config.vendor to select the provider", () => {
    let selectedVendor = "";
    registry.register("myvendor", (_config) => {
      selectedVendor = "myvendor";
      return makeStubProvider();
    });

    registry.getActiveProvider({ vendor: "myvendor" } as LLMConfig);
    expect(selectedVendor).toBe("myvendor");
  });

  it("defaults to claude when config.vendor is not set", () => {
    let claudeCalled = false;
    registry.register("claude", (_config) => {
      claudeCalled = true;
      return makeStubProvider();
    });

    registry.getActiveProvider({});
    expect(claudeCalled).toBe(true);
  });

  it("selects codex when config.vendor is codex", () => {
    let codexCalled = false;
    registry.register("codex", (_config) => {
      codexCalled = true;
      return makeStubProvider();
    });

    registry.getActiveProvider({ vendor: "codex" });
    expect(codexCalled).toBe(true);
  });

  it("throws when config.vendor has no registered factory", () => {
    expect(() =>
      registry.getActiveProvider({ vendor: "unknown" } as LLMConfig),
    ).toThrowError(/No provider registered for vendor "unknown"/);
  });

  it("passes full config to the factory", () => {
    let capturedConfig: LLMConfig | undefined;
    registry.register("claude", (config) => {
      capturedConfig = config;
      return makeStubProvider();
    });

    const config: LLMConfig = {
      vendor: "claude",
      claude: { api_key: "test-key", model: "claude-sonnet" },
    };
    registry.getActiveProvider(config);
    expect(capturedConfig).toBe(config);
  });
});

// ── createDefaultRegistry ─────────────────────────────────────────────────

describe("createDefaultRegistry", () => {
  it("returns a ProviderRegistry instance", () => {
    const registry = createDefaultRegistry();
    expect(registry).toBeInstanceOf(ProviderRegistry);
  });

  it("has claude registered by default", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("claude")).toBe(true);
  });

  it("has codex registered by default", () => {
    const registry = createDefaultRegistry();
    expect(registry.has("codex")).toBe(true);
  });

  it("returns an independent registry each time", () => {
    const r1 = createDefaultRegistry();
    const r2 = createDefaultRegistry();
    r1.register("extra", makeStubFactory());
    expect(r2.has("extra")).toBe(false);
  });

  it("can create a claude provider from config with api_key", () => {
    const registry = createDefaultRegistry();
    const provider = registry.create("claude", {
      claude: { api_key: "sk-ant-test" },
    });
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
  });

  it("can create a codex provider", () => {
    const registry = createDefaultRegistry();
    const provider = registry.create("codex", {});
    expect(provider).toBeDefined();
    expect(typeof provider.complete).toBe("function");
  });
});

// ── defaultRegistry singleton ─────────────────────────────────────────────

describe("defaultRegistry", () => {
  it("is a ProviderRegistry instance", () => {
    expect(defaultRegistry).toBeInstanceOf(ProviderRegistry);
  });

  it("has claude and codex pre-registered", () => {
    expect(defaultRegistry.has("claude")).toBe(true);
    expect(defaultRegistry.has("codex")).toBe(true);
  });

  it("allows registering additional vendors", () => {
    const vendorName = `test-vendor-${Date.now()}`;
    defaultRegistry.register(vendorName, makeStubFactory());
    expect(defaultRegistry.has(vendorName)).toBe(true);
    // Clean up to avoid polluting other tests
    defaultRegistry.unregister(vendorName);
  });

  it("allows unregistering a vendor", () => {
    const vendorName = `temp-vendor-${Date.now()}`;
    defaultRegistry.register(vendorName, makeStubFactory());
    const removed = defaultRegistry.unregister(vendorName);
    expect(removed).toBe(true);
    expect(defaultRegistry.has(vendorName)).toBe(false);
  });
});
