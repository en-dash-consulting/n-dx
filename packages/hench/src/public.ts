/**
 * Public API for the hench package.
 *
 * Hench is primarily a **CLI tool** (`hench run`, `hench status`, etc.),
 * but this barrel exports the types and key functions that downstream
 * packages or integration tests may need.  Adding this module completes
 * the `public.ts` + `package.json exports` pattern established by rex,
 * sourcevision, and web.
 *
 * ## What is exported
 *
 * - **Schema types** — `HenchConfig`, `RunRecord`, `RunStatus`, etc.
 *   These define the shape of `.hench/config.json` and run log files
 *   (`.hench/runs/*.json`).  The web dashboard reads these files
 *   directly from disk; exporting the types here lets it validate
 *   the shape at compile time without importing hench at runtime.
 *
 * - **Agent lifecycle types** — `AgentLoopOptions`, `CliLoopOptions`,
 *   `TaskBrief`, etc.  Useful for writing integration tests or
 *   building alternative execution engines.
 *
 * Runtime functions (agent loops, tool dispatch, guard rails) are
 * intentionally kept internal — consumers should use the CLI binary
 * rather than calling hench as a library.
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

export { HENCH_SCHEMA_VERSION, DEFAULT_HENCH_CONFIG } from "./schema/v1.js";

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
