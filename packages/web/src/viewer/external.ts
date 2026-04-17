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
export { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES, buildValidViews } from "../shared/index.js";

// ── Shared utilities ───────────────────────────────────────────────────────
export { createRequestDedup } from "./messaging/request-dedup.js";
export type { RequestDedup } from "./messaging/request-dedup.js";
