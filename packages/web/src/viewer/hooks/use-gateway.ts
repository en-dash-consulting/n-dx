/**
 * Hook zone gateway.
 *
 * Concentrates hook-layer imports into polling, messaging, and performance
 * so hook modules depend on a single local seam instead of multiple zones.
 */

export {
  registerPoller,
  unregisterPoller,
} from "../polling/index.js";

export {
  createWSPipeline,
} from "../messaging/index.js";

export {
  isFeatureDisabled,
  onDegradationChange,
  type DegradationState,
} from "../performance/index.js";
