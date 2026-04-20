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
  startPolling,
  stopPolling,
} from "./data-loader.js";
