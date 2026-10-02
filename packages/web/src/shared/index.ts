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
  HUB_PATH,
  PROJECT_PATH_PREFIX,
  WORKSPACE_PATH_PREFIX,
  detectBasePath,
  detectViewerBasePath,
  isHubChooserPath,
  projectIdFromBasePath,
  safeDecodeSegment,
  workspaceKeyFromBasePath,
  stripWorkspaceSlot,
  withBasePath,
  stripBasePath,
  webSocketUrl,
} from "./base-path.js";
export { isLoopbackHostOnPort, isLoopbackOriginOnPort, loopbackOrigin } from "./origin.js";
export { HUB_ADMISSION_HEADER, formatHubAdmissionHeader, parseHubAdmissionHeader } from "./hub-admission.js";
export type { HubAdmissionHeader, HubMemoryPressure } from "./hub-admission.js";
export { RUN_OPTION_SPECS, CONTEXT_NOTES_MAX_BYTES, checkRunOptions, runOptionArgs, workCommandArgs } from "./run-options.js";
export type { RunOptionSpec, RunOptions, RunOptionKey, RunOptionsCheck, WorkCommand } from "./run-options.js";
export {
  SOURCEVISION_SCOPE_VIEWS,
  REX_SCOPE_VIEWS,
  HENCH_SCOPE_VIEWS,
  CROSS_CUTTING_VIEWS,
  VIEWS_BY_SCOPE,
  buildValidViews,
  isKnownViewPath,
  resolveViewAlias,
} from "./view-routing.js";
