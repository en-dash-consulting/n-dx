/**
 * Viewer inbound API barrel — the sanctioned import surface for
 * sibling zones (crash, route, performance, usage) that consume
 * viewer-internal symbols.
 *
 * This is the inbound counterpart to external.ts (which concentrates
 * viewer's outbound imports from schema/, shared/, and messaging/).
 *
 * Rules:
 *   - Re-export only — no logic in this file
 *   - Any symbol consumed by a file outside the web-viewer zone
 *     should be re-exported here
 *   - Sibling zones should import from "./api.js" rather than
 *     reaching into types.js, route-state.js, or hooks/ directly
 */

// --- Types (from types.ts) ---
export type {
  LoadedData,
  NavigateTo,
  FileDetail,
  ZoneDetail,
  GenericDetail,
  PRDDetail,
  DetailItem,
} from "./types.js";

// ViewId is re-exported through types.ts from the shared layer
export type { ViewId } from "./types.js";

// --- Route state (from route-state.ts) ---
export type { ParsedRoute } from "./route-state.js";
export {
  parseLegacyHashRoute,
  parsePathnameRoute,
  resolveLocationRoute,
} from "./route-state.js";
