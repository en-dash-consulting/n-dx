/**
 * Centralized gateway for rex runtime imports.
 *
 * Web route handlers and the rex MCP server need access to rex domain types,
 * constants, tree utilities, and the MCP server factory. Rather than scattering
 * `import … from "@n-dx/rex"` across route files, all web→rex runtime imports pass
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
export { createRexMcpServer } from "@n-dx/rex";

// ---- Rex legacy PRD migration -----------------------------------------------
export { ensureLegacyPrdMigrated } from "@n-dx/rex";
export type { LegacyPrdMigrationResult } from "@n-dx/rex";

// ---- Rex folder-tree storage path -------------------------------------------
export { PRD_TREE_DIRNAME } from "@n-dx/rex";

// ---- Rex schema version contract --------------------------------------------
export { SCHEMA_VERSION, isCompatibleSchema } from "@n-dx/rex";

// ---- Rex domain types & constants -------------------------------------------
export type { ItemLevel, ItemStatus } from "@n-dx/rex";
export type { PRDItem, PRDDocument, Requirement } from "@n-dx/rex";
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
} from "@n-dx/rex";

// ---- Rex tree utilities -----------------------------------------------------
export {
  findItem,
  walkTree,
  insertChild,
  updateInTree,
  removeFromTree,
  computeStats,
  collectAllIds,
} from "@n-dx/rex";
export type { TreeEntry, TreeStats } from "@n-dx/rex";

// ---- Rex task selection -----------------------------------------------------
export { findNextTask, collectCompletedIds } from "@n-dx/rex";

// ---- Rex timestamps ---------------------------------------------------------
export { computeTimestampUpdates } from "@n-dx/rex";

// ---- Rex per-item token rollup ----------------------------------------------
// Only the symbols actively consumed by the web server route handler
// are re-exported through the gateway. ItemTokenTuple, ItemRunTokens, and
// ItemTokenAggregation live in rex's public API but are not (yet)
// consumed by web — if a future route needs them, add the re-export here.
export { aggregateItemTokenUsage } from "@n-dx/rex";
export type { ItemTokenTotals } from "@n-dx/rex";

// ---- Rex per-item duration rollup -------------------------------------------
export { aggregateItemDurations } from "@n-dx/rex";
export type { ItemDurationTotals } from "@n-dx/rex";

// ---- Rex merge/consolidation ------------------------------------------------
export { validateMerge, previewMerge, mergeItems } from "@n-dx/rex";

// ---- Rex prune --------------------------------------------------------------
export { countSubtree } from "@n-dx/rex";

// ---- Rex analytics ----------------------------------------------------------
export {
  computeEpicStats,
  computePriorityDistribution,
  computeRequirementsSummary,
} from "@n-dx/rex";

// ---- Rex health -------------------------------------------------------------
export { computeHealthScore } from "@n-dx/rex";

// ---- Rex reorganize ---------------------------------------------------------
export { detectReorganizations, applyProposals } from "@n-dx/rex";

// ---- Rex reshape (LLM-powered restructuring) --------------------------------
export { applyReshape, reasonForReshape } from "@n-dx/rex";
export type { ReshapeProposal } from "@n-dx/rex";

// ---- Rex MCP tool handlers (direct invocation) -----------------------------
export { handleEditItem } from "@n-dx/rex";

// ---- Rex proposal types (consumed by viewer analyze-panel) ------------------
export type { Proposal, ProposalFeature, ProposalTask } from "@n-dx/rex";

// ---- Rex Markdown serializer / parser (used by prd-io cache) ----------------
export { serializeDocument, parseDocument } from "@n-dx/rex";

// ---- Rex folder-tree parser (used by prd-io cache) --------------------------
export { parseFolderTree } from "@n-dx/rex";

// ---- Rex folder-tree slug resolver (used by merge-history graph builder) ----
// `resolveSiblingSlugs` is the canonical way to determine the on-disk slug for
// each PRDItem at a given level, accounting for collisions and short-id
// suffixes. The merge-history graph builder uses it to label PRD nodes with
// their folder-tree path so the context-graph hierarchy mirrors `.rex/prd_tree/`
// without re-walking the directory.
export { resolveSiblingSlugs } from "@n-dx/rex";
