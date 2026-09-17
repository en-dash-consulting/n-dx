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
  saveRegistry,
  emptyRegistry,
  readHubPidFile,
  writeHubPidFile,
  removeHubPidFile,
  isPidAlive,
} from "./registry.js";
export type { HubRegistry, ProjectRecord, HubPidFile, HubConfig, HubConfigResult, HubConfigProblem } from "./registry.js";
export { parseRegisterInput, handleHubRoute } from "./routes.js";
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
  QueueEntry,
  QueueSnapshot,
} from "./admission.js";
export { decideProxy, matchProjectByDir, renderProjectList, proxyHttp, proxyUpgrade, handleProxyRequest, handleProxyUpgrade } from "./proxy.js";
export type { ProxyDecision } from "./proxy.js";
