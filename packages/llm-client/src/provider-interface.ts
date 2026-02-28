/**
 * Generic LLM provider interface for multi-vendor support.
 *
 * ## Design goals
 *
 * - **Vendor-agnostic core** — The `LLMProvider` interface uses no
 *   vendor-specific terminology. Adding a new vendor (e.g. Gemini, Bedrock)
 *   requires only a new factory function, not changes to this file.
 *
 * - **Capability-driven** — Providers declare optional features (streaming,
 *   function-calling, vision) in `ProviderInfo.capabilities`. Callers check
 *   capabilities before invoking optional methods, enabling graceful
 *   degradation across provider tiers.
 *
 * - **Extensible auth** — `ProviderAuthMode` covers known modes ("api",
 *   "cli", "oauth") and accepts any string, so future providers can declare
 *   their authentication strategy without changing this file.
 *
 * - **Backward-compatible** — The existing `ClaudeClient` interface remains
 *   in `types.ts` for the duration of the migration. Providers may implement
 *   both `ClaudeClient` and `LLMProvider` during the transition.
 *
 * ## Implementing a new provider
 *
 * 1. Create `createXyzProvider(options: XyzProviderOptions): LLMProvider`.
 * 2. Populate `info` with accurate vendor, mode, model, and capabilities.
 * 3. Implement `complete()` — all providers must support this.
 * 4. Implement `stream()` and declare `"streaming"` in capabilities if supported.
 * 5. Implement `validateAuth()` if the provider's credentials can be probed.
 * 6. Register the factory with `defaultRegistry` in `provider-registry.ts`.
 *
 * @example
 * ```ts
 * import type { LLMProvider } from "@n-dx/llm-client";
 *
 * async function run(provider: LLMProvider) {
 *   // Capability check before calling optional method
 *   if (provider.info.capabilities.includes("streaming")) {
 *     for await (const chunk of provider.stream!({ prompt: "Hi", model: "..." })) {
 *       process.stdout.write(chunk.text ?? "");
 *     }
 *   } else {
 *     const result = await provider.complete({ prompt: "Hi", model: "..." });
 *     console.log(result.text);
 *   }
 * }
 * ```
 */

import type { CompletionRequest, CompletionResult, TokenUsage } from "./types.js";

/**
 * Supported LLM vendors.
 *
 * Defined here (rather than `llm-types.ts`) so that `provider-interface.ts`
 * has no upstream dependency on `llm-types.ts`, breaking a circular chain:
 *   provider-interface → llm-types → create-client → api/cli-provider → provider-interface
 *
 * `llm-types.ts` re-exports this type so all existing consumers are unaffected.
 */
export type LLMVendor = "claude" | "codex";

// ── Auth mode ─────────────────────────────────────────────────────────────

/**
 * How a provider instance authenticates with the LLM service.
 *
 * Known modes:
 * - `"api"` — Direct HTTP calls authenticated with an API key.
 * - `"cli"` — Delegates to a local CLI binary (e.g. `claude`, `codex`).
 * - `"oauth"` — OAuth 2.0 token flow (e.g. cloud provider integrations).
 *
 * The type is open (`string & {}`) so future providers can declare their own
 * auth modes (e.g. `"iam"`, `"service-account"`) without changing this file.
 */
export type ProviderAuthMode = "api" | "cli" | "oauth" | (string & {});

// ── Capabilities ──────────────────────────────────────────────────────────

/**
 * Optional feature flags a provider may declare.
 *
 * Callers use these to decide which `LLMProvider` methods are safe to invoke:
 * - `"streaming"` — `provider.stream()` is defined and functional.
 * - `"function-calling"` — Provider supports tool/function call responses.
 * - `"vision"` — Provider can accept image inputs alongside text prompts.
 * - `"embeddings"` — Provider can produce dense vector embeddings.
 */
export type ProviderCapability =
  | "streaming"
  | "function-calling"
  | "vision"
  | "embeddings";

// ── Provider info ─────────────────────────────────────────────────────────

/**
 * Metadata about a provider instance.
 *
 * Aggregated into a single `info` property on `LLMProvider` so that callers
 * inspect provider characteristics through one well-defined shape. Future
 * fields (e.g. `region`, `tier`, `rateLimit`) can be added here without
 * changing the top-level `LLMProvider` interface.
 */
export interface ProviderInfo {
  /** Which LLM vendor this provider connects to. */
  readonly vendor: LLMVendor;

  /** Authentication strategy in use for this instance. */
  readonly mode: ProviderAuthMode;

  /**
   * Active model identifier (e.g. `"claude-sonnet-4-20250514"`).
   * Absent when the provider delegates model selection to the CLI.
   */
  readonly model?: string;

  /**
   * Feature flags this provider instance supports.
   * Check before calling optional methods like `stream()`.
   */
  readonly capabilities: ReadonlyArray<ProviderCapability>;
}

// ── Streaming ─────────────────────────────────────────────────────────────

/**
 * A single chunk emitted by a streaming completion.
 *
 * Providers that support streaming yield these chunks incrementally.
 * Typically `text` chunks arrive first, followed by a final chunk that
 * carries `usage` and/or `done: true`.
 */
export interface StreamChunk {
  /**
   * Incremental text fragment from the model.
   * May be absent in non-text events (e.g. the final usage chunk).
   */
  text?: string;

  /**
   * Token usage for the full request.
   * Typically present only on the terminal chunk.
   */
  usage?: TokenUsage;

  /**
   * True when this is the terminal chunk and no more chunks follow.
   * Consumers should stop iterating after receiving a chunk with `done: true`.
   */
  done?: boolean;
}

// ── Core provider interface ────────────────────────────────────────────────

/**
 * Generic interface all LLM provider implementations must satisfy.
 *
 * Providers are instantiated by vendor-specific factories and consumed
 * uniformly by domain packages (rex, hench, sourcevision) through this
 * interface. This decoupling means:
 *
 * - Domain packages depend on this interface, not on vendor SDKs.
 * - Swapping or adding a vendor requires only a new factory function.
 * - Providers declare their capabilities so callers can adapt gracefully.
 *
 * ## Required vs optional methods
 *
 * | Method           | Required | Guard before calling          |
 * |------------------|----------|-------------------------------|
 * | `complete()`     | ✓        | None — always available        |
 * | `stream()`       | ✗        | `capabilities.includes("streaming")` |
 * | `validateAuth()` | ✗        | Check for `undefined`          |
 */
export interface LLMProvider {
  /**
   * Metadata about this provider instance.
   *
   * Inspect `info.capabilities` before calling optional methods.
   * Inspect `info.vendor` and `info.mode` for observability and fallback.
   */
  readonly info: ProviderInfo;

  /**
   * Perform a blocking completion and return the full response.
   *
   * All providers must implement this method. It is the lowest common
   * denominator across all vendor integrations.
   *
   * @throws {ClaudeClientError} on classified failures (auth, timeout, rate-limit, etc.)
   */
  complete(request: CompletionRequest): Promise<CompletionResult>;

  /**
   * Stream a completion as an async iterable of incremental chunks.
   *
   * Only defined when `"streaming"` appears in `info.capabilities`.
   * Always guard with a capability check before calling:
   *
   * ```ts
   * if (provider.info.capabilities.includes("streaming")) {
   *   for await (const chunk of provider.stream!(request)) {
   *     process.stdout.write(chunk.text ?? "");
   *   }
   * }
   * ```
   *
   * @throws {ClaudeClientError} on classified failures before the stream begins.
   */
  stream?(request: CompletionRequest): AsyncIterable<StreamChunk>;

  /**
   * Probe whether this provider's credentials are currently valid.
   *
   * Returns `true` if the provider can authenticate successfully.
   * Returns `false` if credentials are invalid (wrong key, expired token).
   * May throw `ClaudeClientError` for infrastructure failures (network, timeout).
   *
   * Optional: providers whose auth cannot be probed (e.g. CLI tools that
   * authenticate through a browser session) may omit this method entirely.
   */
  validateAuth?(): Promise<boolean>;
}
