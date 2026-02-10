/**
 * Rex schema v1 — canonical type definitions and domain constants.
 *
 * This is the single source of truth for Rex's data model. All types
 * and constants defined here are re-exported via the schema barrel
 * (`./index.ts`) and the public API (`../public.ts`).
 *
 * ## Cross-package type strategy
 *
 * - **Hench** depends on Rex and uses `import type` for compile-time
 *   contracts. These are erased at runtime, so the packages remain
 *   independently deployable while sharing type safety.
 *
 * - **Sourcevision** intentionally duplicates core types (ItemLevel,
 *   ItemStatus, Priority) because its viewer is bundled as standalone
 *   browser code via esbuild and cannot import from Node.js packages.
 *   The duplicates are documented with `@see` back-references and
 *   verified by compile-time consistency tests.
 *
 * - **Sourcevision server routes** duplicate domain constants (PRIORITY_ORDER,
 *   LEVEL_HIERARCHY) to avoid a package dependency. Each duplicate is
 *   annotated with `@see` references to this file.
 *
 * When modifying types or constants here, also update:
 *   - packages/sourcevision/src/viewer/components/prd-tree/types.ts
 *   - packages/sourcevision/src/cli/server/routes-rex.ts
 *   - packages/sourcevision/src/cli/server/routes-validation.ts
 *   - packages/sourcevision/tests/unit/server/type-consistency.test.ts
 *
 * @module rex/schema/v1
 */

export const SCHEMA_VERSION = "rex/v1";

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus = "pending" | "in_progress" | "completed" | "deferred" | "blocked" | "deleted";

export type Priority = "critical" | "high" | "medium" | "low";

export interface PRDItem {
  id: string;
  title: string;
  status: ItemStatus;
  level: ItemLevel;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  startedAt?: string;
  completedAt?: string;
  children?: PRDItem[];
  [key: string]: unknown;
}

export interface PRDDocument {
  schema: string;
  title: string;
  items: PRDItem[];
  [key: string]: unknown;
}

/** Token/cost budget thresholds for usage warnings. */
export interface BudgetThresholds {
  /** Maximum total tokens (input + output). 0 = unlimited. */
  tokens?: number;
  /** Maximum estimated cost in USD. 0 = unlimited. */
  cost?: number;
  /**
   * Warning threshold as a percentage (0–100).
   * Warn when usage reaches this percentage of the budget.
   * Default: 80.
   */
  warnAt?: number;
  /** Abort operations when budget is exceeded. Default: false. */
  abort?: boolean;
}

export interface RexConfig {
  schema: string;
  project: string;
  adapter: string;
  validate?: string;
  test?: string;
  sourcevision?: string;
  model?: string;
  budget?: BudgetThresholds;
  future?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LogEntry {
  timestamp: string;
  event: string;
  itemId?: string;
  detail?: string;
  [key: string]: unknown;
}

/** Token usage from a Claude API call. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheCreationInput?: number;
  cacheReadInput?: number;
}

/** Aggregated token usage across one or more LLM calls. */
export interface AnalyzeTokenUsage {
  /** Number of LLM calls made. */
  calls: number;
  /** Total input tokens across all calls. */
  inputTokens: number;
  /** Total output tokens across all calls. */
  outputTokens: number;
  /** Total cache creation input tokens (if any). */
  cacheCreationInputTokens?: number;
  /** Total cache read input tokens (if any). */
  cacheReadInputTokens?: number;
}

/**
 * Canonical priority ordering — lower number = higher priority.
 * This is the single source of truth for priority sort order.
 */
export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Valid parent levels for each item level.
 *
 * - `null` entries mean the level can be a root (no parent required).
 * - Multiple entries mean several parent levels are accepted (e.g. a task
 *   can live under a feature *or* directly under an epic).
 */
export const LEVEL_HIERARCHY: Record<ItemLevel, Array<ItemLevel | null>> = {
  epic: [null],
  feature: ["epic"],
  task: ["feature", "epic"],
  subtask: ["task"],
};

export function DEFAULT_CONFIG(project: string): RexConfig {
  return {
    schema: SCHEMA_VERSION,
    project,
    adapter: "file",
    sourcevision: "auto",
  };
}
