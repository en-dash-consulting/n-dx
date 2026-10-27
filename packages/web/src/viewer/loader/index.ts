/**
 * Loader zone public interface.
 *
 * All cross-zone consumers should import from this barrel rather than
 * individual implementation files.
 */

export {
  getData,
  onDataChange,
  clearOnChange,
  loadModules,
  loadFromFiles,
  detectMode,
  probeServer,
  classifyProbeStatus,
  SERVER_PROBE_DELAYS_MS,
  startPolling,
  stopPolling,
} from "./data-loader.js";
export type { ServerProbe, ServerProbeOptions } from "./data-loader.js";
