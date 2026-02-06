/**
 * @n-dx/claude-client — Unified Claude API client abstraction layer.
 *
 * Provides a single ClaudeClient interface that works with both the Claude
 * Code CLI and the Anthropic Messages API. Consumers call `createClient()`
 * and get back a provider-agnostic client that handles retries, error
 * classification, and token usage tracking.
 *
 * @example
 * ```ts
 * import { createClient, loadClaudeConfig } from "@n-dx/claude-client";
 *
 * const config = await loadClaudeConfig(projectDir);
 * const client = createClient({ claudeConfig: config });
 *
 * const result = await client.complete({
 *   prompt: "Hello, Claude!",
 *   model: "claude-sonnet-4-20250514",
 * });
 *
 * console.log(result.text);
 * console.log(client.mode); // "api" or "cli"
 * ```
 */

// Types
export type {
  TokenUsage,
  ClaudeConfig,
  AuthMode,
  ClaudeClientOptions,
  CompletionRequest,
  CompletionResult,
  ErrorReason,
  ClaudeClient,
} from "./types.js";

export { ClaudeClientError } from "./types.js";

// Config
export {
  loadClaudeConfig,
  resolveApiKey,
  resolveCliPath,
} from "./config.js";

// Token usage parsing
export {
  parseApiTokenUsage,
  parseCliTokenUsage,
  parseStreamTokenUsage,
} from "./token-usage.js";

// Providers
export { createApiClient } from "./api-provider.js";
export type { ApiProviderOptions } from "./api-provider.js";

export { createCliClient } from "./cli-provider.js";
export type { CliProviderOptions } from "./cli-provider.js";

// Factory
export {
  createClient,
  detectAuthMode,
} from "./create-client.js";
export type { CreateClientOptions } from "./create-client.js";
