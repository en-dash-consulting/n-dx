/**
 * Canonical sorting for deterministic, git-friendly output.
 * All arrays are sorted by deterministic keys so re-runs produce stable diffs.
 */

import type {
  FileEntry,
  ImportEdge,
  ExternalImport,
  Zone,
  ZoneCrossing,
  Inventory,
  Imports,
  Zones,
  Finding,
  ComponentDefinition,
  ComponentUsageEdge,
  RouteModule,
  Components,
} from "../schema/index.js";

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortFiles(files: FileEntry[]): FileEntry[] {
  return [...files].sort((a, b) => cmp(a.path, b.path));
}

export function sortEdges(edges: ImportEdge[]): ImportEdge[] {
  return [...edges].sort(
    (a, b) => cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.type, b.type)
  );
}

export function sortExternals(externals: ExternalImport[]): ExternalImport[] {
  return externals
    .map((ext) => ({
      ...ext,
      importedBy: [...ext.importedBy].sort(cmp),
      symbols: [...ext.symbols].sort(cmp),
    }))
    .sort((a, b) => cmp(a.package, b.package));
}

export function sortZones(zones: Zone[]): Zone[] {
  return zones
    .map((z) => ({
      ...z,
      files: [...z.files].sort(cmp),
      entryPoints: [...z.entryPoints].sort(cmp),
      // insights: order is meaningful (structural first, then by pass) — don't sort
    }))
    .sort((a, b) => cmp(a.id, b.id));
}

export function sortCrossings(crossings: ZoneCrossing[]): ZoneCrossing[] {
  return [...crossings].sort(
    (a, b) =>
      cmp(a.fromZone, b.fromZone) ||
      cmp(a.toZone, b.toZone) ||
      cmp(a.from, b.from) ||
      cmp(a.to, b.to)
  );
}

/** Sort findings by pass, then type, then scope, then text */
export function sortFindings(findings: Finding[]): Finding[] {
  const typeOrder: Record<string, number> = {
    observation: 0,
    pattern: 1,
    relationship: 2,
    "anti-pattern": 3,
    suggestion: 4,
  };
  return [...findings].sort(
    (a, b) =>
      a.pass - b.pass ||
      (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99) ||
      cmp(a.scope, b.scope) ||
      cmp(a.text, b.text)
  );
}

/** Sort all arrays in an Inventory for canonical output */
export function sortInventory(inv: Inventory): Inventory {
  return {
    files: sortFiles(inv.files),
    summary: inv.summary,
  };
}

/** Sort all arrays in an Imports for canonical output */
export function sortImports(imp: Imports): Imports {
  return {
    edges: sortEdges(imp.edges),
    external: sortExternals(imp.external),
    summary: {
      ...imp.summary,
      circulars: imp.summary.circulars
        .map((c) => ({ cycle: [...c.cycle] }))
        .sort((a, b) => cmp(a.cycle.join(","), b.cycle.join(","))),
      mostImported: [...imp.summary.mostImported].sort(
        (a, b) => b.count - a.count || cmp(a.path, b.path)
      ),
    },
  };
}

/** Sort all arrays in a Zones for canonical output */
export function sortZonesData(zones: Zones): Zones {
  return {
    zones: sortZones(zones.zones),
    crossings: sortCrossings(zones.crossings),
    unzoned: [...zones.unzoned].sort(cmp),
    ...(zones.insights ? { insights: zones.insights } : {}),
    ...(zones.findings?.length ? { findings: sortFindings(zones.findings) } : {}),
    ...(zones.enrichmentPass != null ? { enrichmentPass: zones.enrichmentPass } : {}),
    ...(zones.metaEvaluationCount != null ? { metaEvaluationCount: zones.metaEvaluationCount } : {}),
    ...(zones.structureHash ? { structureHash: zones.structureHash } : {}),
    ...(zones.zoneContentHashes ? { zoneContentHashes: zones.zoneContentHashes } : {}),
  };
}

// ── Components sorting ──────────────────────────────────────────────────────

export function sortComponentDefinitions(
  components: ComponentDefinition[]
): ComponentDefinition[] {
  return [...components].sort(
    (a, b) => cmp(a.file, b.file) || cmp(a.name, b.name)
  );
}

export function sortUsageEdges(
  edges: ComponentUsageEdge[]
): ComponentUsageEdge[] {
  return [...edges].sort(
    (a, b) =>
      cmp(a.from, b.from) || cmp(a.to, b.to) || cmp(a.componentName, b.componentName)
  );
}

export function sortRouteModules(modules: RouteModule[]): RouteModule[] {
  return [...modules].sort((a, b) => cmp(a.file, b.file));
}

/** Sort all arrays in a Components for canonical output */
export function sortComponents(data: Components): Components {
  return {
    components: sortComponentDefinitions(data.components),
    usageEdges: sortUsageEdges(data.usageEdges),
    routeModules: sortRouteModules(data.routeModules),
    routeTree: data.routeTree,
    summary: data.summary,
  };
}

/** Serialize to pretty-printed, canonical JSON */
export function toCanonicalJSON(data: unknown): string {
  return JSON.stringify(data, null, 2) + "\n";
}
