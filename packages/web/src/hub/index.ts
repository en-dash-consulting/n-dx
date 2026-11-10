/**
 * Public surface of the hub zone. Consumers (the CLI, later core via spawn)
 * import from here, never from the leaf modules.
 *
 * @module web/hub
 */

export { startHub, Hub, DEFAULT_HUB_PORT, normalizeWorktree, resolveNdxCli } from "./hub.js";
export type { HubOptions, HubHandle, CloseOptions, RegisterProjectInput, ProjectView, WorktreeRemoval } from "./hub.js";
export { buildServeCommand, checkProjectHealth, ProjectSupervisor, MAX_RESPAWNS, NO_NDX_BIN } from "./children.js";
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
  NO_NDX_CLI,
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
export { EXTENSION_API_VERSION, ndxCliLister, buildExtensionsAnswer, resolveProjectLink, resolveFrameUrl } from "./extensions.js";
export { FrameKeys, parseKeyedPath, FRAME_KEY_SEGMENT, FRAME_KEY_HARD_CAP_MS, DEFAULT_IDLE_STOP_MINUTES } from "./frame-keys.js";
export type { FrameKeyOptions, IssuedFrameKey } from "./frame-keys.js";
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
export { decideProxy, matchProjectByDir, proxyHttp, proxyUpgrade, handleProxyRequest, handleProxyUpgrade, MAX_HUB_SESSION_BODY_BYTES, sidecarHeaderValue, SIDECAR_BASE_PATH_HEADER, FRAME_CSP } from "./proxy.js";
export type { ProxyDecision, SidecarForward, UpgradeGate } from "./proxy.js";
export { buildHubOverview, fetchChildSnapshot, toProjectCard } from "./overview.js";
export {
  HubSessionHostPicker,
  HUB_SESSION_FEATURE,
  probeHubLens,
  claimHubSessionHost,
  hubSessionHostLockPath,
  hubSidecarDir,
  hubLedgerPath,
  readHubSessionHostLock,
  releaseHubSessionHost,
} from "./session-host.js";
export type { ClaimHubSessionHostInput, HubLensProbeOptions, HubSessionHostClaim, HubSessionHostLock } from "./session-host.js";
export { hubUsagePath, recordHubUsage, readHubUsageTotals } from "./usage-ledger.js";
export { TrackerSyncClock, hasActiveTrackerRule, proxiedTickPost, TRACKER_TICK_INTERVAL_MS, TRACKER_TICK_PATH } from "./tracker-sync.js";
export type { TrackerSyncClockOptions, TrackerTickOutcome, TrackerTickPost } from "./tracker-sync.js";
export type { HubUsageRecord, HubUsageTotals } from "./usage-ledger.js";
export type { HubOverview, ProjectCard, ChildSnapshot } from "./overview.js";
export { renderHomePage, renderCard, renderCards, cardFacts, dirtyLabel, progressLabel, runningLabel, readinessLabel, infrastructureLabel } from "./home.js";
