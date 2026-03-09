/**
 * Centralized gateway for rex runtime imports.
 *
 * Web route handlers and the rex MCP server need access to rex domain types,
 * constants, tree utilities, and the MCP server factory. Rather than scattering
 * `import … from "rex"` across route files, all web→rex runtime imports pass
 * through this single module.
 *
 * **Minimal surface:** This gateway re-exports only the symbols actually
 * consumed by web package source files. If a new route needs a rex symbol,
 * add the re-export here — don't import rex directly in the route file.
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

// ---- Rex schema version contract --------------------------------------------
export { SCHEMA_VERSION, isCompatibleSchema } from "rex";

// ---- Rex domain types & constants -------------------------------------------
export type { ItemLevel, ItemStatus } from "rex";
export type { PRDItem, PRDDocument, Requirement } from "rex";
export {
  LEVEL_HIERARCHY,
  VALID_STATUSES,
  VALID_REQUIREMENT_CATEGORIES,
  VALID_VALIDATION_TYPES,
  CHILD_LEVEL,
  isPriority,
  isItemLevel,
  isRequirementCategory,
  isValidationType,
  isRootLevel,
  isWorkItem,
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

// ---- Rex prune --------------------------------------------------------------
export { countSubtree } from "rex";

// ---- Rex analytics ----------------------------------------------------------
export {
  computeEpicStats,
  computePriorityDistribution,
  computeRequirementsSummary,
} from "rex";

// ---- Rex health -------------------------------------------------------------
export { computeHealthScore } from "rex";

// ---- Rex reorganize ---------------------------------------------------------
export { detectReorganizations, applyProposals } from "rex";

// ---- Rex reshape (LLM-powered restructuring) --------------------------------
export { applyReshape, reasonForReshape } from "rex";
export type { ReshapeProposal } from "rex";

// ---- Rex MCP tool handlers (direct invocation) -----------------------------
export { handleEditItem } from "rex";

// ---- Rex proposal types (consumed by viewer analyze-panel) ------------------
export type { Proposal, ProposalFeature, ProposalTask } from "rex";
