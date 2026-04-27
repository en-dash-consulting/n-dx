/**
 * Pure helpers for the Import Graph view — indexing, neighborhood expansion,
 * and default focus selection. Kept framework-free for unit testing.
 */

import type { Imports, Inventory, Zones, ImportEdge, ImportType, ExternalImport } from "../../external.js";

const ALL_IMPORT_TYPES: readonly ImportType[] = [
  "static",
  "dynamic",
  "require",
  "reexport",
  "type",
];

/** Files that participate in at least one circular dependency cycle. */
export function filesInCycles(imports: Imports): Set<string> {
  const set = new Set<string>();
  for (const c of imports.summary.circulars ?? []) {
    for (const p of c.cycle) set.add(p);
  }
  return set;
}

/**
 * Default focus file: first hub from mostImported, else first file in first cycle,
 * else first path appearing in edges.
 */
export function defaultFocusPath(imports: Imports): string | null {
  const hubs = imports.summary.mostImported;
  if (hubs && hubs.length > 0) return hubs[0].path;
  const cycles = imports.summary.circulars;
  if (cycles && cycles.length > 0 && cycles[0].cycle.length > 0) {
    return cycles[0].cycle[0];
  }
  if (imports.edges.length > 0) return imports.edges[0].from;
  return null;
}

/** All file paths that appear in import edges, optionally union inventory paths. */
export function collectFilePaths(imports: Imports, inventory: Inventory | null): string[] {
  const s = new Set<string>();
  for (const e of imports.edges) {
    s.add(e.from);
    s.add(e.to);
  }
  if (inventory) {
    for (const f of inventory.files) s.add(f.path);
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

export function fileToZoneId(path: string, zones: Zones | null): string | undefined {
  if (!zones) return undefined;
  for (const z of zones.zones) {
    if (z.files.includes(path)) return z.id;
  }
  return undefined;
}

export function isCrossZoneEdge(
  from: string,
  to: string,
  zones: Zones | null,
): boolean {
  const a = fileToZoneId(from, zones);
  const b = fileToZoneId(to, zones);
  if (a === undefined || b === undefined) return false;
  return a !== b;
}

export interface SubgraphFilter {
  /** null or empty = all types */
  importTypes: ReadonlySet<ImportType> | null;
  crossZoneOnly: boolean;
  cyclesOnly: boolean;
  zones: Zones | null;
}

/**
 * Expand an undirected neighborhood around center up to `depth` edge hops
 * (depth 0 = center only).
 */
export function expandNeighborhood(center: string, imports: Imports, depth: number): Set<string> {
  const nodes = new Set<string>([center]);
  let frontier = new Set<string>([center]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const n of frontier) {
      for (const e of imports.edges) {
        if (e.from === n && !nodes.has(e.to)) {
          nodes.add(e.to);
          next.add(e.to);
        }
        if (e.to === n && !nodes.has(e.from)) {
          nodes.add(e.from);
          next.add(e.from);
        }
      }
    }
    frontier = next;
  }
  return nodes;
}

function edgePassesType(e: ImportEdge, types: ReadonlySet<ImportType> | null): boolean {
  if (!types || types.size === 0) return true;
  return types.has(e.type);
}

/**
 * Internal import edges to render: both endpoints in `ball`, after filters.
 */
export function filterEdgesInBall(
  ball: Set<string>,
  imports: Imports,
  filter: SubgraphFilter,
): ImportEdge[] {
  const cycleFiles = filesInCycles(imports);
  const types = filter.importTypes;
  const out: ImportEdge[] = [];
  for (const e of imports.edges) {
    if (!ball.has(e.from) || !ball.has(e.to)) continue;
    if (!edgePassesType(e, types)) continue;
    if (filter.crossZoneOnly && !isCrossZoneEdge(e.from, e.to, filter.zones)) continue;
    if (filter.cyclesOnly && (!cycleFiles.has(e.from) || !cycleFiles.has(e.to))) continue;
    out.push(e);
  }
  return out;
}

/** Predecessors and successors of center within ball (for layout columns). */
export function partitionNeighbors(
  center: string,
  ball: Set<string>,
  edges: ImportEdge[],
): { predecessors: string[]; successors: string[] } {
  const pred = new Set<string>();
  const succ = new Set<string>();
  for (const e of edges) {
    if (e.to === center && ball.has(e.from)) pred.add(e.from);
    if (e.from === center && ball.has(e.to)) succ.add(e.to);
  }
  return {
    predecessors: [...pred].sort((a, b) => a.localeCompare(b)),
    successors: [...succ].sort((a, b) => a.localeCompare(b)),
  };
}

export function findExternal(imports: Imports, packageName: string): ExternalImport | undefined {
  return imports.external.find((x) => x.package === packageName);
}

export function allImportTypes(): readonly ImportType[] {
  return ALL_IMPORT_TYPES;
}

/** Count internal import edges per file (outgoing from / incoming to). */
export function buildFileDegrees(imports: Imports): {
  inDegree: Map<string, number>;
  outDegree: Map<string, number>;
} {
  const inDegree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  const bump = (m: Map<string, number>, k: string) => {
    m.set(k, (m.get(k) ?? 0) + 1);
  };
  for (const e of imports.edges) {
    bump(outDegree, e.from);
    bump(inDegree, e.to);
  }
  return { inDegree, outDegree };
}

export interface DirectedZoneFlow {
  fromZone: string;
  toZone: string;
  count: number;
}

/** Aggregated cross-zone internal imports (directed: importer zone → imported zone). */
export function aggregateDirectedZoneFlows(imports: Imports, zones: Zones | null): DirectedZoneFlow[] {
  if (!zones) return [];
  const tally = new Map<string, number>();
  for (const e of imports.edges) {
    if (!isCrossZoneEdge(e.from, e.to, zones)) continue;
    const a = fileToZoneId(e.from, zones);
    const b = fileToZoneId(e.to, zones);
    if (a === undefined || b === undefined) continue;
    const key = `${a}\t${b}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  const out: DirectedZoneFlow[] = [];
  for (const [key, count] of tally) {
    const [fromZone, toZone] = key.split("\t");
    if (fromZone && toZone) out.push({ fromZone, toZone, count });
  }
  out.sort((x, y) => y.count - x.count);
  return out;
}

export function zoneDisplayName(zones: Zones, zoneId: string): string {
  return zones.zones.find((z) => z.id === zoneId)?.name ?? zoneId;
}

/**
 * Best file to focus for a zone: highest hub in zone, else first file path in zone.
 */
export function defaultFocusPathInZone(imports: Imports, zoneId: string, zones: Zones): string | null {
  const z = zones.zones.find((zz) => zz.id === zoneId);
  if (!z) return null;
  const inZone = new Set(z.files);
  for (const hub of imports.summary.mostImported ?? []) {
    if (inZone.has(hub.path)) return hub.path;
  }
  const sorted = [...z.files].sort((a, b) => a.localeCompare(b));
  return sorted[0] ?? null;
}

/** Restrict ball to files in `zoneId`, always keeping `center`. */
export function restrictBallToZone(
  ball: Set<string>,
  center: string,
  zoneId: string | null,
  zones: Zones | null,
): Set<string> {
  if (!zoneId || !zones) return ball;
  const z = zones.zones.find((zz) => zz.id === zoneId);
  if (!z) return ball;
  const allow = new Set(z.files);
  const next = new Set<string>([center]);
  for (const x of ball) {
    if (allow.has(x)) next.add(x);
  }
  return next;
}
