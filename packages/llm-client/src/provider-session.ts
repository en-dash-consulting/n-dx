/**
 * Session-based LLM provider management with vendor switching support.
 *
 * ## What is a ProviderSession?
 *
 * A `ProviderSession` wraps a `ProviderRegistry` and maintains the
 * currently active provider instance. It tracks:
 *
 * - **Active vendor** — which vendor is currently selected.
 * - **Active provider** — the instantiated `LLMProvider` for that vendor.
 * - **Current config** — the full `LLMConfig` in effect.
 *
 * ## Why session state matters
 *
 * Provider instances may hold resources (connections, auth tokens, internal
 * state). The session reuses the same provider instance across requests
 * **as long as the vendor does not change**. Switching vendors creates a
 * fresh provider for the new vendor so the old instance can be released.
 *
 * This means:
 * - Same vendor + updated config → existing provider reused.
 * - Different vendor → new provider instantiated, old one released.
 *
 * ## Usage
 *
 * ```ts
 * import { createProviderSession, loadLLMConfig } from "@n-dx/llm-client";
 *
 * const config = await loadLLMConfig(projectDir);
 * const session = createProviderSession(config);
 *
 * // Use the active provider
 * const result = await session.provider.complete({ prompt: "Hi", model: "..." });
 *
 * // Switch to a different vendor
 * session.switchVendor("codex");
 * const codexResult = await session.provider.complete({ prompt: "Hi", model: "..." });
 * ```
 */

import type { LLMProvider } from "./provider-interface.js";
import type { LLMConfig } from "./llm-types.js";
import {
  ProviderRegistry,
  createDefaultRegistry,
} from "./provider-registry.js";

// ── ProviderSession ───────────────────────────────────────────────────────

/**
 * Maintains active provider state and supports vendor switching.
 *
 * Create via `new ProviderSession(registry, config)` or the convenience
 * function `createProviderSession(config)`.
 */
export class ProviderSession {
  private _provider: LLMProvider;
  private _vendor: string;
  private _config: LLMConfig;

  /**
   * @param registry - Registry used to resolve and instantiate providers.
   * @param initialConfig - Starting configuration. `config.vendor` (or
   *   `"claude"` when absent) selects the initial active provider.
   */
  constructor(
    private readonly registry: ProviderRegistry,
    initialConfig: LLMConfig,
  ) {
    this._config = initialConfig;
    this._vendor = initialConfig.vendor ?? "claude";
    this._provider = registry.create(this._vendor, initialConfig);
  }

  // ── Accessors ────────────────────────────────────────────────────────────

  /**
   * The currently active `LLMProvider` instance.
   *
   * The same instance is returned across multiple calls as long as the
   * vendor has not changed. Switch vendors via `switchVendor()` or
   * `updateConfig()` to get a fresh provider for a different backend.
   */
  get provider(): LLMProvider {
    return this._provider;
  }

  /**
   * The currently active vendor name (e.g. `"claude"`, `"codex"`).
   */
  get vendor(): string {
    return this._vendor;
  }

  /**
   * The current `LLMConfig` held by this session.
   *
   * Updated whenever `switchVendor()` or `updateConfig()` is called.
   */
  get config(): LLMConfig {
    return this._config;
  }

  // ── Mutation ──────────────────────────────────────────────────────────────

  /**
   * Switch to a different vendor and create a new provider for it.
   *
   * The previous provider instance is released (no longer referenced by
   * the session). If `config` is provided, it replaces the session config
   * entirely; otherwise the existing config is carried over.
   *
   * @param vendor - Target vendor name (must be registered in the registry).
   * @param config - Optional new config. Defaults to the current config.
   * @returns The newly created provider for the target vendor.
   *
   * @throws {Error} if no factory is registered for `vendor`.
   *
   * @example
   * ```ts
   * // Switch to codex, keeping existing config settings
   * session.switchVendor("codex");
   *
   * // Switch and provide codex-specific config
   * session.switchVendor("codex", { ...session.config, vendor: "codex", codex: { ... } });
   * ```
   */
  switchVendor(vendor: string, config?: LLMConfig): LLMProvider {
    const newConfig = config ?? this._config;
    const newProvider = this.registry.create(vendor, newConfig);
    this._vendor = vendor;
    this._config = newConfig;
    this._provider = newProvider;
    return newProvider;
  }

  /**
   * Update the session configuration, refreshing the provider if needed.
   *
   * - **Same vendor** → existing provider instance is reused, preserving
   *   any internal state (connections, cached auth, etc.). Config is updated.
   * - **Different vendor** → a new provider is instantiated for the new
   *   vendor. The old provider is released.
   *
   * Returns the active provider (new or reused).
   *
   * @example
   * ```ts
   * // Config update that keeps the same vendor — provider reused
   * session.updateConfig({ ...session.config, claude: { model: "claude-opus-4-20250514" } });
   *
   * // Config update that changes vendor — new provider created
   * session.updateConfig({ vendor: "codex", codex: { cli_path: "/usr/local/bin/codex" } });
   * ```
   */
  updateConfig(config: LLMConfig): LLMProvider {
    const newVendor = config.vendor ?? "claude";
    if (newVendor !== this._vendor) {
      // Vendor changed — create a fresh provider for the new backend
      this._provider = this.registry.create(newVendor, config);
      this._vendor = newVendor;
    }
    // Always update config, even when vendor is unchanged
    this._config = config;
    return this._provider;
  }
}

// ── Convenience factory ───────────────────────────────────────────────────

/**
 * Create a `ProviderSession` backed by the default built-in registry.
 *
 * This is the recommended entry point for most callers. The session starts
 * with the vendor declared in `initialConfig.vendor` (or `"claude"` when
 * omitted) and can switch vendors dynamically via `switchVendor()`.
 *
 * @param initialConfig - Starting LLM config. Defaults to `{}` (claude, CLI mode).
 *
 * @example
 * ```ts
 * import { createProviderSession, loadLLMConfig } from "@n-dx/llm-client";
 *
 * const config = await loadLLMConfig(projectDir);
 * const session = createProviderSession(config);
 *
 * const result = await session.provider.complete({ prompt: "Hello", model: "..." });
 * ```
 */
export function createProviderSession(initialConfig: LLMConfig = {}): ProviderSession {
  return new ProviderSession(createDefaultRegistry(), initialConfig);
}
