/**
 * Shared utilities for the web package.
 *
 * Framework-agnostic modules used by both the viewer and server layers.
 * Each module has zero external dependencies — integration with Preact
 * or other frameworks is handled by the consumer.
 */

export { DATA_FILES, ALL_DATA_FILES, SUPPLEMENTARY_FILES } from "./data-files.js";
export type { ViewId } from "./view-id.js";
export type { FeatureToggle, FeaturesResponse } from "./features.js";
export type { ViewerScope, SourcevisionScopeViewId } from "./view-routing.js";
export {
  SOURCEVISION_SCOPE_VIEWS,
  REX_SCOPE_VIEWS,
  HENCH_SCOPE_VIEWS,
  CROSS_CUTTING_VIEWS,
  VIEWS_BY_SCOPE,
  buildValidViews,
  isKnownViewPath,
} from "./view-routing.js";
