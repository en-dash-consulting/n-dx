/**
 * Public surface of the hub zone. Consumers (the CLI, later core via spawn)
 * import from here, never from the leaf modules.
 *
 * @module web/hub
 */

export { startHub, Hub, DEFAULT_HUB_PORT, normalizeWorktree } from "./hub.js";
export type { HubOptions, HubHandle, CloseOptions, RegisterProjectInput, ProjectView, WorktreeRemoval } from "./hub.js";
export { buildServeCommand, checkProjectHealth, ProjectSupervisor, MAX_RESPAWNS } from "./children.js";
export type { ChildState, ChildStatus, SupervisorOptions } from "./children.js";
export {
  HUB_REGISTRY_VERSION,
  HUB_REGISTRY_FILE,
  HUB_PID_FILE,
  HUB_CONFIG_FILE,
  resolveHubHome,
  registryPath,
  hubPidPath,
  hubConfigPath,
  readHubConfig,
  HUB_CONFIG_DEFAULTS,
  loadRegistry,
  loadRegistryHealing,
  saveRegistry,
  emptyRegistry,
  readHubPidFile,
  writeHubPidFile,
  removeHubPidFile,
  isPidAlive,
} from "./registry.js";
export type { HealedRecord, HubRegistry, ProjectRecord, HubPidFile, HubConfig, HubConfigResult, HubConfigProblem } from "./registry.js";
export { parseRegisterInput, handleHubRoute } from "./routes.js";
export {
  planNewProject,
  validateProjectName,
  slugifyProjectId,
  deriveProjectId,
  isReservedProjectId,
  defaultParentDir,
} from "./new-project.js";
export type { NewProjectInput, NewProjectPlan } from "./new-project.js";
export {
  AdmissionGate,
  AdmissionQueue,
  decideAdmission,
  sameQueueEntry,
  countProjectExecutions,
} from "./admission.js";
export type {
  AdmissionLimits,
  AdmissionSnapshot,
  AdmissionDecision,
  AdmissionReason,
  AdmissionGateOptions,
  AdmitResult,
  DroppedEntry,
  ExecuteRefusal,
  QueueEntry,
  QueueSnapshot,
  StartOutcome,
} from "./admission.js";
export {
  SidecarManager,
  ndxCliPlanner,
  SIDECAR_START_TIMEOUT_MS,
  SIDECAR_CRASH_LIMIT,
  SIDECAR_CRASH_WINDOW_MS,
} from "./sidecars.js";
export type {
  SidecarPlan,
  PlanResult,
  PlanSidecar,
  EnsureResult,
  SidecarState,
  SidecarStatus,
  SidecarManagerOptions,
} from "./sidecars.js";
export { EXTENSION_API_VERSION, ndxCliLister, buildExtensionsAnswer, resolveProjectLink } from "./extensions.js";
export type {
  ExtensionStateName,
  ExtensionManifest,
  ExtensionListing,
  ListResult,
  ListExtensions,
  ExtensionSidecarView,
  ExtensionLinkView,
  ExtensionView,
  ExtensionsAnswer,
} from "./extensions.js";
export { decideProxy, matchProjectByDir, proxyHttp, proxyUpgrade, handleProxyRequest, handleProxyUpgrade, sidecarHeaderValue, SIDECAR_BASE_PATH_HEADER } from "./proxy.js";
export type { ProxyDecision, SidecarForward } from "./proxy.js";
export { buildHubOverview, fetchChildSnapshot, toProjectCard } from "./overview.js";
export type { HubOverview, ProjectCard, ChildSnapshot } from "./overview.js";
export { renderHomePage, renderCard, renderCards, cardFacts, dirtyLabel, progressLabel, runningLabel, readinessLabel, infrastructureLabel } from "./home.js";
