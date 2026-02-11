/**
 * @n-dx/claude-client — Unified Claude API client abstraction layer.
 *
 * ## Dependency inversion foundation
 *
 * This package is the **shared foundation** of the n-dx monorepo. It sits
 * at the root of the dependency DAG, imported by every domain package but
 * importing none of them:
 *
 * ```
 *   hench ──→ rex ──→ claude-client
 *     │                    ↑
 *     └────────────────────┘
 *   sourcevision ──→ claude-client
 *   web ──→ rex, sourcevision
 * ```
 *
 * By centralizing Claude API concerns here, the domain packages (rex,
 * sourcevision, hench) avoid any direct dependency on each other's
 * internals for AI communication. This **dependency inversion** ensures:
 *
 * - **No circular dependencies** — the DAG is strictly acyclic.
 * - **Independent development** — each domain package can be built and
 *   tested in isolation, with only claude-client as a shared contract.
 * - **Single point of change** — provider upgrades, auth changes, and
 *   retry policy updates happen here without touching domain packages.
 *
 * ## Architecture
 *
 * This package encapsulates all Claude API concerns behind a single
 * {@link ClaudeClient} interface, achieving zero coupling with other
 * packages. The dual provider architecture (CLI + API) ensures the
 * client works in any environment:
 *
 * - **API provider** — direct `@anthropic-ai/sdk` calls for CI/production
 * - **CLI provider** — spawns `claude` binary for local development
 *
 * Provider selection is automatic (based on credential availability)
 * or explicit. Both providers share identical retry, error classification,
 * and token usage tracking semantics.
 *
 * ## Package structure
 *
 * - `create-client.ts` — factory with auto-detection logic
 * - `api-provider.ts` — Anthropic SDK provider
 * - `cli-provider.ts` — Claude Code CLI provider
 * - `config.ts` — credential resolution and model mapping
 * - `token-usage.ts` — usage parsing for both provider formats
 * - `auth.ts` — auth detection and diagnostics
 * - `types.ts` — shared interfaces
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
  resolveModel,
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

// Auth detection and validation
export {
  detectCliAvailability,
  validateApiKey,
  detectAvailableAuth,
  diagnoseAuth,
} from "./auth.js";
export type { AuthDetectionResult, AuthDiagnostics } from "./auth.js";

// Project directory constants
export { PROJECT_DIRS } from "./project-dirs.js";
export type { ProjectDir } from "./project-dirs.js";
