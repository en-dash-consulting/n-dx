/**
 * @n-dx/llm-client — Vendor-neutral LLM client foundation for n-dx.
 *
 * ## Dependency inversion foundation
 *
 * This package is the **shared foundation** of the n-dx monorepo. It sits
 * at the root of the dependency DAG, imported by every domain package but
 * importing none of them:
 *
 * ```
 *   hench ──→ rex ──→ llm-client
 *     │                    ↑
 *     └────────────────────┘
 *   sourcevision ──→ llm-client
 *   web ──→ rex, sourcevision
 * ```
 *
 * By centralizing LLM integration concerns here, the domain packages (rex,
 * sourcevision, hench) avoid any direct dependency on each other's
 * internals for AI communication. This **dependency inversion** ensures:
 *
 * - **No circular dependencies** — the DAG is strictly acyclic.
 * - **Independent development** — each domain package can be built and
 *   tested in isolation, with only llm-client as a shared contract.
 * - **Single point of change** — provider upgrades, auth changes, and
 *   retry policy updates happen here without touching domain packages.
 *
 * ## Architecture
 *
 * This package currently ships a production-ready Claude adapter and a
 * Codex CLI adapter behind a vendor-neutral API surface.
 * The Claude dual-provider architecture (CLI + API) ensures
 * the client works in any environment:
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
 * - `llm-client.ts` — vendor-neutral factory (`createLLMClient`)
 * - `llm-config.ts` — vendor-neutral project config loader
 * - `create-client.ts` — Claude factory with auto-detection logic
 * - `api-provider.ts` — Anthropic SDK provider
 * - `cli-provider.ts` — Claude Code CLI provider
 * - `codex-cli-provider.ts` — Codex CLI provider
 * - `config.ts` — credential resolution and model mapping
 * - `token-usage.ts` — usage parsing for both provider formats
 * - `auth.ts` — auth detection and diagnostics
 * - `types.ts` — shared interfaces
 *
 * @example
 * ```ts
 * import { createLLMClient, loadLLMConfig } from "@n-dx/llm-client";
 *
 * const config = await loadLLMConfig(projectDir);
 * const client = createLLMClient({ llmConfig: config, vendor: "claude" });
 *
 * const result = await client.complete({
 *   prompt: "Hello",
 *   model: "claude-sonnet-4-20250514",
 * });
 *
 * console.log(result.text);
 * console.log(client.mode); // "api" or "cli"
 * ```
 */

// Vendor-neutral types
export type {
  LLMVendor,
  CodexConfig,
  LLMConfig,
  CreateLLMClientOptions,
  LLMClient,
} from "./llm-types.js";

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

export { ClaudeClientError, CLIError } from "./types.js";

// Vendor-neutral config + client factories
export { loadLLMConfig } from "./llm-config.js";
export {
  createLLMClient,
  detectLLMAuthMode,
} from "./llm-client.js";

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

export { createCodexCliClient } from "./codex-cli-provider.js";
export type { CodexCliProviderOptions } from "./codex-cli-provider.js";

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

// Process execution
export {
  exec,
  execStdout,
  execShellCmd,
  getCurrentHead,
  getCurrentBranch,
  isExecutableOnPath,
  spawnTool,
  spawnManaged,
  ProcessPool,
  ProcessLimitError,
} from "./exec.js";

export type {
  ExecResult,
  ExecOptions,
  SpawnToolOptions,
  SpawnToolResult,
  ManagedChild,
} from "./exec.js";

// Project directory constants
export { PROJECT_DIRS } from "./project-dirs.js";
export type { ProjectDir } from "./project-dirs.js";

// Canonical JSON serialization
export { toCanonicalJSON } from "./json.js";

// Project-level config utilities (.n-dx.json overrides)
export {
  deepMerge,
  loadProjectOverrides,
  mergeWithOverrides,
} from "./project-config.js";

// CLI output control (quiet mode)
export {
  setQuiet,
  isQuiet,
  info,
  result,
} from "./output.js";

// CLI typo correction
export {
  editDistance,
  suggestCommands,
  formatTypoSuggestion,
} from "./suggest.js";

// CLI help formatting
export {
  isColorEnabled,
  resetColorCache,
  bold,
  dim,
  cyan,
  yellow,
  cmd,
  flag,
  sectionHeader,
  requiredParam,
  optionalParam,
  formatHelp,
  formatUsage,
} from "./help-format.js";

export type {
  HelpOption,
  HelpExample,
  HelpDefinition,
  UsageSection,
  UsageDefinition,
} from "./help-format.js";
