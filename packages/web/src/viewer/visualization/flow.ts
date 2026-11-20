/**
 * Flow-diagram data builders — transform zone/call/external-import data
 * into { from, to, weight } edge arrays and { id, label, color } node arrays
 * consumed by FlowDiagram and similar visualization components.
 *
 * Extracted from utils.ts to consolidate all flow-related logic in the
 * visualization layer and reduce the hub status of the old utils module.
 */
import type { Zones, CallEdge, ExternalImport } from "../external.js";
import { getZoneColorByIndex } from "./colors.js";

/** The zone a file belongs to, as the flow diagram names and colours it. */
type FileZone = { id: string; name: string; color: string };

/** A zone-to-zone edge weighted by how many crossings it stands for. */
type WeightedEdge = { from: string; to: string; weight: number };

/** Count one more `from → to` crossing in `pairCounts`. */
function countPair(pairCounts: Map<string, number>, from: string, to: string): void {
  const key = `${from}->${to}`;
  pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
}

/** The counted pairs as edges, in the order each pair was first counted. */
function pairEdges(pairCounts: Map<string, number>): WeightedEdge[] {
  return [...pairCounts.entries()].map(([key, weight]) => {
    const [from, to] = key.split("->");
    return { from, to, weight };
  });
}

/** Build a map from file path to zone info (id, name, color). */
export function buildFileToZoneMap(
  zones: Zones | null,
): Map<string, FileZone> {
  const map = new Map<string, FileZone>();
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

/** Build aggregated flow edges from zone crossings for FlowDiagram. */
export function buildFlowEdges(
  crossings: Zones["crossings"],
): WeightedEdge[] {
  const pairCounts = new Map<string, number>();
  for (const c of crossings) {
    countPair(pairCounts, c.fromZone, c.toZone);
  }
  return pairEdges(pairCounts);
}

/** Build aggregated flow edges from call graph edges for FlowDiagram. */
export function buildCallFlowEdges(
  edges: CallEdge[],
  fileToZoneMap: Map<string, FileZone>,
): WeightedEdge[] {
  const pairCounts = new Map<string, number>();
  for (const e of edges) {
    if (!e.calleeFile) continue;
    const fromZone = fileToZoneMap.get(e.callerFile);
    const toZone = fileToZoneMap.get(e.calleeFile);
    if (!fromZone || !toZone || fromZone.id === toZone.id) continue;
    countPair(pairCounts, fromZone.id, toZone.id);
  }
  return pairEdges(pairCounts);
}

/**
 * Map the packages `external` imports to the zones that own them, by finding
 * which zone owns files in each package's directory. E.g. "rex" →
 * packages/rex/ → the zone whose files start with packages/rex/src/;
 * "@n-dx/llm-client" → packages/llm-client/ → that package's zone. A package
 * with no files in any zone is left out.
 */
export function mapPackagesToZones(external: ExternalImport[], zones: Zones): Map<string, string> {
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
      const name = pkg.slice(6); // "llm-client", "web"
      const entry = dirToZone.get(`packages/${name}`);
      if (entry) { pkgToZone.set(pkg, entry.zoneId); continue; }
    }

    // Try unscoped: rex → packages/rex, hench → packages/hench, sourcevision → packages/sourcevision
    const entry = dirToZone.get(`packages/${pkg}`);
    if (entry) { pkgToZone.set(pkg, entry.zoneId); continue; }
  }

  return pkgToZone;
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
  fileToZoneMap: Map<string, FileZone>,
  zones: Zones,
): WeightedEdge[] {
  const pkgToZone = mapPackagesToZones(external, zones);

  // Build cross-zone edges: for each external import, map importedBy files to their zones
  const pairCounts = new Map<string, number>();

  for (const ext of external) {
    const targetZone = pkgToZone.get(ext.package);
    if (!targetZone) continue;

    for (const file of ext.importedBy) {
      const fromZoneInfo = fileToZoneMap.get(file);
      if (!fromZoneInfo || fromZoneInfo.id === targetZone) continue;
      countPair(pairCounts, fromZoneInfo.id, targetZone);
    }
  }

  return pairEdges(pairCounts);
}

/** Build flow nodes for FlowDiagram from zones. */
export function buildFlowNodes(
  zones: Zones,
): Array<{ id: string; label: string; color: string }> {
  return zones.zones.map((z, i) => ({
    id: z.id,
    label: z.name,
    color: getZoneColorByIndex(i),
  }));
}
