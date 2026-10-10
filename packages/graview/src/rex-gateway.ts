/**
 * Centralized gateway for `@n-dx/rex` runtime imports.
 *
 * The requirements half of the projection is rex's PRD model read through
 * `loadPrdModel` (one reader for both layouts; a v1 tree reads as changes
 * only) and what rex derives from it: the tree index, the product edges, the
 * computed status and health, the change kind, and the commits, files and
 * zones that realize a capability.
 *
 * @module graview/rex-gateway
 * @see ./sourcevision-gateway.ts — sourcevision's output schema
 * @see ./hench-gateway.ts — hench's run record type
 * @see ./llm-gateway.ts — layout and spawning
 */
export {
  loadPrdModel,
  prdLayout,
  indexTree,
  computeEdges,
  computeProductStatus,
  computeRealizedBy,
  deriveChangeKind,
  NODE_TYPES,
  PRODUCT_NODE_TYPES,
  CHANGE_NODE_TYPES,
} from "@n-dx/rex";
export type {
  PrdModel,
  V2Tree,
  RuleNode,
  ChangeNode,
  ProductEdges,
  Realization,
  IntentStatus,
  Health,
  ChangeKind,
  TreeIndex,
  NodeType,
  ItemStatus,
  Priority,
} from "@n-dx/rex";
