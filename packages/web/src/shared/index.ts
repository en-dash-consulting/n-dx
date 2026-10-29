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
export {
  V1_LEVELS,
  PRODUCT_TYPES,
  CHANGE_TYPES,
  ITEM_TYPES,
  TYPE_PARENTS,
  CHILD_TYPE,
  ITEM_TYPE_LABELS,
  ITEM_TYPE_PLURAL,
  ITEM_TYPE_EMOJI,
  ADDABLE_TYPES,
  CRITERIA_LABEL,
  canAddChildType,
  isItemType,
  isProductType,
  itemTypeOf,
  levelOf,
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
} from "./item-type.js";
export type { ItemType, ItemTypeCarrier, V1Level, ProductType, ChangeType } from "./item-type.js";
export { HUB_ADMISSION_HEADER, MAX_HEADER_QUEUE_ENTRIES, formatHubAdmissionHeader, parseHubAdmissionHeader } from "./hub-admission.js";
export type { HubAdmissionHeader, HubMemoryPressure, HubQueuedRequest } from "./hub-admission.js";
export { RUN_OPTION_SPECS, CONTEXT_NOTES_MAX_BYTES, checkRunOptions, resetsDeferred, runOptionArgs, workCommandArgs, checkRunMode, RUN_MODES, MAX_DASHBOARD_ITERATIONS, MIN_DASHBOARD_ITERATIONS } from "./run-options.js";
export type { RunOptionSpec, RunOptions, RunOptionKey, RunOptionsCheck, WorkCommand, RunMode, RunModeCheck } from "./run-options.js";
export {
  AUTH_COOKIE_NAME,
  AUTH_HEADER_NAME,
  AUTH_QUERY_PARAM,
  tokensEqual,
  parseCookieValue,
  presentedToken,
  isAuthenticated,
  splitTokenQuery,
  authCookie,
  urlWithToken,
} from "./auth.js";
export type { AuthHeaders } from "./auth.js";
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
export { SIDECAR_SESSION_ENDED_REASON } from "./sidecar-card.js";
export type { SidecarChangeSet, SidecarChangeSetItem, SidecarChangeSetEdit, SidecarChangeSetPlacement } from "./sidecar-card.js";
