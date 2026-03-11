/**
 * External gateway for the viewer layer.
 *
 * All viewer-side imports from outside `src/viewer/` are funnelled through
 * this single file. This creates an explicit, auditable import boundary
 * that keeps zone-crossing edges to one file instead of scattering them
 * across the viewer tree.
 *
 * Pattern reference: CLAUDE.md § Gateway modules
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

// ── Feature toggle contract types ──────────────────────────────────────────
export type { FeatureToggle, FeaturesResponse } from "../schema/features.js";

// ── Shared data-file constants ─────────────────────────────────────────────
export { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "../shared/data-files.js";

// ── Shared types ──────────────────────────────────────────────────────────
export type { ViewId } from "../shared/view-id.js";

// ── Shared utilities ───────────────────────────────────────────────────────
export { createRequestDedup } from "./messaging/request-dedup.js";
export type { RequestDedup } from "./messaging/request-dedup.js";
