/**
 * Centralized gateway for `@n-dx/rex` runtime imports.
 *
 * The requirements half of the projection is rex's PRD model read through
 * `loadPrdModel` (one reader for both layouts; a v1 tree reads as changes
 * only) and what rex derives from it: the tree index, the product edges, the
 * computed status and health, the change kind, the commits, files and zones
 * that realize a capability, what git alone says about the work (the
 * N-DX-Item trailer commits on main, where each finished change landed, and
 * the release tag that first contains that landing), and the rules stage of
 * the v1-to-v2 migration plan, which proposes a product layer for a v1 tree.
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
  loadTrailerCommits,
  computeLandings,
  listReleaseTags,
  releasesContaining,
  classifyV1Tree,
  draftCapabilitySpecs,
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
  TrailerCommit,
  ChangeLanding,
  ReleaseTag,
  MigrationPlan,
  PlanEntry,
  PRDItem,
  IntentStatus,
  Health,
  ChangeKind,
  TreeIndex,
  NodeType,
  ItemStatus,
  Priority,
} from "@n-dx/rex";
