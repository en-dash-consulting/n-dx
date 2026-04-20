export {
  registerPollingSource,
  unregisterPollingSource,
  suspendAllSources,
  resumeAllSources,
  disposeAllSources,
  onPollingStateChange,
  getPollingState,
  resetPollingState,
  isGlobalSuspended,
  getGeneration,
  isGenerationCurrent,
  type PollingSourceCallbacks,
  type PollingSourceConfig,
  type PollingSourceInfo,
  type PollingSourceStatus,
  type PollingStateSnapshot,
  type PollingStateChangeHandler,
} from "./polling-state.js";

export {
  startPollingRestart,
  stopPollingRestart,
  type PollingRestartOptions,
} from "./polling-restart.js";

export {
  usePollingSuspension,
  type UsePollingSuspensionResult,
} from "./use-polling-suspension.js";
