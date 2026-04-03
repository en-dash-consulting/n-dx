/**
 * Provider registration and selection system for the llm-client.
 *
 * ## Design goals
 *
 * - **Dynamic registration** — vendors register factories at runtime, making
 *   it possible to add new LLM providers without changing this file.
 *
 * - **Config-driven selection** — `getActiveProvider(config)` reads
 *   `config.vendor` to pick the right factory, defaulting to `"claude"`.
 *
 * - **Extensible vendor names** — registry keys are plain strings, so
 *   third-party vendors (e.g. `"gemini"`, `"bedrock"`) can be registered
 *   without changing any core types.
 *
 * - **Singleton default** — `defaultRegistry` is pre-populated with the
 *   built-in `"claude"` and `"codex"` factories. Most callers use it
 *   directly. Tests and advanced consumers create isolated registries via
 *   `new ProviderRegistry()` or `createDefaultRegistry()`.
 *
 * ## Adding a new vendor
 *
 * ```ts
 * import { defaultRegistry } from "@n-dx/llm-client";
 *
 * defaultRegistry.register("my-vendor", (config) => {
 *   return new MyVendorProvider(config);
 * });
 * ```
 *
 * ## Selecting the active provider
 *
 * ```ts
 * const config = await loadLLMConfig(projectDir);
 * const provider = defaultRegistry.getActiveProvider(config);
 * const result = await provider.complete({ prompt: "Hello", model: "..." });
 * ```
 */

import type { LLMProvider, ProviderInfo } from "./provider-interface.js";
import type { LLMConfig } from "./llm-types.js";
import { createClient } from "./create-client.js";
import { createCodexCliClient } from "./codex-cli-provider.js";
import { createOpenAiApiProvider, resolveOpenAiApiKey } from "./openai-api-provider.js";

// ── Factory type ──────────────────────────────────────────────────────────

/**
 * A function that creates an `LLMProvider` from the unified LLM config.
 *
 * Factories receive the full `LLMConfig` so they can extract their own
 * vendor-specific section (e.g. `config.claude`, `config.codex`). They
 * must return a fully initialized provider ready for `complete()` calls.
 *
 * @example
 * ```ts
 * const myFactory: ProviderFactory = (config) => {
 *   return new MyProvider({ apiKey: config.myVendor?.api_key });
 * };
 * ```
 */
export type ProviderFactory = (config: LLMConfig) => LLMProvider;

// ── ProviderRegistry ──────────────────────────────────────────────────────

/**
 * Registry mapping vendor names to provider factory functions.
 *
 * The registry enables dynamic provider registration and config-driven
 * selection. Vendors are identified by string names (e.g. `"claude"`,
 * `"codex"`) for extensibility beyond the built-in `LLMVendor` union.
 *
 * @example
 * ```ts
 * // Create an isolated registry (e.g. for testing)
 * const registry = new ProviderRegistry();
 * registry.register("test-vendor", (config) => makeTestProvider());
 *
 * const provider = registry.getActiveProvider({ vendor: "test-vendor" });
 * ```
 */
export class ProviderRegistry {
  private readonly factories = new Map<string, ProviderFactory>();

  /**
   * Register a factory for the given vendor name.
   *
   * If a factory is already registered for this vendor, it is replaced.
   * Registration is intentionally idempotent so callers can safely
   * re-register without checking first.
   *
   * @param vendor - Vendor identifier string (e.g. `"claude"`, `"gemini"`).
   * @param factory - Function that creates a provider from `LLMConfig`.
   */
  register(vendor: string, factory: ProviderFactory): void {
    this.factories.set(vendor, factory);
  }

  /**
   * Remove the factory for the given vendor.
   *
   * @returns `true` if a factory existed and was removed, `false` otherwise.
   */
  unregister(vendor: string): boolean {
    return this.factories.delete(vendor);
  }

  /**
   * Returns `true` if a factory is registered for the given vendor.
   */
  has(vendor: string): boolean {
    return this.factories.has(vendor);
  }

  /**
   * Returns all registered vendor names in insertion order.
   */
  vendors(): string[] {
    return [...this.factories.keys()];
  }

  /**
   * Create a provider for the given vendor using `config`.
   *
   * @throws {Error} if no factory is registered for `vendor`.
   */
  create(vendor: string, config: LLMConfig): LLMProvider {
    const factory = this.factories.get(vendor);
    if (!factory) {
      const known = this.vendors().join(", ") || "(none registered)";
      throw new Error(
        `No provider registered for vendor "${vendor}". Known vendors: ${known}`,
      );
    }
    return factory(config);
  }

  /**
   * Get the active provider based on `config.vendor`.
   *
   * Defaults to `"claude"` when `config.vendor` is not set. This mirrors
   * the behaviour of `createLLMClient()` so the two APIs stay aligned.
   *
   * @throws {Error} if no factory is registered for the resolved vendor.
   */
  getActiveProvider(config: LLMConfig): LLMProvider {
    const vendor = config.vendor ?? "claude";
    return this.create(vendor, config);
  }
}

// ── Default registry ──────────────────────────────────────────────────────

/**
 * Create a new `ProviderRegistry` pre-populated with the built-in providers.
 *
 * Built-in vendors:
 * - `"claude"` — Dual provider stack (API + CLI) with automatic detection.
 * - `"codex"` — Codex CLI provider (`codex exec`).
 *
 * Use this function when you need an isolated registry (e.g. in tests or
 * when overriding a built-in vendor without affecting the global default).
 *
 * @example
 * ```ts
 * const registry = createDefaultRegistry();
 * registry.register("my-vendor", myFactory);  // extend without touching defaultRegistry
 * ```
 */
export function createDefaultRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry();

  // Claude: delegate to the dual-provider factory (API + CLI auto-detection)
  registry.register("claude", (config) =>
    createClient({ claudeConfig: config.claude ?? {} }),
  );

  // Codex: dual provider stack (API + CLI) with automatic detection.
  // When an OpenAI API key is available (config or env), uses the API provider.
  // Otherwise falls back to the CLI provider adapter.
  registry.register("codex", (config) => {
    const apiKey = resolveOpenAiApiKey(config.codex);
    if (apiKey) {
      return createOpenAiApiProvider({ codexConfig: config.codex });
    }

    // CLI fallback: wrap createCodexCliClient in an LLMProvider adapter.
    // createCodexCliClient returns ClaudeClient (no `info`), so we add the
    // required ProviderInfo here until the codex adapter is refactored to
    // implement LLMProvider directly (tracked in the sibling refactor task).
    const client = createCodexCliClient({ codexConfig: config.codex });
    const info: ProviderInfo = {
      vendor: "codex",
      mode: "cli",
      model: config.codex?.model,
      capabilities: [],
    };
    return {
      info,
      complete: (request) => client.complete(request),
    } satisfies LLMProvider;
  });

  return registry;
}

/**
 * Shared default registry instance with built-in providers pre-registered.
 *
 * Most application code should use this singleton directly. Third-party
 * providers can be registered here to make them available globally:
 *
 * ```ts
 * import { defaultRegistry } from "@n-dx/llm-client";
 *
 * defaultRegistry.register("my-vendor", myFactory);
 * ```
 *
 * Tests that need isolation should use `createDefaultRegistry()` instead
 * to avoid cross-test contamination.
 */
export const defaultRegistry: ProviderRegistry = createDefaultRegistry();
