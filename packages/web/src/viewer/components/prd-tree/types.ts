/**
 * Types for PRD hierarchy visualization.
 *
 * These mirror the canonical types in packages/rex/src/schema/v1.ts.
 * Duplication is intentional: the viewer is bundled as standalone browser
 * code via esbuild and cannot import from the Rex Node.js package at
 * runtime. If the canonical Rex types change, update these to match.
 *
 * Drift between these types and the canonical source is caught by
 * compile-time consistency tests in tests/unit/server/type-consistency.test.ts.
 *
 * @see packages/rex/src/schema/v1.ts — canonical source: ItemLevel, ItemStatus, Priority, PRDItem, PRDDocument
 * @see packages/web/src/server/rex-gateway.ts — server-side gateway (re-exports from rex)
 */

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failing"
  | "deferred"
  | "blocked"
  | "deleted";

export type Priority = "critical" | "high" | "medium" | "low";

/**
 * @see packages/rex/src/schema/v1.ts — RequirementCategory
 */
export type RequirementCategory =
  | "technical"
  | "performance"
  | "security"
  | "accessibility"
  | "compatibility"
  | "quality";

/**
 * @see packages/rex/src/schema/v1.ts — RequirementValidationType
 */
export type RequirementValidationType = "automated" | "manual" | "metric";

/**
 * @see packages/rex/src/schema/v1.ts — Requirement
 */
export interface RequirementData {
  id: string;
  title: string;
  description?: string;
  category: RequirementCategory;
  validationType: RequirementValidationType;
  acceptanceCriteria: string[];
  validationCommand?: string;
  threshold?: number;
  priority?: Priority;
}

/**
 * @see packages/rex/src/schema/v1.ts — ActiveInterval
 */
export interface ActiveIntervalData {
  start: string;
  end?: string;
}

export interface PRDItemData {
  id: string;
  title: string;
  status: ItemStatus;
  level: ItemLevel;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
  blockedBy?: string[];
  /** @see packages/rex/src/schema/v1.ts — PRDItem.requirements */
  requirements?: RequirementData[];
  startedAt?: string;
  endedAt?: string;
  completedAt?: string;
  activeIntervals?: ActiveIntervalData[];
  failureReason?: string;
  children?: PRDItemData[];
}

export interface PRDDocumentData {
  schema: string;
  title: string;
  items: PRDItemData[];
}

export type WeeklyBudgetSource = "vendor_model" | "vendor_default" | "global_default" | "missing_budget";

export interface WeeklyBudgetResolution {
  /** Resolved weekly token budget; null means no configured budget applies. */
  budget: number | null;
  /** Which lookup tier produced the result. */
  source: WeeklyBudgetSource;
}

export interface TaskUtilizationSummary {
  /** Rounded weekly utilization percentage, if budget is available. */
  percent: number | null;
  /** Shared display label used in chips and detail panel. */
  label: string;
  /** Resolver source reason used for fallback diagnostics. */
  reason: WeeklyBudgetSource;
}

/** Aggregated token usage for a single task across associated runs. */
export interface TaskUsageSummary {
  totalTokens: number;
  runCount: number;
  utilization?: TaskUtilizationSummary;
}

/** Bucketed token totals. */
export interface ItemUsageBucket {
  totalTokens: number;
  runCount: number;
}

/**
 * Rolled-up per-item work duration.
 *
 * `totalMs` is the sum of this item's elapsed intervals plus every
 * descendant's `totalMs`. `runningMs` is the portion of `totalMs`
 * currently "live" (open intervals measured from their start to the
 * server clock at response time). `isRunning` is true when any interval
 * in the subtree is open.
 *
 * Mirrors the `ItemDurationTotals` wire shape emitted by the
 * `/api/hench/task-usage` endpoint; the server computes this via rex's
 * `aggregateItemDurations` so the viewer never aggregates tree duration
 * itself. Live-tick rendering multiplies elapsed client time against
 * `runningMs` to avoid re-polling for every frame.
 *
 * @see packages/rex/src/core/item-duration-rollup.ts — canonical aggregator
 */
export interface ItemDurationRollup {
  totalMs: number;
  runningMs: number;
  isRunning: boolean;
}

/**
 * Rolled-up per-item token usage + duration.
 *
 * `self` captures runs that directly targeted this item; `descendants`
 * sums every descendant's `total`; `total = self + descendants`.
 *
 * `duration` is the matching duration rollup so the tree row can render
 * token and duration columns from a single fetch.
 *
 * Mirrors the wire shape emitted by `/api/hench/task-usage`; the server
 * computes this via rex's `aggregateItemTokenUsage` + `aggregateItemDurations`
 * so the viewer never aggregates tree usage itself.
 *
 * @see packages/rex/src/core/item-token-rollup.ts — canonical token aggregator
 * @see packages/rex/src/core/item-duration-rollup.ts — canonical duration aggregator
 */
export interface ItemUsageRollup {
  self: ItemUsageBucket;
  descendants: ItemUsageBucket;
  total: ItemUsageBucket;
  /**
   * Duration rollup added in the combined `{ tokens, duration }` accessor.
   * Optional so older server payloads (pre-combined-accessor) and existing
   * fixtures without duration fields still type-check.
   */
  duration?: ItemDurationRollup;
}

/** Computed stats for a branch of the tree. */
export interface BranchStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  failing: number;
  deferred: number;
  blocked: number;
  deleted: number;
}
