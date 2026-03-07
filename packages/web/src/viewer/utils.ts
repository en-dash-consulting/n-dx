/**
 * Shared viewer utilities — path display helpers.
 *
 * Color, metric, and flow-diagram utilities have been extracted to the
 * `visualization/` layer (colors.ts, metrics.ts, flow.ts) to reduce this
 * module's hub status and consolidate visualization concerns.
 *
 * Re-exports are provided below for backward compatibility so existing
 * consumers don't break.  New code should import from `visualization/`
 * directly.
 */

// ── Path display helpers (owned here) ───────────────────────────────

/** Extract the filename from a path (last segment after '/'). */
export function basename(path: string): string {
  return path.split("/").pop() || path;
}

/**
 * Truncate a filename for graph labels, preserving extension and meaningful prefix.
 * Returns a shortened name with ellipsis when the name exceeds maxLen characters.
 *
 * Examples:
 *   truncateFilename("very-long-component-name.tsx", 16) → "very-long…e.tsx"
 *   truncateFilename("short.ts", 16) → "short.ts"
 */
export function truncateFilename(name: string, maxLen: number = 18): string {
  if (name.length <= maxLen) return name;

  const dotIdx = name.lastIndexOf(".");
  if (dotIdx <= 0) {
    // No extension — simple truncation
    return name.slice(0, maxLen - 1) + "…";
  }

  const ext = name.slice(dotIdx); // e.g. ".tsx"
  // Keep at least 4 chars of the stem visible + ellipsis + extension
  const stemBudget = maxLen - ext.length - 1; // -1 for the "…"
  if (stemBudget < 4) {
    // Extension too long relative to budget — just truncate the whole thing
    return name.slice(0, maxLen - 1) + "…";
  }

  const stem = name.slice(0, dotIdx);
  return stem.slice(0, stemBudget) + "…" + ext;
}

// ── Backward-compatible re-exports from visualization layer ─────────
// New code should import from `visualization/` directly.
export {
  getZoneColorByIndex,
  getZoneColor,
  buildZoneColorMap,
} from "./visualization/colors.js";

export { meterClass } from "./visualization/metrics.js";

export {
  buildFileToZoneMap,
  buildFlowEdges,
  buildCallFlowEdges,
  buildExternalImportEdges,
  buildFlowNodes,
} from "./visualization/flow.js";
