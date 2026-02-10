/**
 * Public API for the hench package.
 *
 * ## API philosophy: types-only
 *
 * Hench is a **CLI tool**, not a library. Other packages interact with it
 * exclusively through:
 *
 * 1. **Subprocess spawning** — `cli.js` and `web.js` invoke `hench run`
 * 2. **Filesystem reads** — the web dashboard and rex's token-usage module
 *    read `.hench/config.json` and `.hench/runs/*.json` directly from disk
 *
 * This public API therefore exports **only types and schema constants** —
 * enough for consumers to validate JSON file shapes at compile time without
 * creating runtime coupling.
 *
 * This is intentionally different from rex (which exports runtime functions)
 * and sourcevision (which exports its MCP factory). Each package's public
 * surface reflects its actual consumption pattern — see PACKAGE_GUIDELINES.md
 * for the full decision tree.
 *
 * Runtime functions (agent loops, tool dispatch, guard rails, default
 * configuration) are intentionally kept internal. Consumers should use
 * the CLI binary rather than calling hench as a library.
 *
 * @module hench/public
 */

// ---- Schema types (config, run records) ------------------------------------

export type {
  HenchConfig,
  GuardConfig,
  RetryConfig,
  Provider,
  RunRecord,
  RunStatus,
  ToolCallRecord,
  TokenUsage,
  TurnTokenUsage,
  CommandRecord,
  TestRecord,
  SummaryCounts,
  PostRunTestRecord,
  RunSummaryData,
} from "./schema/v1.js";

export { HENCH_SCHEMA_VERSION } from "./schema/v1.js";

// ---- Task brief types ------------------------------------------------------

export type {
  TaskBrief,
  TaskBriefTask,
  TaskBriefParent,
  TaskBriefSibling,
  TaskBriefProject,
  TaskBriefLogEntry,
} from "./schema/v1.js";

// ---- Agent lifecycle types -------------------------------------------------

export type { AgentLoopOptions, AgentLoopResult } from "./agent/lifecycle/loop.js";
export type { CliLoopOptions, CliLoopResult } from "./agent/lifecycle/cli-loop.js";
export type { TokenBudgetResult } from "./agent/lifecycle/token-budget.js";
export type { CompletionValidationResult, CompletionValidationOptions } from "./validation/completion.js";
