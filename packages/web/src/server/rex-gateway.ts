/**
 * Centralized gateway for rex runtime imports.
 *
 * Web route handlers and the rex MCP server need access to rex domain types,
 * constants, tree utilities, and the MCP server factory. Rather than scattering
 * `import … from "rex"` across route files, all web→rex runtime imports pass
 * through this single module.
 *
 * By concentrating all web→rex runtime imports here, we ensure:
 * - The cross-package surface is **explicit** (re-exports in one file, not scattered).
 * - The DAG stays **acyclic** — rex never imports from web.
 * - Future changes to rex's public API need only be updated in this single file.
 *
 * @module web/server/rex-gateway
 * @see packages/web/src/server/domain-gateway.ts — web's gateway for sourcevision imports
 * @see packages/hench/src/prd/rex-gateway.ts — hench's equivalent gateway for rex
 */

// ---- Rex MCP server factory -------------------------------------------------
export { createRexMcpServer } from "rex";

// ---- Rex domain types & constants -------------------------------------------
export type { Priority, ItemLevel, ItemStatus } from "rex";
export type { RequirementCategory, RequirementValidationType } from "rex";
export type { PRDItem, PRDDocument, Requirement } from "rex";
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
  isRequirementCategory,
  isValidationType,
  isRootLevel,
  isWorkItem,
  isContainerLevel,
  getLevelLabel,
} from "rex";

// ---- Rex tree utilities -----------------------------------------------------
export {
  findItem,
  walkTree,
  insertChild,
  updateInTree,
  removeFromTree,
  computeStats,
  collectAllIds,
} from "rex";
export type { TreeEntry, TreeStats } from "rex";

// ---- Rex task selection -----------------------------------------------------
export { findNextTask, collectCompletedIds } from "rex";

// ---- Rex timestamps ---------------------------------------------------------
export { computeTimestampUpdates } from "rex";

// ---- Rex merge/consolidation ------------------------------------------------
export { validateMerge, previewMerge, mergeItems } from "rex";
export type { MergeValidation, MergePreview, MergeResult } from "rex";

// ---- Rex prune --------------------------------------------------------------
export { countSubtree, isFullyCompleted, findPrunableItems, pruneItems } from "rex";

// ---- Rex analytics ----------------------------------------------------------
export {
  computeEpicStats,
  computePriorityDistribution,
  computeRequirementsSummary,
} from "rex";
export type { EpicStats, PriorityDistribution, RequirementsSummary } from "rex";

// ---- Rex health -------------------------------------------------------------
export { computeHealthScore, formatHealthScore } from "rex";
export type { StructureHealthScore, HealthDimensions, HealthOptions } from "rex";

// ---- Rex reorganize ---------------------------------------------------------
export { detectReorganizations, applyProposals, formatApplyResult } from "rex";
export type { ReorganizationProposal, ReorganizationPlan, ApplyResult } from "rex";

// ---- Rex reshape (LLM-powered restructuring) --------------------------------
export { applyReshape, reasonForReshape, formatReshapeProposal } from "rex";
export type { ReshapeProposal, ReshapeAction, ReshapeResult } from "rex";
export type { ReshapeReasonOptions, ReshapeReasonResult } from "rex";
