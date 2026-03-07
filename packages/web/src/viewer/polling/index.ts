/**
 * Polling zone public interface.
 *
 * All cross-zone consumers should import from this barrel rather than
 * individual implementation files.
 */

export {
  registerPoller,
  unregisterPoller,
} from "./polling-manager.js";

export {
  registerTickUpdater,
} from "./batched-tick-dispatcher.js";

// ── Polling state — cross-zone API ───────────────────────────────────────────

export {
  registerPollingSource,
  onPollingStateChange,
  getPollingState,
  resetPollingState,
  type PollingSourceCallbacks,
  type PollingSourceConfig,
  type PollingStateSnapshot,
  type PollingStateChangeHandler,
} from "./polling-state.js";
