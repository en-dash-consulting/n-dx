/**
 * The code half: sourcevision's zones, crossings and components, read off
 * disk against the schema types sourcevision publishes. Absent output is not
 * an error: a project that has not been analysed projects its requirements
 * and runs with no code behind them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_FILES, type Components, type Inventory, type Zone, type Zones } from "../sourcevision-gateway.js";
import type { SnapshotEdge, SnapshotNode, SourceSlice, Warn } from "../types.js";

export interface CodeSlice extends SourceSlice {
  /** A repository-relative file's deepest zone, for `computeRealizedBy`. */
  zoneOf: (file: string) => string | undefined;
  /** Whether any sourcevision output was found. */
  analysed: boolean;
}

export interface ReadCodeOptions {
  /** Project every file in the inventory as a node. Off by default. */
  files?: boolean;
}

export const COMPONENT_PREFIX = "component:";
export const FILE_PREFIX = "file:";

function readJson<T>(path: string, warn: Warn): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    warn(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
}

export function readCode(sourcevisionDir: string, options: ReadCodeOptions, warn: Warn): CodeSlice {
  const nodes: SnapshotNode[] = [];
  const edges: SnapshotEdge[] = [];
  const fileZone = new Map<string, string>();
  const zoneIds = new Set<string>();

  const zones = readJson<Zones>(join(sourcevisionDir, DATA_FILES.zones), warn);
  const components = readJson<Components>(join(sourcevisionDir, DATA_FILES.components), warn);
  const inventory = options.files ? readJson<Inventory>(join(sourcevisionDir, DATA_FILES.inventory), warn) : undefined;

  const walkZones = (list: readonly Zone[], parent?: Zone, depth = 0): void => {
    for (const zone of list) {
      if (zoneIds.has(zone.id)) continue;
      zoneIds.add(zone.id);
      nodes.push({
        id: zone.id,
        kind: "zone",
        name: zone.name,
        description: zone.description || undefined,
        cohesion: zone.cohesion,
        coupling: zone.coupling,
        fileCount: zone.files.length,
        depth: zone.depth ?? depth,
        entryPoints: zone.entryPoints.length > 0 ? [...zone.entryPoints].sort() : undefined,
      });
      if (parent) edges.push({ kind: "under", from: zone.id, to: parent.id });
      // Parents first, children after: the deepest zone a file is listed in wins.
      for (const file of zone.files) fileZone.set(file, zone.id);
      walkZones(zone.subZones ?? [], zone, depth + 1);
    }
  };

  if (zones) {
    walkZones(zones.zones);
    const seen = new Set<string>();
    const crossings = [...zones.crossings, ...zones.zones.flatMap((z) => z.subCrossings ?? [])];
    for (const crossing of crossings) {
      if (crossing.fromZone === crossing.toZone) continue;
      const key = `${crossing.fromZone}\u0000${crossing.toZone}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ kind: "crosses", from: crossing.fromZone, to: crossing.toZone });
    }
  }

  if (components) {
    for (const component of components.components) {
      const id = `${COMPONENT_PREFIX}${component.file}#${component.name}`;
      nodes.push({
        id,
        kind: "component",
        name: component.name,
        file: component.file,
        role: component.kind,
        line: component.line,
      });
      const zone = fileZone.get(component.file);
      if (zone) edges.push({ kind: "inZone", from: id, to: zone });
    }
  }

  if (inventory) {
    for (const file of inventory.files) {
      const id = `${FILE_PREFIX}${file.path}`;
      nodes.push({
        id,
        kind: "file",
        path: file.path,
        language: file.language,
        role: file.role,
        lineCount: file.lineCount,
      });
      const zone = fileZone.get(file.path);
      if (zone) edges.push({ kind: "inZone", from: id, to: zone });
    }
  }

  return {
    nodes,
    edges,
    analysed: zones !== undefined,
    zoneOf: (file) => fileZone.get(file),
  };
}
