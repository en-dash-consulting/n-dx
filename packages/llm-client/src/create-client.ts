/**
 * Factory for creating a Claude client with automatic provider selection.
 *
 * ## Dual provider architecture
 *
 * The claude-client package provides two interchangeable providers behind
 * a single {@link ClaudeClient} interface:
 *
 * - **API provider** (`api-provider.ts`) — direct Anthropic SDK calls,
 *   used when an API key is available. Best for CI/production.
 * - **CLI provider** (`cli-provider.ts`) — spawns the `claude` binary,
 *   used as the graceful fallback. Best for local development.
 *
 * Both implement identical retry semantics (exponential backoff) and
 * error classification (auth, rate-limit, timeout, unknown), so
 * consumers never need to know which provider is active.
 *
 * ## Provider selection strategy
 *
 * 1. If `mode` is explicitly set → use that provider (throw if unavailable).
 * 2. Otherwise `llm.claude.auth` decides ({@link detectAuthMode}): `cli` and
 *    `api` name the provider; `auto` takes the API when a key is configured
 *    or exported, never for a key held only in the credential store.
 * 3. Otherwise → CLI provider (graceful fallback, no credentials needed).
 *
 * This ensures the client always works in any environment: a developer
 * with Claude Code installed gets the CLI path; a CI server with
 * `ANTHROPIC_API_KEY` gets the API path; explicit configuration
 * overrides both.
 */

import type { AuthMode, ClaudeClient, ClaudeClientOptions } from "./types.js";
import { resolveVendorAuth } from "./vendor-auth.js";
import { LLM_VENDOR } from "./provider-interface.js";
import { createApiClient, type ApiProviderOptions } from "./api-provider.js";
import { createCliClient, type CliProviderOptions } from "./cli-provider.js";
import type { LLMProvider } from "./provider-interface.js";

/** Extended options for createClient with provider selection. */
export interface CreateClientOptions extends ClaudeClientOptions {
  /** Explicit mode selection. If omitted, auto-detects based on available credentials. */
  mode?: AuthMode;
  /** API provider options (retries, max tokens, etc.). */
  api?: Omit<ApiProviderOptions, keyof ClaudeClientOptions>;
  /** CLI provider options (retries, delay, etc.). */
  cli?: Omit<CliProviderOptions, keyof ClaudeClientOptions>;
}

/**
 * Detect which authentication mode `llm.claude.auth` selects
 * ({@link resolveVendorAuth}):
 * - `cli` → "cli", even when a key resolves
 * - `api` → "api" (the API provider refuses when no key resolves)
 * - `auto` → "api" when a key is configured or exported, else "cli"; a key
 *   held only in the credential store never selects the API
 */
export function detectAuthMode(options: ClaudeClientOptions): AuthMode {
  return resolveVendorAuth(
    LLM_VENDOR.CLAUDE,
    { claude: options.claudeConfig },
    { apiKeyEnv: options.apiKeyEnv ?? "ANTHROPIC_API_KEY" },
  ).mode;
}

/**
 * Create a Claude client with automatic or explicit provider selection.
 *
 * When `mode` is specified, creates that specific provider (and throws if
 * prerequisites aren't met, e.g. no API key for API mode).
 *
 * When `mode` is omitted, auto-detects:
 * - If an API key is available → API provider
 * - Otherwise → CLI provider (graceful fallback)
 *
 * The returned client implements both {@link ClaudeClient} (backward compat)
 * and {@link LLMProvider} (generic interface).
 *
 * @throws {ClaudeClientError} if the selected mode can't be initialized
 *   (e.g. API mode without an API key).
 */
export function createClient(options: CreateClientOptions): ClaudeClient & LLMProvider {
  const mode = options.mode ?? detectAuthMode(options);

  if (mode === "api") {
    return createApiClient({
      ...options,
      ...(options.api ?? {}),
    });
  }

  return createCliClient({
    ...options,
    ...(options.cli ?? {}),
  });
}
