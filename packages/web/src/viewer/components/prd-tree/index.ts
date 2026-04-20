/**
 * PRD tree barrel — re-exports consumed by external modules.
 *
 * Includes the main PRDTree component, filter components, shared types,
 * and internal utilities (lazy-children, listener-lifecycle) whose exports
 * are re-exported here to make zone membership compiler-visible.
 */
export { PRDTree } from "./prd-tree.js";
export type { PRDTreeProps } from "./prd-tree.js";
export { StatusFilter, defaultStatusFilter, ALL_STATUSES } from "../../views/status-filter.js";
export type { StatusFilterProps } from "../../views/status-filter.js";
export { FacetFilter } from "./facet-filter.js";
export type { FacetFilterProps } from "./facet-filter.js";
export type {
  PRDItemData,
  PRDDocumentData,
  ItemLevel,
  ItemStatus,
  Priority,
  BranchStats,
} from "./types.js";
export { LazyChildren, UNMOUNT_DELAY_MS } from "./lazy-children.js";
export type { LazyChildrenProps } from "./lazy-children.js";
export { ListenerLifecycleManager, useNodeListeners } from "./listener-lifecycle.js";
export type { ListenerRecord, ListenerLifecycleState } from "./listener-lifecycle.js";
export { SmartAddInput } from "./smart-add-input.js";
export type { SmartAddInputProps } from "./smart-add-input.js";
export { BatchImportPanel } from "./batch-import-panel.js";
export type { BatchImportPanelProps } from "./batch-import-panel.js";
export { ProposalEditor } from "./proposal-editor.js";
export type { RawProposal, ProposalEditorProps } from "./proposal-editor.js";
export { ExecutionPanel } from "./execution-panel.js";
export type { ExecutionPanelProps } from "./execution-panel.js";
export { ReorganizePanel } from "./reorganize-panel.js";
export {
  countVisibleNodes,
  sliceVisibleTree,
  useProgressiveLoader,
  DEFAULT_CHUNK_SIZE,
  PROGRESSIVE_THRESHOLD,
  LoadMoreIndicator,
} from "./progressive-loader.js";
export type {
  ProgressiveSlice,
  ProgressiveLoaderState,
  LoadMoreIndicatorProps,
} from "./progressive-loader.js";
export type { SearchFacets, SearchItemStatus, SearchablePRDItem } from "./search-types.js";
