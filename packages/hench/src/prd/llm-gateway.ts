/**
 * Centralized gateway for @n-dx/llm-client runtime imports.
 *
 * Mirrors rex-gateway.ts — all runtime imports from @n-dx/llm-client are
 * funnelled through this single module.  This makes the cross-package
 * dependency surface explicit and easy to audit, and prevents llm-client
 * imports from drifting across the ~160-file hench zone.
 *
 * ## Dependency DAG context
 *
 * ```
 *   hench → rex → llm-client
 *   hench → llm-client          ← this gateway
 *   sourcevision → llm-client
 * ```
 *
 * ## Maximum-scope policy
 *
 * **In-scope (re-export permitted):**
 * - Project configuration (load/merge config, resolve keys/paths)
 * - Process execution (exec, spawn, process pool)
 * - CLI primitives (output control, help formatting, error classes, typo suggestions)
 * - Token usage parsing (API and stream token parsing)
 * - Model resolution (resolve model names)
 * - Shared constants (PROJECT_DIRS)
 * - Canonical JSON serialization
 *
 * **Out-of-scope (must NOT be re-exported):**
 * - MCP server/client factories (web-tier concern)
 * - Transport internals (HTTP, stdio — consumed only by web package)
 * - Vendor adapter internals (implementation details)
 *
 * @module hench/prd/llm-gateway
 * @see packages/hench/src/prd/rex-gateway.ts — companion gateway for rex imports
 * @see gateway-rules.json — enforcement rules
 */

// ---- Project configuration --------------------------------------------------
export {
  loadClaudeConfig,
  loadLLMConfig,
  resolveApiKey,
  resolveCliPath,
  loadProjectOverrides,
  mergeWithOverrides,
} from "@n-dx/llm-client";

// ---- Shared constants -------------------------------------------------------
export { PROJECT_DIRS } from "@n-dx/llm-client";

// ---- Canonical JSON ---------------------------------------------------------
export { toCanonicalJSON } from "@n-dx/llm-client";

// ---- CLI output control -----------------------------------------------------
export { setQuiet, isQuiet, info, result, warn } from "@n-dx/llm-client";

// ---- Deprecation filter (CLI entry points) ----------------------------------
export { suppressKnownDeprecations } from "@n-dx/llm-client";

// ---- Vendor/model header ----------------------------------------------------
export { printVendorModelHeader } from "@n-dx/llm-client";
export type { VendorModelHeaderOptions } from "@n-dx/llm-client";

// ---- CLI help formatting ----------------------------------------------------
export { formatHelp, formatTypoSuggestion } from "@n-dx/llm-client";

// ---- CLI color formatting ---------------------------------------------------
export {
  isColorEnabled,
  bold,
  dim,
  cyan,
  yellow,
  green,
  red,
  magenta,
  // Semantic color helpers (prefer over raw primitives for status/severity)
  colorSuccess,
  colorWarn,
  colorInfo,
  colorDim,
  colorPending,
  colorPink,
  // Canonical status→color map + helper (PRD statuses, run statuses, log-levels)
  STATUS_COLORS,
  colorStatus,
} from "@n-dx/llm-client";

// ---- CLI error classes ------------------------------------------------------
export { CLIError, ClaudeClientError, CLI_ERROR_CODES } from "@n-dx/llm-client";
export type { CLIErrorCode } from "@n-dx/llm-client";

// ---- Process execution ------------------------------------------------------
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
} from "@n-dx/llm-client";

// ---- Token usage parsing ----------------------------------------------------
export {
  parseApiTokenUsage,
  parseApiTokenUsageWithDiagnostic,
  parseStreamTokenUsage,
  parseStreamTokenUsageWithDiagnostic,
  mapCodexUsageToTokenUsage,
} from "@n-dx/llm-client";

// ---- Model resolution -------------------------------------------------------
export {
  resolveModel,
  resolveVendorModel,
  NEWEST_MODELS,
  isModelCompatibleWithVendor,
  resetStaleModel,
  formatVendorChangeWarning,
} from "@n-dx/llm-client";
export type { VendorModelResetResult } from "@n-dx/llm-client";

// ---- Usage formatting -------------------------------------------------------
export { formatUsage } from "@n-dx/llm-client";

// ---- Runtime contract -------------------------------------------------------
export {
  DEFAULT_EXECUTION_POLICY,
  CANONICAL_PROMPT_SECTIONS,
  ALL_FAILURE_CATEGORIES,
  createPromptEnvelope,
  assemblePrompt,
  mapErrorReasonToFailureCategory,
  mapRunFailureToCategory,
  classifyVendorError,
  failureCategoryLabel,
} from "@n-dx/llm-client";

// ---- Codex policy compilation -----------------------------------------------
export {
  compileCodexPolicyFlags,
  mapSandboxToCodexFlag,
  mapApprovalToCodexFlag,
} from "@n-dx/llm-client";

// ---- Vendor-neutral tool schema ---------------------------------------------
export {
  toAnthropicToolDef,
  toAnthropicToolDefs,
  toOpenAiToolDef,
  toOpenAiToolDefs,
} from "@n-dx/llm-client";

// ---- Provider registry ------------------------------------------------------
export {
  ProviderRegistry,
  defaultRegistry,
} from "@n-dx/llm-client";

// ---- Type re-exports --------------------------------------------------------
export type {
  LLMProvider,
  ProviderInfo,
} from "@n-dx/llm-client";

export type {
  ClaudeConfig,
  LLMConfig,
  LLMVendor,
  ExecResult,
  ExecOptions,
  SpawnToolOptions,
  SpawnToolResult,
  ManagedChild,
  HelpDefinition,
  PromptSectionName,
  PromptSection,
  PromptEnvelope,
  SandboxMode,
  ApprovalPolicy,
  ExecutionPolicy,
  RuntimeEventType,
  RuntimeEvent,
  FailureCategory,
  TokenDiagnosticStatus,
  RuntimeDiagnostics,
  TokenParseResult,
  CodexTokenMapping,
  ToolDefinition,
  ToolInputSchema,
  ToolPropertySchema,
  AnthropicToolDef,
  OpenAiToolDef,
} from "@n-dx/llm-client";
