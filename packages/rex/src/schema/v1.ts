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

/**
 * The schema version string embedded in every PRD document.
 *
 * This constant is the contract between rex and all `.rex/prd.json`
 * consumers: hench (reader/writer via rex-gateway), web server (reader
 * via MCP and REST), and CI (validator). When the schema changes
 * incompatibly, bump the major version to trigger `isCompatibleSchema()`
 * failures at every read boundary, preventing silent data corruption
 * across the three-tier hierarchy (domain → execution → orchestration).
 */
export const SCHEMA_VERSION = "rex/v1";

/**
 * Check if a schema version string is compatible with the current version.
 *
 * Compatibility rules:
 * - Exact match always passes.
 * - Same major version (prefix before `/`) is considered compatible
 *   (e.g. "rex/v1" is compatible with "rex/v1.1" — forward-compatible).
 * - Different prefix or missing version fails.
 *
 * This is a lightweight check that does NOT require Zod. Use it in
 * hot paths (e.g. web server reads) where full validation is too expensive.
 */
export function isCompatibleSchema(version: string | undefined): boolean {
  if (!version) return false;
  if (version === SCHEMA_VERSION) return true;
  // Allow forward-compatible minor versions (e.g. "rex/v1.1" matches "rex/v1")
  return version.startsWith(SCHEMA_VERSION + ".");
}

/**
 * Assert that a document's schema field is compatible with the current version.
 * Throws a descriptive error if the schema is missing or incompatible.
 *
 * Use this at read boundaries (store loads, API handlers) to catch
 * version drift early rather than letting it surface as cryptic type errors.
 */
export function assertSchemaVersion(doc: { schema?: string }): void {
  if (!isCompatibleSchema(doc.schema)) {
    throw new Error(
      `Incompatible PRD schema: found "${doc.schema ?? "(missing)"}",` +
      ` expected "${SCHEMA_VERSION}". ` +
      `Run "rex validate" to check and migrate your PRD.`,
    );
  }
}

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus = "pending" | "in_progress" | "completed" | "failing" | "deferred" | "blocked" | "deleted";

export type Priority = "critical" | "high" | "medium" | "low";

/**
 * How a task was resolved. Tracks whether completion involved actual code
 * changes or just configuration overrides, enabling escalation when zones
 * accumulate too many override-based resolutions.
 */
export type ResolutionType = "code-change" | "config-override" | "acknowledgment" | "deferred" | "unclassified";

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

/**
 * Commit attribution: hash, author, and timestamp of a commit
 * associated with this PRD item. Array accumulates as an item
 * is touched across multiple commits (especially for items
 * completed across multiple commits).
 */
export interface CommitAttribution {
  /** Full git commit SHA-1 hash (40 hex characters). */
  hash: string;
  /** Commit author name (from git config or commit object). */
  author: string;
  /** Author email address. */
  authorEmail: string;
  /** ISO 8601 timestamp of the commit. */
  timestamp: string;
  /** Optional commit message (first line). */
  message?: string;
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

/**
 * A single active work interval. An interval with no `end` is open — the item
 * is currently in `in_progress` status. Intervals accumulate: re-opening a
 * completed task appends a new interval rather than overwriting the prior one.
 */
export interface ActiveInterval {
  /** ISO timestamp when work started (entered `in_progress`). */
  start: string;
  /** ISO timestamp when work paused/completed. Absent if still running. */
  end?: string;
}

export interface PRDItem {
  id: string;
  title: string;
  status: ItemStatus;
  level: ItemLevel;
  /** Git branch the item originated from or was last attributed to. */
  branch?: string;
  /** PRD source file the item originated from or was last written to. */
  sourceFile?: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
  source?: string;
  blockedBy?: string[];
  /** Structured requirements associated with this item. */
  requirements?: Requirement[];
  /** ISO timestamp of the first transition into `in_progress`. Preserved across re-opens. */
  startedAt?: string;
  /** ISO timestamp of the latest transition into `completed`. Cleared if the item is re-opened. */
  completedAt?: string;
  /** ISO timestamp of the most recent transition out of `in_progress` into a terminal state. Cleared when work resumes. */
  endedAt?: string;
  /**
   * Append-only log of work intervals. Each `in_progress` entry pushes a new
   * open interval; leaving `in_progress` closes the last one. Re-opening a
   * completed task appends a new interval without mutating earlier ones, so
   * cumulative duration can be derived by summing `end - start` across the list.
   */
  activeIntervals?: ActiveInterval[];
  failureReason?: string;
  /** How this item was resolved (code change, config override, etc.). */
  resolutionType?: ResolutionType;
  /** Brief description of how the resolution was achieved. */
  resolutionDetail?: string;
  /** Present only when duplicate protection was explicitly overridden. */
  overrideMarker?: DuplicateOverrideMarker;
  /** Present when duplicate proposals were merged into this existing item. */
  mergedProposals?: MergedProposalRecord[];
  /** Commits (SHA hash + author + timestamp) associated with this item. */
  commits?: CommitAttribution[];
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

/** Level-of-Effort estimation and decomposition thresholds (stored in config.json). */
export interface LoEConfig {
  /**
   * Maximum task size in engineer-weeks before automatic decomposition.
   * Tasks with LoE exceeding this threshold are broken into smaller children.
   * Default: 2.
   */
  taskThresholdWeeks?: number;
  /**
   * Maximum recursion depth for decomposition.
   * Prevents runaway decomposition of deeply nested items.
   * Default: 2.
   */
  maxDecompositionDepth?: number;
  /**
   * Maximum number of proposal task items per input description before
   * triggering a secondary LLM consolidation pass. When the LLM produces
   * more tasks than this ceiling, a re-consolidation prompt is sent to
   * reduce over-granular output.
   * Default: 10.
   */
  proposalCeiling?: number;
}

/** Default LoE configuration values. */
export const LOE_DEFAULTS = {
  taskThresholdWeeks: 2,
  maxDecompositionDepth: 2,
  proposalCeiling: 10,
} as const;

/** Configuration for a single facet dimension (stored in config.json). */
export interface FacetDefinition {
  label: string;
  values: string[];
  required?: boolean;
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
  /** Level-of-Effort estimation thresholds for proposal decomposition. */
  loe?: LoEConfig;
  /** Facet dimensions for item classification (e.g. component, concern). */
  facets?: Record<string, FacetDefinition>;
  /** Structural health thresholds — warn when PRD shape degrades. */
  structureHealth?: StructureHealthThresholds;
  future?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Configurable thresholds for PRD structural health checks. */
export interface StructureHealthThresholds {
  /** Maximum number of top-level epics before warning (default: 15). */
  maxTopLevelEpics?: number;
  /** Maximum tree depth before warning (default: 5). */
  maxTreeDepth?: number;
  /** Maximum children per container before warning (default: 20). */
  maxChildrenPerContainer?: number;
  /** Minimum children per container before warning (default: 2). */
  minChildrenPerContainer?: number;
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
