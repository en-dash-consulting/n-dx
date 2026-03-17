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
export { setQuiet, isQuiet, info, result } from "@n-dx/llm-client";

// ---- CLI help formatting ----------------------------------------------------
export { formatHelp, formatTypoSuggestion } from "@n-dx/llm-client";

// ---- CLI error classes ------------------------------------------------------
export { CLIError, ClaudeClientError } from "@n-dx/llm-client";

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
  parseStreamTokenUsage,
} from "@n-dx/llm-client";

// ---- Model resolution -------------------------------------------------------
export { resolveModel } from "@n-dx/llm-client";

// ---- Usage formatting -------------------------------------------------------
export { formatUsage } from "@n-dx/llm-client";

// ---- Type re-exports --------------------------------------------------------
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
} from "@n-dx/llm-client";
