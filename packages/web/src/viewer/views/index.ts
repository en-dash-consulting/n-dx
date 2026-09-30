/**
 * Public barrel for the viewer views directory.
 *
 * Tests and sibling zones should import through this barrel rather than
 * reaching into leaf files directly — converts white-box leaf imports to
 * stable barrel imports that survive internal view reorganization.
 *
 * Rules:
 *   - Re-export only — no logic in this file
 *   - Add a re-export here before importing any views/ module from outside
 *     this directory
 */

export { ENRICHMENT_THRESHOLDS } from "./enrichment-thresholds.js";
export type { ViewMeta, ViewProduct } from "./view-meta.js";
export {
  VIEW_META,
  PRODUCT_LABELS,
  viewMeta,
  viewLabel,
  viewBlurb,
  viewGlyph,
  viewProduct,
  viewProductLabel,
} from "./view-meta.js";
export type { StageId, StageDef, StageSection, StageTab, StageProduct, SettingsEntry } from "./stages.js";
export {
  STAGES,
  STAGE_ORDER,
  SETTINGS_ENTRIES,
  isSettingsView,
  isStageId,
  stageForView,
  stageProduct,
  visibleStages,
} from "./stages.js";
export type { IsoMapControls, IsoMapSource } from "./iso-map-url.js";
export {
  ISO_MAP_DEFAULTS,
  ISO_MAP_ENDPOINT,
  ISO_MAP_MAX_NODES,
  ISO_MAP_MIN_NODES,
  ISO_MAP_SOURCES,
  ISO_MAP_SOURCE_LABELS,
  buildIsoMapUrl,
  clampMaxNodes,
  isIsoMapSource,
  isoMapDownloadName,
} from "./iso-map-url.js";
