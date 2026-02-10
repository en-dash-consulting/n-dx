/**
 * Public API for the hench package.
 *
 * ## API philosophy: types + schema constants + config factory
 *
 * Hench is a **CLI tool**, not a library. Other packages interact with it
 * exclusively through:
 *
 * 1. **Subprocess spawning** — `cli.js` and `web.js` invoke `hench run`
 * 2. **Filesystem reads** — the web dashboard and rex's token-usage module
 *    read `.hench/config.json` and `.hench/runs/*.json` directly from disk
 *
 * This public API exports types, schema constants, and the default config
 * factory — enough for consumers to validate JSON file shapes at compile
 * time and generate default configurations without creating unnecessary
 * runtime coupling to the agent engine.
 *
 * Each package's public surface reflects its actual consumption pattern —
 * see PACKAGE_GUIDELINES.md for the full decision tree.
 *
 * Runtime functions (agent loops, tool dispatch, guard rails) are
 * intentionally kept internal. Consumers should use the CLI binary
 * rather than calling hench as a library.
 *
 * @module hench/public
 */

// ---- Schema constants & config factory ------------------------------------

export { HENCH_SCHEMA_VERSION, DEFAULT_HENCH_CONFIG } from "./schema/v1.js";

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

// ---- Task brief types ------------------------------------------------------

export type {
  TaskBrief,
  TaskBriefTask,
  TaskBriefParent,
  TaskBriefSibling,
  TaskBriefProject,
  TaskBriefLogEntry,
} from "./schema/v1.js";

// ---- Workflow template types -----------------------------------------------

export { BUILT_IN_TEMPLATES } from "./schema/templates.js";

export type {
  WorkflowTemplate,
  TemplateConfigOverlay,
} from "./schema/templates.js";

// ---- Agent lifecycle types -------------------------------------------------

export type { AgentLoopOptions, AgentLoopResult } from "./agent/lifecycle/loop.js";
export type { CliLoopOptions, CliLoopResult } from "./agent/lifecycle/cli-loop.js";
export type { TokenBudgetResult } from "./agent/lifecycle/token-budget.js";
export type { CompletionValidationResult, CompletionValidationOptions } from "./validation/completion.js";
