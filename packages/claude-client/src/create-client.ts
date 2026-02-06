/**
 * Factory function for creating a Claude client with automatic provider selection.
 *
 * Chooses between API and CLI providers based on configuration and available
 * credentials. Supports explicit mode selection or graceful fallback.
 */

import type { AuthMode, ClaudeClient, ClaudeClientOptions } from "./types.js";
import { ClaudeClientError } from "./types.js";
import { resolveApiKey } from "./config.js";
import { createApiClient, type ApiProviderOptions } from "./api-provider.js";
import { createCliClient, type CliProviderOptions } from "./cli-provider.js";

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
 * Detect which authentication mode is available.
 *
 * Priority:
 * 1. API key present (from config or env) → "api"
 * 2. Fall back to CLI
 */
export function detectAuthMode(options: ClaudeClientOptions): AuthMode {
  const apiKeyEnv = options.apiKeyEnv ?? "ANTHROPIC_API_KEY";
  const apiKey = resolveApiKey(options.claudeConfig, apiKeyEnv);
  return apiKey ? "api" : "cli";
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
 * @throws {ClaudeClientError} if the selected mode can't be initialized
 *   (e.g. API mode without an API key).
 */
export function createClient(options: CreateClientOptions): ClaudeClient {
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
