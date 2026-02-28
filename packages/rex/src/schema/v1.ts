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
 * - **Web server routes** import types and constants from Rex through
 *   the gateway module (`packages/web/src/server/mcp-deps.ts`), which
 *   re-exports from this file. No duplication needed.
 *
 * - **Web viewer** intentionally duplicates core types (ItemLevel,
 *   ItemStatus, Priority) because the viewer is bundled as standalone
 *   browser code via esbuild and cannot import from Node.js packages.
 *   The duplicates are documented with `@see` back-references and
 *   verified by compile-time consistency tests.
 *
 * When modifying types or constants here, also update:
 *   - packages/web/src/viewer/components/prd-tree/types.ts (viewer types)
 *   - packages/web/tests/unit/server/type-consistency.test.ts
 *
 * @module rex/schema/v1
 */

export const SCHEMA_VERSION = "rex/v1";

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus = "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "deleted";

export type Priority = "critical" | "high" | "medium" | "low";

// ── Requirements ─────────────────────────────────────────────────

/**
 * Category of a requirement.
 *
 * - `technical`: implementation constraints (language, framework, API compatibility)
 * - `performance`: latency, throughput, resource usage targets
 * - `security`: authentication, authorization, data protection
 * - `accessibility`: WCAG compliance, screen reader support
 * - `compatibility`: browser, OS, device support matrix
 * - `quality`: code coverage, lint rules, documentation standards
 */
export type RequirementCategory =
  | "technical"
  | "performance"
  | "security"
  | "accessibility"
  | "compatibility"
  | "quality";

/**
 * How a requirement should be validated.
 *
 * - `automated`: a command/script can verify it (exit 0 = pass)
 * - `manual`: requires human inspection and sign-off
 * - `metric`: a numeric threshold must be met (parsed from output)
 */
export type RequirementValidationType = "automated" | "manual" | "metric";

/**
 * A structured requirement that can be attached to any PRD item.
 *
 * Requirements are first-class objects within the PRD tree.
 * They carry their own acceptance criteria, validation strategy,
 * and optional automation command so hench can verify compliance
 * before marking a task complete.
 */
export interface Requirement {
  /** Unique identifier (UUID). */
  id: string;
  /** Human-readable title. */
  title: string;
  /** Detailed description of the requirement. */
  description?: string;
  /** Requirement category. */
  category: RequirementCategory;
  /** How this requirement is validated. */
  validationType: RequirementValidationType;
  /** Measurable acceptance criteria for this requirement. */
  acceptanceCriteria: string[];
  /**
   * Shell command that validates this requirement (for `automated` or `metric` types).
   * Exit code 0 = pass. For `metric` type, stdout should contain the measured value.
   */
  validationCommand?: string;
  /**
   * Numeric threshold for `metric` validation type.
   * The measured value (from validationCommand stdout) must be >= this threshold.
   */
  threshold?: number;
  /** Priority of this requirement. */
  priority?: Priority;
}

/**
 * Audit marker persisted on items created by explicitly overriding
 * duplicate protection in smart-add flows.
 */
export interface DuplicateOverrideMarker {
  /** Fixed marker type for downstream filtering/reporting. */
  type: "duplicate_guard_override";
  /** Duplicate reason category (e.g. exact_title, semantic_title). */
  reason: string;
  /** Stable reference combining reason + matched item id. */
  reasonRef: string;
  /** Existing PRD item id that was matched as duplicate. */
  matchedItemId: string;
  /** Existing PRD item title that was matched as duplicate. */
  matchedItemTitle: string;
  /** Existing PRD item level that was matched as duplicate. */
  matchedItemLevel: ItemLevel;
  /** Existing PRD item status that was matched as duplicate. */
  matchedItemStatus: ItemStatus;
  /** Timestamp when the override-created item was persisted. */
  createdAt: string;
}

/**
 * Provenance entry for a proposal node that was merged into an existing item
 * during smart-add duplicate resolution.
 */
export interface MergedProposalRecord {
  /** Stable node key from the proposal set (e.g. p0:task:0:1). */
  proposalNodeKey: string;
  /** Human-readable proposal title that was merged. */
  proposalTitle: string;
  /** Proposal node level in the generated structure. */
  proposalKind: "epic" | "feature" | "task";
  /** Duplicate-reason category used for this merge. */
  reason: string;
  /** Similarity score that triggered duplicate detection. */
  score: number;
  /** Timestamp when the merge was applied. */
  mergedAt: string;
  /** Merge source identifier. */
  source: "smart-add";
}

/** All valid requirement categories as a Set. */
export const VALID_REQUIREMENT_CATEGORIES = new Set<RequirementCategory>([
  "technical",
  "performance",
  "security",
  "accessibility",
  "compatibility",
  "quality",
]);

/** All valid validation types as a Set. */
export const VALID_VALIDATION_TYPES = new Set<RequirementValidationType>([
  "automated",
  "manual",
  "metric",
]);

/** Type guard: narrows a string to RequirementCategory. */
export function isRequirementCategory(value: string | undefined): value is RequirementCategory {
  return value !== undefined && VALID_REQUIREMENT_CATEGORIES.has(value as RequirementCategory);
}

/** Type guard: narrows a string to RequirementValidationType. */
export function isValidationType(value: string | undefined): value is RequirementValidationType {
  return value !== undefined && VALID_VALIDATION_TYPES.has(value as RequirementValidationType);
}

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
  /** Structured requirements associated with this item. */
  requirements?: Requirement[];
  startedAt?: string;
  completedAt?: string;
  failureReason?: string;
  /** Present only when duplicate protection was explicitly overridden. */
  overrideMarker?: DuplicateOverrideMarker;
  /** Present when duplicate proposals were merged into this existing item. */
  mergedProposals?: MergedProposalRecord[];
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
  /** LLM vendor used for this token event (e.g. "claude", "codex"). */
  vendor?: string;
  /** Model used for this token event. */
  model?: string;
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

// ── Validation sets ────────────────────────────────────────────────

/** All valid item levels as a Set (derived from LEVEL_HIERARCHY keys). */
export const VALID_LEVELS = new Set<ItemLevel>(
  Object.keys(LEVEL_HIERARCHY) as ItemLevel[],
);

/**
 * All valid item statuses as a Set.
 * Includes "deleted" — downstream consumers may exclude it for API-settable
 * status lists (e.g. the web server's VALID_STATUSES omits "deleted").
 */
export const VALID_STATUSES = new Set<ItemStatus>([
  "pending",
  "in_progress",
  "completed",
  "failing",
  "deferred",
  "blocked",
  "deleted",
]);

/** All valid priority values as a Set (derived from PRIORITY_ORDER keys). */
export const VALID_PRIORITIES = new Set<Priority>(
  Object.keys(PRIORITY_ORDER) as Priority[],
);

// ── Child level inference ──────────────────────────────────────────

/**
 * Map parent level → default child level for inference.
 * Used when adding items under a parent without specifying a level.
 * Subtasks have no children, so they map to null.
 */
export const CHILD_LEVEL: Record<ItemLevel, ItemLevel | null> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
  subtask: null,
};

// ── Type guards ────────────────────────────────────────────────────

/** Type guard: narrows a string to Priority if it's a valid priority value. */
export function isPriority(value: string | undefined): value is Priority {
  return value !== undefined && VALID_PRIORITIES.has(value as Priority);
}

/** Type guard: narrows a string to ItemLevel if it's a valid level value. */
export function isItemLevel(value: string | undefined): value is ItemLevel {
  return value !== undefined && VALID_LEVELS.has(value as ItemLevel);
}

/** Type guard: narrows a string to ItemStatus if it's a valid status value. */
export function isItemStatus(value: string | undefined): value is ItemStatus {
  return value !== undefined && VALID_STATUSES.has(value as ItemStatus);
}

export function DEFAULT_CONFIG(project: string): RexConfig {
  return {
    schema: SCHEMA_VERSION,
    project,
    adapter: "file",
    sourcevision: "auto",
  };
}
