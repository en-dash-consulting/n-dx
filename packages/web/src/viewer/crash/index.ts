/**
 * Crash recovery zone public interface.
 *
 * All cross-zone consumers should import from this barrel rather than
 * the crash-detector implementation file directly.
 */

export {
  detectCrash,
  saveNavigationState,
  clearSavedNavigationState,
  markRecoveryShown,
  wasRecoveryShown,
  getDetectionResult,
  clearCrashHistory,
  resetCrashDetector,
  type CrashDetectionResult,
  type SavedNavigationState,
} from "./crash-detector.js";
