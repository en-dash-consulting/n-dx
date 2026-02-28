/**
 * Public API for the rex package.
 *
 * ## API philosophy: runtime functions + types
 *
 * Rex is consumed as a **library** by hench (via `prd/ops.ts` gateway).
 * This public API therefore exports runtime functions for store access,
 * tree manipulation, and task selection — everything hench needs to
 * manage PRD state programmatically.
 *
 * Each package's public surface reflects its actual consumption pattern —
 * see PACKAGE_GUIDELINES.md for the full decision tree and comparison table.
 *
 * ## Configuration
 *
 * `DEFAULT_CONFIG(project)` is exported for consumers that need to generate
 * default Rex configurations programmatically (e.g., init scripts, tooling).
 * Note it requires a project name parameter.
 *
 * ## Architectural isolation
 *
 * Rex depends only on `@n-dx/llm-client` (the shared foundation)
 * and has **no dependency on hench or sourcevision**. This strict
 * one-way dependency ensures the monorepo's DAG remains acyclic:
 *
 * ```
 *   hench → rex → claude-client ← sourcevision
 * ```
 *
 * ## Cross-package imports
 *
 * Hench uses `import type { PRDStore, PRDItem, ... } from "rex"` for
 * compile-time type safety. These `import type` statements are erased
 * during compilation and create zero runtime coupling — the packages
 * remain independently deployable.
 *
 * Runtime imports from rex are funnelled through a single gateway module
 * (`hench/src/prd/ops.ts`) to keep the cross-package surface explicit
 * and auditable.
 *
 * Validation functions (Zod schemas) are NOT exported here. Consumers
 * that need runtime validation should import directly from
 * `rex/src/schema/validate.js` to avoid forcing Zod as a transitive
 * dependency on type-only consumers.
 *
 * @module rex/public
 */

// ---- Store ------------------------------------------------------------------

export { resolveStore } from "./store/index.js";
export type { PRDStore } from "./store/types.js";

// ---- Integration schema system ----------------------------------------------

export {
  validateField,
  validateConfig,
  registerIntegrationSchema,
  getIntegrationSchema,
  listIntegrationSchemas,
  toAdapterConfigSchema,
} from "./store/integration-schema.js";
export type {
  FieldInputType,
  FieldValidationRule,
  FieldSelectOption,
  IntegrationFieldSchema,
  IntegrationSchema,
  IntegrationFieldGroup,
  FieldValidationResult,
} from "./store/integration-schema.js";
export {
  registerBuiltInSchemas,
  ensureSchemas,
} from "./store/integration-schemas/index.js";
export { notionIntegrationSchema } from "./store/integration-schemas/notion.js";
export { jiraIntegrationSchema } from "./store/integration-schemas/jira.js";

// ---- Schema types & constants -----------------------------------------------

export type {
  PRDItem, PRDDocument, ItemLevel, ItemStatus, Priority, RexConfig,
  RequirementCategory, RequirementValidationType, Requirement,
} from "./schema/v1.js";
export {
  PRIORITY_ORDER,
  LEVEL_HIERARCHY,
  VALID_LEVELS,
  VALID_STATUSES,
  VALID_PRIORITIES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  isItemStatus,
  isRequirementCategory,
  isValidationType,
  DEFAULT_CONFIG,
} from "./schema/v1.js";

// ---- Core: tree utilities ---------------------------------------------------

export {
  findItem, walkTree, collectAllIds,
  insertChild, updateInTree, removeFromTree,
} from "./core/tree.js";
export type { TreeEntry } from "./core/tree.js";

// ---- Core: stats ------------------------------------------------------------

export { computeStats } from "./core/stats.js";
export type { TreeStats } from "./core/stats.js";

// ---- Core: deletion ---------------------------------------------------------

export { deleteItem, cleanBlockedByRefs } from "./core/delete.js";
export { removeEpic } from "./core/remove-epic.js";
export type { RemoveEpicResult } from "./core/remove-epic.js";
export { removeTask } from "./core/remove-task.js";
export type { RemoveTaskResult, ParentAutoCompletion } from "./core/remove-task.js";
export { preCheckFeatureDeletion, removeFeature } from "./core/remove-feature.js";
export type {
  DeletionPreCheck, RemoveFeatureResult,
  ExternalDependent, SyncedItem,
} from "./core/remove-feature.js";

// ---- Core: task selection ---------------------------------------------------

export {
  findNextTask,
  findActionableTasks,
  collectCompletedIds,
  extractTaskKeywords,
  matchTasksByKeywords,
  requirementsScore,
} from "./core/next-task.js";
export type { TaskMatch, PrioritizationOptions, RiskTolerance } from "./core/next-task.js";

// ---- Core: keywords ---------------------------------------------------------

export { extractKeywords, scoreMatch } from "./core/keywords.js";

// ---- Core: timestamps -------------------------------------------------------

export { computeTimestampUpdates } from "./core/timestamps.js";

// ---- Core: parent auto-completion -------------------------------------------

export { findAutoCompletions } from "./core/parent-completion.js";

// ---- Core: parent status reset ----------------------------------------------

export { findParentResets } from "./core/parent-reset.js";
export { cascadeParentReset } from "./core/cascade-reset.js";

// ---- Core: requirements -----------------------------------------------------

export {
  collectRequirements,
  collectRequirementsByCategory,
  collectRequirementsByValidationType,
  validateRequirements,
  validateAutomatedRequirements,
  formatRequirementsValidation,
  buildTraceabilityMatrix,
} from "./core/requirements.js";
export type {
  TracedRequirement,
  RequirementValidationResult,
  RequirementsValidationSummary,
  CommandExecutor,
} from "./core/requirements.js";

// ---- Core: merge/consolidation ----------------------------------------------

export { validateMerge, previewMerge, mergeItems } from "./core/merge.js";
export type { MergeOptions, MergeValidation, MergePreview, MergeResult } from "./core/merge.js";

// ---- Core: prune ------------------------------------------------------------

export {
  countSubtree, isFullyCompleted,
  findPrunableItems, pruneItems,
} from "./core/prune.js";
export type { PruneResult } from "./core/prune.js";

// ---- Core: analytics --------------------------------------------------------

export {
  computeEpicStats, computePriorityDistribution,
  computeRequirementsSummary,
} from "./core/analytics.js";
export type {
  EpicStats, PriorityDistribution, RequirementsSummary,
} from "./core/analytics.js";

// ---- Analyze: finding acknowledgment ----------------------------------------

export {
  computeFindingHash, loadAcknowledged, saveAcknowledged,
  acknowledgeFinding, isAcknowledged,
} from "./analyze/acknowledge.js";
export type { AcknowledgedFinding, AcknowledgedStore } from "./analyze/acknowledge.js";

// ---- Recommend: PRD creation from recommendations ---------------------------

export { createItemsFromRecommendations } from "./recommend/create-from-recommendations.js";
export type {
  EnrichedRecommendation, RecommendationMeta, CreationResult,
  SkippedRecommendation, ReparentedRecommendation,
} from "./recommend/create-from-recommendations.js";

// ---- MCP server factory -----------------------------------------------------

export { createRexMcpServer } from "./cli/mcp.js";
