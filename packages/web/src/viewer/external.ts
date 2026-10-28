/**
 * External gateway for the viewer layer.
 *
 * All viewer-side imports from outside `src/viewer/` are funnelled through
 * this single file. This creates an explicit, auditable import boundary
 * that keeps zone-crossing edges to one file instead of scattering them
 * across the viewer tree.
 *
 * Pattern reference: CLAUDE.md § Gateway modules
 *
 * Zone pin note: This file is pinned to "web-viewer" in .n-dx.json.
 * Without the pin, Louvain places it near "web-server" because this file
 * imports from shared/ and schema/ — both also imported by server files —
 * creating a connectivity bridge (same mechanism as the web-server zone
 * dissolution documented in CLAUDE.md § web-server zone stability). The pin
 * is correct: all 21 importers of this file are viewer files.
 */

// ── Schema types (re-exported for viewer consumption) ──────────────────────
export type {
  Manifest,
  Inventory,
  ImportEdge,
  ImportType,
  Imports,
  Zones,
  Components,
  CallGraph,
  CallEdge,
  ComponentUsageEdge,
  ExternalImport,
  FileEntry,
  Finding,
  RouteExportKind,
  RouteTreeNode,
  Zone,
  ZoneCrossing,
} from "../schema/v1.js";

// Namespace re-export for validate.ts (import type * as V1)
export * as V1 from "../schema/v1.js";

// ── Shared types and constants (via barrel) ───────────────────────────────
export type { FeatureToggle, FeaturesResponse, ViewId, ViewerScope, SourcevisionScopeViewId } from "../shared/index.js";
export { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES, buildValidViews, resolveViewAlias } from "../shared/index.js";
export type { RunOptions, RunOptionKey, RunMode, HubMemoryPressure } from "../shared/index.js";
export { RUN_OPTION_SPECS, checkRunOptions, workCommandArgs, MAX_DASHBOARD_ITERATIONS, MIN_DASHBOARD_ITERATIONS } from "../shared/index.js";
export { SIDECAR_SESSION_ENDED_REASON } from "../shared/index.js";
export { HUB_PATH, detectBasePath, detectViewerBasePath, workspaceKeyFromBasePath, withBasePath, stripBasePath, webSocketUrl } from "../shared/index.js";

// ── Item type (the v1 `level` compatibility shim) ─────────────────────────
// The viewer reads a node's type through `itemTypeOf`, never `item.level`, and
// asks these helpers about the hierarchy rather than keeping its own tables —
// it used to keep six copies of a level-label map and a level hierarchy that
// had already drifted from rex's. Accessors only: the backing tables stay
// behind `shared/item-type.ts` so a consumer cannot index one directly and
// skip the fallback.
export type { ItemType } from "../shared/index.js";
export {
  CRITERIA_LABEL,
  canAddChildType,
  itemTypeOf,
  isRootType,
  isWorkItemType,
  isContainerType,
  childTypeOf,
  parentTypesOf,
  isValidParentType,
  itemTypeLabel,
  itemTypePlural,
  itemTypeEmoji,
  criteriaLabel,
} from "../shared/index.js";

// ── Messaging (via barrel) ───────────────────────────────────────────────────
export { frameIsForWorkspace } from "./messaging/index.js";
