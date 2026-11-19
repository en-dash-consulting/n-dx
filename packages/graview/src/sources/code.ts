/**
 * The code half: sourcevision's zones, crossings and components, read off
 * disk against the schema types sourcevision publishes. Absent output is not
 * an error: a project that has not been analysed projects its requirements
 * and runs with no code behind them.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_FILES, deriveNextSteps, type Components, type Inventory, type NextStep, type Zone, type Zones } from "../sourcevision-gateway.js";
import { errorMessage } from "../error-message.js";
import type { SnapshotEdge, SnapshotNode, SourceSlice, Warn } from "../types.js";

export interface CodeSlice extends SourceSlice {
  /** A repository-relative file's deepest zone, for `computeRealizedBy`. */
  zoneOf: (file: string) => string | undefined;
  /** Whether any sourcevision output was found. */
  analysed: boolean;
}

export interface ReadCodeOptions {
  /** Project every file in the inventory as a node. */
  files?: boolean;
}

export const COMPONENT_PREFIX = "component:";
export const FILE_PREFIX = "file:";

/**
 * How many next steps the Analysis page recommends: its "Next steps" tile
 * lists the first five sourcevision derives (`/api/sv/next-steps?limit=5`,
 * the UI twin of the MCP `get_next_steps`). A zone one of them is scoped to
 * needs work.
 */
export const RECOMMENDED_STEPS = 5;

/**
 * The Analysis page's other highlight, its "Zones needing attention" count
 * (web's `zoneNeedsAttention`): a zone whose files barely hold together, or
 * that leans hard on other zones.
 */
export const ATTENTION_COHESION = 0.4;
export const ATTENTION_COUPLING = 0.5;

export function needsAttention(zone: Pick<Zone, "cohesion" | "coupling">): boolean {
  return zone.cohesion < ATTENTION_COHESION || zone.coupling > ATTENTION_COUPLING;
}

/**
 * The zones the Analysis page recommends working on, each with the title of
 * the first recommended step that names it: the scopes of sourcevision's top
 * next steps. A step scoped `global` names no zone, so it marks nothing.
 */
export function recommendedZones(zones: Zones, warn: Warn): Map<string, string> {
  const recommended = new Map<string, string>();
  let steps: NextStep[];
  try {
    steps = deriveNextSteps(zones);
  } catch (error) {
    warn(`Could not derive sourcevision's next steps: ${errorMessage(error)}`);
    return recommended;
  }
  for (const step of steps.slice(0, RECOMMENDED_STEPS)) {
    if (!recommended.has(step.scope)) recommended.set(step.scope, step.title);
  }
  return recommended;
}

function readJson<T>(path: string, warn: Warn): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (error) {
    warn(`Could not read ${path}: ${errorMessage(error)}`);
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

  const recommended = zones ? recommendedZones(zones, warn) : new Map<string, string>();

  const walkZones = (list: readonly Zone[], parent?: Zone, depth = 0): void => {
    for (const zone of list) {
      if (zoneIds.has(zone.id)) continue;
      zoneIds.add(zone.id);
      const needsWork = recommended.has(zone.id);
      nodes.push({
        id: zone.id,
        kind: "zone",
        name: zone.name,
        description: zone.description || undefined,
        cohesion: zone.cohesion,
        coupling: zone.coupling,
        fileCount: zone.files.length,
        depth: zone.depth ?? depth,
        // Sorted, so past Graview's 200 (the snapshot builder cuts to its caps) the first in path order stay.
        entryPoints: zone.entryPoints.length > 0 ? [...zone.entryPoints].sort() : undefined,
        // The Analysis page's two treatments: recommended work, else flagged for attention.
        needsWork,
        highlighted: !needsWork && needsAttention(zone),
        recommendation: recommended.get(zone.id),
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
