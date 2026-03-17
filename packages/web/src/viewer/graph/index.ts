/**
 * Graph zone public interface.
 *
 * All cross-zone consumers should import from this barrel rather than
 * individual implementation files. Type-only imports are excluded per
 * the gateway pattern (erased at compile time, stay at call-site).
 */

// ── Physics engine ───────────────────────────────────────────────────────────

export {
  computeForceParams,
  hashPosition,
  initZoneClusteredPositions,
  computeZoneCentroids,
  applyZoneCentroidRepulsion,
  buildQuadTree,
  bhRepulsion,
  tick,
  type PhysicsNode,
  type PhysicsLink,
  type QTNode,
  type SimState,
  type TickCallbacks,
} from "./physics.js";

// ── Graph renderer ───────────────────────────────────────────────────────────

export {
  GraphRenderer,
  type GraphNode,
  type GraphLink,
  type ZoneInfo,
  type GraphRendererOptions,
} from "./renderer.js";
