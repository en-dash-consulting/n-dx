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
 * **Vendor-neutral core**
 * - `provider-interface.ts` — generic `LLMProvider` interface (vendor-agnostic contract)
 * - `provider-registry.ts` — provider registration, selection, and `defaultRegistry`
 * - `provider-session.ts` — active provider management and vendor switching
 * - `llm-types.ts` — vendor-neutral types (`LLMVendor`, `LLMConfig`, `CodexConfig`)
 * - `llm-client.ts` — vendor-neutral factory (`createLLMClient`, `detectLLMAuthMode`)
 * - `llm-config.ts` — vendor-neutral project config loader (`loadLLMConfig`)
 *
 * **Claude providers**
 * - `create-client.ts` — Claude factory with auto-detection logic
 * - `api-provider.ts` — Anthropic SDK provider
 * - `cli-provider.ts` — Claude Code CLI provider
 *
 * **Codex provider**
 * - `codex-cli-provider.ts` — Codex CLI provider (`codex exec`)
 *
 * **Shared utilities**
 * - `types.ts` — Claude-specific shared interfaces and error classes
 * - `config.ts` — credential resolution and model mapping
 * - `token-usage.ts` — usage parsing for API, CLI, and stream formats
 * - `auth.ts` — auth detection and diagnostics
 * - `exec.ts` — process execution utilities (`exec`, `spawnTool`, `ProcessPool`)
 * - `project-dirs.ts` — project directory constants (`PROJECT_DIRS`)
 * - `project-config.ts` — `.n-dx.json` override loading and merging
 * - `json.ts` — canonical JSON serialization
 * - `output.ts` — CLI output control (quiet mode)
 * - `suggest.ts` — CLI typo correction
 * - `help-format.ts` — CLI help formatting and color output
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
 *   model: "claude-sonnet-4-6",
 * });
 *
 * console.log(result.text);
 * console.log(client.mode); // "api" or "cli"
 * ```
 */

// Generic provider interface (vendor-agnostic)
export type {
  ProviderAuthMode,
  ProviderCapability,
  ProviderInfo,
  StreamChunk,
  LLMProvider,
} from "./provider-interface.js";

// Provider registry and selection
export type { ProviderFactory } from "./provider-registry.js";
export {
  ProviderRegistry,
  createDefaultRegistry,
  defaultRegistry,
} from "./provider-registry.js";

// Provider session (active provider management + vendor switching)
export {
  ProviderSession,
  createProviderSession,
} from "./provider-session.js";

// Vendor-neutral types
export type {
  LLMVendor,
  CodexConfig,
  LLMConfig,
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
export type { CreateLLMClientOptions } from "./llm-client.js";

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
  killWithFallback,
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
