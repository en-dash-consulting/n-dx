/**
 * Shared viewer utilities.
 *
 * All new UI helpers should be added here rather than inlined in individual
 * view/component files. This consolidation reduces sub-zone fragmentation
 * by keeping cross-cutting logic in one place.
 *
 * Key patterns consolidated here:
 *  - Zone color lookup (getZoneColor, getZoneColorByIndex, buildZoneColorMap)
 *  - File-to-zone mapping (buildFileToZoneMap)
 *  - Metric classification (meterClass)
 *  - Flow diagram data (buildFlowNodes, buildFlowEdges)
 *  - Path display (basename)
 */
import type { Zones, CallEdge, ExternalImport } from "../schema/v1.js";
import { ZONE_COLORS } from "./components/constants.js";

/** Get the zone color by array index (wraps around). */
export function getZoneColorByIndex(index: number): string {
  return ZONE_COLORS[index % ZONE_COLORS.length];
}

/** Get the display color for a zone by its index in the zones array. */
export function getZoneColor(zones: Zones, zoneId: string): string {
  const idx = zones.zones.findIndex((z) => z.id === zoneId);
  return idx >= 0 ? getZoneColorByIndex(idx) : "#555";
}

/** Build a map from zone id to its display color. */
export function buildZoneColorMap(
  zones: Zones | null
): Map<string, string> {
  const map = new Map<string, string>();
  if (zones) {
    zones.zones.forEach((z, i) => {
      map.set(z.id, getZoneColorByIndex(i));
    });
  }
  return map;
}

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

/** Build a map from file path to zone info (id, name, color). */
export function buildFileToZoneMap(
  zones: Zones | null
): Map<string, { id: string; name: string; color: string }> {
  const map = new Map<string, { id: string; name: string; color: string }>();
  if (zones) {
    zones.zones.forEach((z, i) => {
      const color = getZoneColorByIndex(i);
      for (const f of z.files) {
        map.set(f, { id: z.id, name: z.name, color });
      }
    });
  }
  return map;
}

/** Classify a 0–1 metric value as good/mid/bad for meter display. */
export function meterClass(value: number, invert: boolean = false): string {
  const v = invert ? 1 - value : value;
  if (v >= 0.7) return "good";
  if (v >= 0.4) return "mid";
  return "bad";
}

/** Build aggregated flow edges from zone crossings for FlowDiagram. */
export function buildFlowEdges(
  crossings: Zones["crossings"]
): Array<{ from: string; to: string; weight: number }> {
  const pairCounts = new Map<string, number>();
  for (const c of crossings) {
    const key = `${c.fromZone}->${c.toZone}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  return [...pairCounts.entries()].map(([key, weight]) => {
    const [from, to] = key.split("->");
    return { from, to, weight };
  });
}

/** Build aggregated flow edges from call graph edges for FlowDiagram. */
export function buildCallFlowEdges(
  edges: CallEdge[],
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
): Array<{ from: string; to: string; weight: number }> {
  const pairCounts = new Map<string, number>();
  for (const e of edges) {
    if (!e.calleeFile) continue;
    const fromZone = fileToZoneMap.get(e.callerFile);
    const toZone = fileToZoneMap.get(e.calleeFile);
    if (!fromZone || !toZone || fromZone.id === toZone.id) continue;
    const key = `${fromZone.id}->${toZone.id}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }
  return [...pairCounts.entries()].map(([key, weight]) => {
    const [from, to] = key.split("->");
    return { from, to, weight };
  });
}

/**
 * Build cross-zone edges from external package imports.
 *
 * Static call analysis can't resolve cross-package function calls — they appear
 * as external imports (e.g. `import { ... } from "rex"`). This function maps
 * those external package names back to zones and creates weighted edges so the
 * call graph diagram shows inter-package traffic.
 */
export function buildExternalImportEdges(
  external: ExternalImport[],
  fileToZoneMap: Map<string, { id: string; name: string; color: string }>,
  zones: Zones,
): Array<{ from: string; to: string; weight: number }> {
  // Map package names to zone IDs by finding which zone owns files in that package dir.
  // E.g. "rex" → packages/rex/ → zone whose files start with packages/rex/src/
  // "@n-dx/llm-client" → packages/claude-client/ → claude-client zone
  const pkgToZone = new Map<string, string>();

  // Build directory prefix → zone mapping from zone file lists.
  // A package may span multiple zones (e.g. sourcevision has "cli" and "tests" zones).
  // We prefer the zone whose files include the package's src/ directory (not tests/).
  const dirToZone = new Map<string, { zoneId: string; hasSrc: boolean }>();
  for (const z of zones.zones) {
    for (const f of z.files) {
      const parts = f.split("/");
      if (parts.length >= 2 && parts[0] === "packages") {
        const dir = `packages/${parts[1]}`;
        const isSrc = f.includes("/src/");
        const existing = dirToZone.get(dir);
        if (!existing || (isSrc && !existing.hasSrc)) {
          dirToZone.set(dir, { zoneId: z.id, hasSrc: isSrc });
        }
      }
    }
  }

  // Known package name → directory mappings for this monorepo
  for (const ext of external) {
    const pkg = ext.package;
    if (pkgToZone.has(pkg)) continue;

    // Try scoped packages: @n-dx/foo → packages/foo
    if (pkg.startsWith("@n-dx/")) {
      const name = pkg.slice(6); // "claude-client", "web"
      const entry = dirToZone.get(`packages/${name}`);
      if (entry) { pkgToZone.set(pkg, entry.zoneId); continue; }
    }

    // Try unscoped: rex → packages/rex, hench → packages/hench, sourcevision → packages/sourcevision
    const entry = dirToZone.get(`packages/${pkg}`);
    if (entry) { pkgToZone.set(pkg, entry.zoneId); continue; }
  }

  // Build cross-zone edges: for each external import, map importedBy files to their zones
  const pairCounts = new Map<string, number>();

  for (const ext of external) {
    const targetZone = pkgToZone.get(ext.package);
    if (!targetZone) continue;

    for (const file of ext.importedBy) {
      const fromZoneInfo = fileToZoneMap.get(file);
      if (!fromZoneInfo || fromZoneInfo.id === targetZone) continue;
      const key = `${fromZoneInfo.id}->${targetZone}`;
      pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
    }
  }

  return [...pairCounts.entries()].map(([key, weight]) => {
    const [from, to] = key.split("->");
    return { from, to, weight };
  });
}

/** Build flow nodes for FlowDiagram from zones. */
export function buildFlowNodes(
  zones: Zones
): Array<{ id: string; label: string; color: string }> {
  return zones.zones.map((z, i) => ({
    id: z.id,
    label: z.name,
    color: getZoneColorByIndex(i),
  }));
}
