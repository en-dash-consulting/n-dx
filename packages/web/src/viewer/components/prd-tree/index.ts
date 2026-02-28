/**
 * PRD tree barrel — re-exports consumed by external modules.
 *
 * Only includes exports actually imported via "prd-tree/index.js".
 * Components and utilities that are only used within prd-tree/ or
 * imported directly by path are not re-exported here to avoid
 * pulling in cross-zone dependencies unnecessarily.
 */
export { PRDTree } from "./prd-tree.js";
export type { PRDTreeProps } from "./prd-tree.js";
export type {
  PRDItemData,
  PRDDocumentData,
  ItemLevel,
  ItemStatus,
  Priority,
  BranchStats,
} from "./types.js";
