/**
 * Viewer inbound API barrel — the sanctioned import surface for
 * sibling zones (crash, route, performance, usage, viewer-ui-hub) that
 * consume viewer-internal symbols.
 *
 * This is the inbound counterpart to external.ts (which concentrates
 * viewer's outbound imports from schema/, shared/, and messaging/).
 *
 * Rules:
 *   - Re-export only — no logic in this file
 *   - Any symbol consumed by a file outside the web-viewer zone
 *     should be re-exported here
 *   - Sibling zones should import from "./api.js" rather than
 *     reaching into types.js, route-state.js, or hooks/ directly
 */

// --- Types (from types.ts) ---
export type {
  LoadedData,
  NavigateTo,
  FileDetail,
  ZoneDetail,
  GenericDetail,
  PRDDetail,
  DetailItem,
} from "./types.js";

// ViewId is re-exported through types.ts from the shared layer
export type { ViewId } from "./types.js";

// --- Route state (from route-state.ts) ---
export type { ParsedRoute } from "./route-state.js";
export {
  parseLegacyHashRoute,
  parsePathnameRoute,
  resolveLocationRoute,
} from "./route-state.js";

// --- Hooks consumed by sibling zones (e.g. the shell components) ---
export { useProjectMetadata, useCliName } from "./hooks/index.js";
export { useFeatureToggle } from "./hooks/index.js";
export { useProjectStatus } from "./hooks/index.js";

// --- Status indicator components (bottom-bar badges) ---
export {
  SvFreshnessIndicator,
  RexCompletionIndicator,
  HenchActivityIndicator,
  INDICATOR_VIEWS,
} from "./components/index.js";

// --- Layout: stages, their sections, and the settings list (shell components) ---
export {
  STAGES,
  STAGE_ORDER,
  SETTINGS_ENTRIES,
  isSettingsView,
  isStageId,
  stageForView,
  stageProduct,
  visibleStages,
} from "./views/stages.js";
export type { StageId, StageDef, StageSection, StageTab, StageProduct, SettingsEntry } from "./views/stages.js";

// --- Navigation model: the one name, glyph, product and blurb per view ---
export {
  VIEW_META,
  PRODUCT_LABELS,
  viewMeta,
  viewLabel,
  viewBlurb,
  viewGlyph,
  viewProduct,
  viewProductLabel,
} from "./views/view-meta.js";
export type { ViewMeta, ViewProduct } from "./views/view-meta.js";
