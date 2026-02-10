/**
 * Deterministic zone analyzer using Louvain community detection.
 *
 * Zones represent natural architectural boundaries discovered from the import
 * graph. Each zone has two key metrics:
 *
 * - **Cohesion** (0–1): ratio of internal edges to total edges from the zone.
 *   A value of 1.0 means all imports stay within the zone — perfect encapsulation.
 *
 * - **Coupling** (0–1): ratio of external edges to total edges. A value of 0.0
 *   means no imports cross the zone boundary — complete independence.
 *
 * These metrics validate architectural quality: well-structured packages with
 * clean abstractions naturally achieve high cohesion and low coupling, confirming
 * that the Louvain algorithm correctly identified the intended boundaries.
 *
 * @see {@link "./louvain.ts"} for the community detection algorithm
 * @see {@link generateStructuralInsights} for automated metric interpretation
 */

import { dirname } from "node:path";
import { createHash } from "node:crypto";
import type {
  Inventory,
  Imports,
  Zone,
  ZoneCrossing,
  Zones,
  Finding,
  AnalyzeTokenUsage,
  SubAnalysisRef,
} from "../schema/index.js";
import type { SubAnalysis } from "./workspace.js";
import {
  promoteZones,
  promoteCrossings,
  getSubAnalyzedPrefixes,
  isSubAnalyzedFile,
} from "./workspace.js";
import { sortZonesData } from "../util/sort.js";
import {
  buildUndirectedGraph,
  louvainPhase1,
  mergeBidirectionalCoupling,
  mergeSmallCommunities,
  capZoneCount,
} from "./louvain.js";
import { enrichZonesWithAI, enrichZonesPerZone } from "./enrich.js";
import type { EnrichResult, PerZoneEnrichResult } from "./enrich.js";
import { deduplicateFindings } from "./enrich-parsing.js";

/** Result from analyzeZones, including the zones data and optional token usage. */
export interface AnalyzeZonesResult {
  zones: Zones;
  tokenUsage?: AnalyzeTokenUsage;
}

// ── Zone ID / name derivation ───────────────────────────────────────────────

const GENERIC_SEGMENTS = new Set([
  "src",
  "lib",
  "app",
  "packages",
  "internal",
  "pkg",
]);

/**
 * Derive a zone ID from the most common directory segment among files.
 * Root-level files → "root".
 *
 * When `parentId` is provided (for sub-zone derivation), the parent's ID
 * segments are treated as generic and skipped, producing deeper, more
 * specific names (e.g., "agent" instead of "hench").
 */
export function deriveZoneId(files: string[], parentId?: string): string {
  // When deriving sub-zone IDs, treat parent's ID segments as generic
  const skip = parentId
    ? new Set([...GENERIC_SEGMENTS, ...parentId.split("/").map(s => s.toLowerCase())])
    : GENERIC_SEGMENTS;

  const segmentCounts = new Map<string, number>();

  for (const file of files) {
    const dir = dirname(file);
    if (dir === ".") {
      segmentCounts.set("root", (segmentCounts.get("root") ?? 0) + 1);
      continue;
    }

    const parts = dir.split("/");
    // Find first non-skip segment
    let found = false;
    for (const part of parts) {
      const normalized = part.toLowerCase().replace(/_/g, "-");
      if (!skip.has(part) && !skip.has(normalized)) {
        segmentCounts.set(
          normalized,
          (segmentCounts.get(normalized) ?? 0) + 1
        );
        found = true;
        break;
      }
    }
    // If all segments were skipped, use the last one
    if (!found && parts.length > 0) {
      const last = parts[parts.length - 1];
      const normalized = last.toLowerCase().replace(/_/g, "-");
      segmentCounts.set(normalized, (segmentCounts.get(normalized) ?? 0) + 1);
    }
  }

  if (segmentCounts.size === 0) return "root";

  // Most common segment, tie-break lexicographic
  let bestSegment = "root";
  let bestCount = 0;
  for (const [seg, count] of segmentCounts) {
    if (count > bestCount || (count === bestCount && seg < bestSegment)) {
      bestSegment = seg;
      bestCount = count;
    }
  }

  return bestSegment;
}

/**
 * Title-case a zone ID: "detail-panel" → "Detail Panel"
 */
export function deriveZoneName(id: string): string {
  return id
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Zone description from language stats ────────────────────────────────────

function describeZone(
  files: string[],
  inventory: Inventory
): string {
  const langCounts = new Map<string, number>();
  const fileSet = new Set(files);

  for (const entry of inventory.files) {
    if (fileSet.has(entry.path)) {
      langCounts.set(
        entry.language,
        (langCounts.get(entry.language) ?? 0) + 1
      );
    }
  }

  const sorted = [...langCounts.entries()].sort((a, b) => b[1] - a[1]);
  const topLangs = sorted.slice(0, 3).map(([lang]) => lang);
  const langStr =
    topLangs.length > 0 ? topLangs.join(", ") : "mixed";

  return `${files.length} files, primarily ${langStr}`;
}

// ── Directory proximity assignment ──────────────────────────────────────────

/**
 * Assign unzoned files to their nearest zone by directory proximity.
 * Walks up each file's directory tree until finding a directory containing
 * files from an existing zone.
 */
export function assignByProximity(
  zones: Zone[],
  unzonedFiles: string[]
): { zones: Zone[]; remaining: string[] } {
  if (unzonedFiles.length === 0 || zones.length === 0) {
    return { zones, remaining: unzonedFiles };
  }

  // Index: exact directory → zone ID → count of zone files in that directory
  const dirZones = new Map<string, Map<string, number>>();
  for (const zone of zones) {
    for (const file of zone.files) {
      const dir = dirname(file);
      let counts = dirZones.get(dir);
      if (!counts) {
        counts = new Map();
        dirZones.set(dir, counts);
      }
      counts.set(zone.id, (counts.get(zone.id) ?? 0) + 1);
    }
  }

  const assignments = new Map<string, string[]>(); // zoneId → files to add
  const remaining: string[] = [];

  for (const file of [...unzonedFiles].sort()) {
    let dir = dirname(file);
    let assigned = false;

    while (dir && dir !== ".") {
      const counts = dirZones.get(dir);
      if (counts && counts.size > 0) {
        // Pick zone with most files in this directory, tie-break by ID
        let bestZone = "";
        let bestCount = 0;
        for (const [zoneId, count] of counts) {
          if (count > bestCount || (count === bestCount && zoneId < bestZone)) {
            bestZone = zoneId;
            bestCount = count;
          }
        }

        let list = assignments.get(bestZone);
        if (!list) {
          list = [];
          assignments.set(bestZone, list);
        }
        list.push(file);
        assigned = true;
        break;
      }

      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    if (!assigned) {
      remaining.push(file);
    }
  }

  // Build expanded zones with proximity-assigned files appended
  const expandedZones = zones.map((zone) => {
    const extraFiles = assignments.get(zone.id);
    if (!extraFiles || extraFiles.length === 0) return zone;
    return { ...zone, files: [...zone.files, ...extraFiles] };
  });

  return { zones: expandedZones, remaining };
}

// ── Recursive subdivision ────────────────────────────────────────────────────

/** Zones with more than this many files are subdivided recursively. */
export const SUBDIVISION_THRESHOLD = 50;

/** Maximum recursion depth for subdivision to prevent infinite loops. */
export const MAX_SUBDIVISION_DEPTH = 3;

/**
 * Subdivide a large zone by running Louvain on its internal import graph.
 * Returns sub-zones with IDs prefixed by parent zone ID.
 */
export function subdivideZone(
  zone: Zone,
  imports: Imports,
  inventory: Inventory,
  depth: number = 0
): Zone[] {
  // Don't subdivide small zones or if we've hit max depth
  if (zone.files.length < SUBDIVISION_THRESHOLD || depth >= MAX_SUBDIVISION_DEPTH) {
    return [];
  }

  const fileSet = new Set(zone.files);

  // Extract edges internal to this zone
  const internalEdges = imports.edges.filter(
    (e) => fileSet.has(e.from) && fileSet.has(e.to)
  );

  // Need at least some edges to cluster
  if (internalEdges.length < 3) {
    return [];
  }

  // Build sub-graph and run Louvain
  const subGraph = buildUndirectedGraph(internalEdges);
  let community = louvainPhase1(subGraph);
  community = mergeBidirectionalCoupling(community, subGraph);
  community = mergeSmallCommunities(community, subGraph);
  // Cap at 8 sub-zones per parent
  community = capZoneCount(community, subGraph, 8);

  // Gather community → members
  const communityMembers = new Map<string, string[]>();
  for (const [node, comm] of community) {
    let list = communityMembers.get(comm);
    if (!list) {
      list = [];
      communityMembers.set(comm, list);
    }
    list.push(node);
  }

  // If Louvain found only 1 community, no meaningful subdivision
  if (communityMembers.size <= 1) {
    return [];
  }

  // Build sub-zones
  const usedIds = new Set<string>();
  const subZones: Zone[] = [];

  const sortedCommunities = [...communityMembers.entries()]
    .map(([comm, members]) => [comm, members.sort()] as const)
    .sort(([, a], [, b]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  for (const [, members] of sortedCommunities) {
    let subId = deriveZoneId(members, zone.id);
    if (usedIds.has(subId)) {
      let suffix = 2;
      while (usedIds.has(`${subId}-${suffix}`)) suffix++;
      subId = `${subId}-${suffix}`;
    }
    usedIds.add(subId);

    // Prefix with parent zone ID
    const fullId = `${zone.id}/${subId}`;

    // Entry points: files imported from outside this sub-zone (but within parent zone)
    const memberSet = new Set(members);
    const entryPoints: string[] = [];
    for (const edge of internalEdges) {
      if (memberSet.has(edge.to) && !memberSet.has(edge.from)) {
        if (!entryPoints.includes(edge.to)) {
          entryPoints.push(edge.to);
        }
      }
    }

    // Cohesion / coupling from sub-graph
    let internalEdgeCount = 0;
    let totalEdgesFromSubZone = 0;
    for (const node of members) {
      const neighbors = subGraph.get(node);
      if (!neighbors) continue;
      for (const [neighbor] of neighbors) {
        totalEdgesFromSubZone++;
        if (memberSet.has(neighbor)) internalEdgeCount++;
      }
    }
    const cohesion =
      totalEdgesFromSubZone > 0 ? internalEdgeCount / totalEdgesFromSubZone : 1;
    const coupling =
      totalEdgesFromSubZone > 0
        ? (totalEdgesFromSubZone - internalEdgeCount) / totalEdgesFromSubZone
        : 0;

    const subZone: Zone = {
      id: fullId,
      name: deriveZoneName(subId),
      description: describeZone(members, inventory),
      files: members,
      entryPoints,
      cohesion: Math.round(cohesion * 100) / 100,
      coupling: Math.round(coupling * 100) / 100,
      depth: (zone.depth ?? 0) + 1,
    };

    // Recursively subdivide if still large
    const nestedSubZones = subdivideZone(subZone, imports, inventory, depth + 1);
    if (nestedSubZones.length > 0) {
      subZone.subZones = nestedSubZones;
    }

    subZones.push(subZone);
  }

  return subZones;
}

// ── Structure hash ──────────────────────────────────────────────────────────

/**
 * Hash the structural zone groupings for change detection between runs.
 * Same codebase + same imports → same hash → safe to preserve previous insights.
 */
export function computeStructureHash(zones: Zone[]): string {
  const data = zones
    .map((z) => [...z.files].sort().join("\n"))
    .sort()
    .join("\0");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// ── Structural insights ─────────────────────────────────────────────────────

/**
 * Generate deterministic, actionable insights from graph metrics.
 *
 * Recomputed every run — same structure always produces the same insights.
 * These insights translate raw cohesion/coupling numbers into architectural
 * guidance:
 *
 * - **High cohesion** (≥0.8): files are tightly interconnected — good sign.
 *   Perfect cohesion (1.0) means the zone is fully self-contained.
 * - **Low cohesion** (<0.4): files are loosely related — consider splitting.
 * - **High coupling** (>0.5): heavy cross-zone imports — may need refactoring.
 * - **Size imbalance**: uneven zone sizes suggest decomposition issues.
 * - **Large zone with sub-zones**: zones exceeding 35% of project files that
 *   have been successfully subdivided get an informational insight rather than
 *   a "consider splitting" warning — the subdivision already addresses breadth.
 * - **Hub files**: files imported across 3+ zones are cross-cutting dependencies.
 * - **Bidirectional coupling**: zone pairs that import from each other.
 *
 * When all zones achieve perfect cohesion, it validates that the Louvain
 * community detection successfully identified the codebase's natural
 * architectural boundaries.
 */
export function generateStructuralInsights(
  zones: Zone[],
  crossings: ZoneCrossing[],
  imports: Imports,
  totalFiles: number
): { zoneInsights: Map<string, string[]>; globalInsights: string[] } {
  const zoneInsights = new Map<string, string[]>();
  const globalInsights: string[] = [];

  for (const zone of zones) {
    zoneInsights.set(zone.id, []);
  }

  // ── Per-zone insights ──

  for (const zone of zones) {
    const insights = zoneInsights.get(zone.id)!;
    const pct = totalFiles > 0
      ? Math.round((zone.files.length / totalFiles) * 100)
      : 0;

    if (zone.cohesion >= 0.8) {
      insights.push(
        `High cohesion (${zone.cohesion}) — files are tightly interconnected`
      );
    } else if (zone.cohesion < 0.4 && zone.files.length > 3) {
      insights.push(
        `Low cohesion (${zone.cohesion}) — files are loosely related, consider splitting this zone`
      );
    }

    if (zone.coupling > 0.5) {
      const targetCounts = new Map<string, number>();
      for (const c of crossings) {
        if (c.fromZone === zone.id) {
          targetCounts.set(c.toZone, (targetCounts.get(c.toZone) ?? 0) + 1);
        }
      }
      const sorted = [...targetCounts.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
      );
      if (sorted.length > 0) {
        insights.push(
          `High coupling (${zone.coupling}) — ${sorted[0][1]} imports target "${sorted[0][0]}"`
        );
      }
    }

    if (pct > 35) {
      if (zone.subZones && zone.subZones.length > 1) {
        insights.push(
          `Contains ${pct}% of project files (${zone.files.length}/${totalFiles}) — subdivided into ${zone.subZones.length} sub-zones`
        );
      } else {
        insights.push(
          `Contains ${pct}% of project files (${zone.files.length}/${totalFiles}) — may be too broad, consider splitting`
        );
      }
    }

    if (zone.entryPoints.length > 8) {
      insights.push(
        `${zone.entryPoints.length} entry points — wide API surface, consider consolidating exports`
      );
    }
  }

  // ── Global insights ──

  // Hub files: files imported across 3+ zones
  const fileImportingZones = new Map<string, Set<string>>();
  for (const c of crossings) {
    let set = fileImportingZones.get(c.to);
    if (!set) {
      set = new Set();
      fileImportingZones.set(c.to, set);
    }
    set.add(c.fromZone);
  }

  const hubFiles = [...fileImportingZones.entries()]
    .filter(([, s]) => s.size >= 3)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));

  for (const [file, importingZones] of hubFiles.slice(0, 3)) {
    globalInsights.push(
      `Hub: ${file} is imported by ${importingZones.size} zones — cross-cutting dependency`
    );
  }

  // Bidirectional coupling between zone pairs
  const pairCounts = new Map<string, { ab: number; ba: number }>();
  for (const c of crossings) {
    const key =
      c.fromZone < c.toZone
        ? `${c.fromZone}\0${c.toZone}`
        : `${c.toZone}\0${c.fromZone}`;
    let pair = pairCounts.get(key);
    if (!pair) {
      pair = { ab: 0, ba: 0 };
      pairCounts.set(key, pair);
    }
    if (c.fromZone < c.toZone) pair.ab++;
    else pair.ba++;
  }

  for (const [key, counts] of [...pairCounts.entries()].sort(
    (a, b) => b[1].ab + b[1].ba - (a[1].ab + a[1].ba)
  )) {
    if (counts.ab > 0 && counts.ba > 0) {
      const [a, b] = key.split("\0");
      globalInsights.push(
        `Bidirectional coupling: "${a}" \u2194 "${b}" (${counts.ab}+${counts.ba} crossings) — consider extracting shared interface`
      );
    }
  }

  // Zone size imbalance
  if (zones.length > 2) {
    const sizes = zones.map((z) => z.files.length).sort((a, b) => a - b);
    if (sizes[sizes.length - 1] > sizes[0] * 5) {
      globalInsights.push(
        `Size imbalance: largest zone has ${sizes[sizes.length - 1]} files vs smallest with ${sizes[0]} — uneven decomposition`
      );
    }
  }

  // Circular dependencies
  if (imports.summary.circularCount > 0) {
    globalInsights.push(
      `${imports.summary.circularCount} circular dependency chain${imports.summary.circularCount > 1 ? "s" : ""} detected — see imports.json for details`
    );
  }

  return { zoneInsights, globalInsights };
}

// ── Main entry point ────────────────────────────────────────────────────────

export async function analyzeZones(
  inventory: Inventory,
  imports: Imports,
  options?: {
    enrich?: boolean;
    previousZones?: Zones;
    perZone?: boolean;
    subAnalyses?: SubAnalysis[];
  }
): Promise<AnalyzeZonesResult> {
  const enrich = options?.enrich ?? true;
  const perZone = options?.perZone ?? false;
  const previousZones = options?.previousZones;
  const subAnalyses = options?.subAnalyses ?? [];

  // ── Exclude sub-analyzed files from Louvain ──
  // Files already grouped by sub-analyses shouldn't be re-analyzed at root level.
  // Use prefix matching (not explicit file lists) because sub-analyses may be stale.
  const subAnalyzedPrefixes = getSubAnalyzedPrefixes(subAnalyses);
  const filteredEdges = subAnalyzedPrefixes.length > 0
    ? imports.edges.filter(
        (e) =>
          !isSubAnalyzedFile(e.from, subAnalyzedPrefixes) &&
          !isSubAnalyzedFile(e.to, subAnalyzedPrefixes)
      )
    : imports.edges;

  const graph = buildUndirectedGraph(filteredEdges);

  // Build set of test files — test→source edges inflate coupling metrics,
  // so we exclude test files from cohesion/coupling metric computation
  // while keeping them as zone members.
  const testFiles = new Set<string>();
  for (const f of inventory.files) {
    if (f.role === "test") testFiles.add(f.path);
  }

  // Run Louvain
  let community = louvainPhase1(graph);
  community = mergeBidirectionalCoupling(community, graph);
  community = mergeSmallCommunities(community, graph);
  community = capZoneCount(community, graph, 15);

  // Merge communities that derive the same zone ID.
  // Prevents a single package from fragmenting into multiple root-level zones
  // (e.g., "hench", "hench-2", "hench-3"). After merging, the combined zone
  // may be subdivided into properly named sub-zones.
  {
    const tempMembers = new Map<string, string[]>();
    for (const [node, comm] of community) {
      let list = tempMembers.get(comm);
      if (!list) { list = []; tempMembers.set(comm, list); }
      list.push(node);
    }

    const idToCommunities = new Map<string, string[]>();
    for (const [comm, members] of tempMembers) {
      const id = deriveZoneId(members);
      let list = idToCommunities.get(id);
      if (!list) { list = []; idToCommunities.set(id, list); }
      list.push(comm);
    }

    for (const [, comms] of idToCommunities) {
      if (comms.length <= 1) continue;
      // Merge smaller communities into the largest one
      comms.sort((a, b) => {
        const sizeA = tempMembers.get(a)?.length ?? 0;
        const sizeB = tempMembers.get(b)?.length ?? 0;
        return sizeB - sizeA || a.localeCompare(b);
      });
      const target = comms[0];
      for (let i = 1; i < comms.length; i++) {
        for (const node of tempMembers.get(comms[i])!) {
          community.set(node, target);
        }
      }
    }
  }

  // Gather community → members
  const communityMembers = new Map<string, string[]>();
  for (const [node, comm] of community) {
    let list = communityMembers.get(comm);
    if (!list) {
      list = [];
      communityMembers.set(comm, list);
    }
    list.push(node);
  }

  // Build zones with algorithmic IDs
  const usedIds = new Set<string>();
  const zones: Zone[] = [];

  const sortedCommunities = [...communityMembers.entries()]
    .map(([comm, members]) => [comm, members.sort()] as const)
    .sort(([, a], [, b]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  for (const [, members] of sortedCommunities) {
    let id = deriveZoneId(members);
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);

    // Entry points: files imported from outside this zone
    const memberSet = new Set(members);
    const entryPoints: string[] = [];
    for (const edge of imports.edges) {
      if (memberSet.has(edge.to) && !memberSet.has(edge.from)) {
        if (!entryPoints.includes(edge.to)) {
          entryPoints.push(edge.to);
        }
      }
    }

    // Cohesion / coupling metrics from the import graph.
    //
    // Cohesion = internalEdges / totalEdges — measures how self-contained
    //   the zone is. 1.0 means every import stays within the zone.
    // Coupling = 1 - cohesion — measures external dependency. 0.0 means
    //   no imports cross the zone boundary.
    //
    // Test files are excluded: test→source edges represent test dependencies,
    // not architectural coupling, and would inflate coupling metrics.
    let internalEdges = 0;
    let totalEdgesFromZone = 0;
    for (const node of members) {
      if (testFiles.has(node)) continue;
      const neighbors = graph.get(node);
      if (!neighbors) continue;
      for (const [neighbor] of neighbors) {
        totalEdgesFromZone++;
        if (memberSet.has(neighbor)) internalEdges++;
      }
    }
    const cohesion =
      totalEdgesFromZone > 0 ? internalEdges / totalEdgesFromZone : 1;
    const coupling =
      totalEdgesFromZone > 0
        ? (totalEdgesFromZone - internalEdges) / totalEdgesFromZone
        : 0;

    const zone: Zone = {
      id,
      name: deriveZoneName(id),
      description: describeZone(members, inventory),
      files: members,
      entryPoints,
      cohesion: Math.round(cohesion * 100) / 100,
      coupling: Math.round(coupling * 100) / 100,
    };

    // Recursively subdivide large zones
    const subZones = subdivideZone(zone, imports, inventory);
    if (subZones.length > 0) {
      zone.subZones = subZones;
    }

    zones.push(zone);
  }

  // ── Assign unzoned files by directory proximity ──
  // Exclude both zoned files and sub-analyzed files (by prefix)

  const zonedFiles = new Set<string>();
  for (const zone of zones) {
    for (const f of zone.files) zonedFiles.add(f);
  }
  const initialUnzoned: string[] = [];
  for (const entry of inventory.files) {
    // Skip files that are in zones OR covered by sub-analyses
    if (
      !zonedFiles.has(entry.path) &&
      !isSubAnalyzedFile(entry.path, subAnalyzedPrefixes)
    ) {
      initialUnzoned.push(entry.path);
    }
  }

  const { zones: expandedZones, remaining: unzoned } = assignByProximity(
    zones,
    initialUnzoned
  );

  // ── Structure hash & change detection ──

  const structureHash = computeStructureHash(expandedZones);
  const structureChanged = previousZones?.structureHash !== structureHash;
  const validPrevious = structureChanged ? undefined : previousZones;

  // ── AI enrichment or preserve previous ──

  let finalZones = expandedZones;
  let aiZoneInsights = new Map<string, string[]>();
  let aiGlobalInsights: string[] = [];
  let aiFindings: Finding[] = [];
  let enrichmentPass = 0;
  let metaUpdatedFindings: Finding[] | null = null;
  let enrichTokenUsage: AnalyzeTokenUsage | undefined;

  if (enrich) {
    // Build pre-enrichment crossings for prompt context
    const preFileToZone = new Map<string, string>();
    for (const z of expandedZones) {
      for (const f of z.files) preFileToZone.set(f, z.id);
    }
    const preCrossings: ZoneCrossing[] = [];
    for (const edge of imports.edges) {
      const fz = preFileToZone.get(edge.from);
      const tz = preFileToZone.get(edge.to);
      if (fz && tz && fz !== tz) {
        preCrossings.push({
          from: edge.from,
          to: edge.to,
          fromZone: fz,
          toZone: tz,
        });
      }
    }

    if (perZone) {
      // Per-zone enrichment mode: enrich each zone individually
      const result = await enrichZonesPerZone(
        expandedZones,
        preCrossings,
        inventory,
        imports,
        validPrevious
      );
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
    } else {
      // Batch mode (default): enrich zones in batches
      const result = await enrichZonesWithAI(
        expandedZones,
        preCrossings,
        inventory,
        imports,
        validPrevious
      );
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
      // Meta-evaluation may return updated findings with reassessed severities
      if (result._updatedFindings) {
        metaUpdatedFindings = result._updatedFindings;
      }
    }
  } else if (validPrevious) {
    // --fast with unchanged structure: apply previous AI names, preserve insights
    const prevZones = validPrevious.zones;
    finalZones = expandedZones.map((zone) => {
      const prev = prevZones.find(
        (p) =>
          p.files.length > 0 && p.files.some((f) => zone.files.includes(f))
      );
      if (prev) {
        return {
          ...zone,
          id: prev.id,
          name: prev.name,
          description: prev.description,
        };
      }
      return zone;
    });

    // Deduplicate IDs
    const fastUsedIds = new Set<string>();
    for (const z of finalZones) {
      if (fastUsedIds.has(z.id)) {
        let suffix = 2;
        while (fastUsedIds.has(`${z.id}-${suffix}`)) suffix++;
        z.id = `${z.id}-${suffix}`;
      }
      fastUsedIds.add(z.id);
    }

    enrichmentPass = validPrevious.enrichmentPass ?? 0;
  }

  // ── Promote zones from sub-analyses ──
  // Sub-analysis zones are added with prefixed IDs (e.g., "packages-rex:api")
  // and marked with childId + depth fields

  const promotedZones: Zone[] = [];
  const promotedCrossings: ZoneCrossing[] = [];

  for (const sub of subAnalyses) {
    promotedZones.push(...promoteZones(sub));
    promotedCrossings.push(...promoteCrossings(sub));
  }

  // Combine root zones with promoted zones
  const allZones = [...finalZones, ...promotedZones];

  // ── Build final crossings with enriched zone IDs ──

  const fileToZone = new Map<string, string>();
  for (const zone of allZones) {
    for (const file of zone.files) fileToZone.set(file, zone.id);
  }

  // Build crossings from all import edges (root + cross-boundary)
  const crossings: ZoneCrossing[] = [...promotedCrossings];
  for (const edge of imports.edges) {
    const fromZone = fileToZone.get(edge.from);
    const toZone = fileToZone.get(edge.to);
    if (fromZone && toZone && fromZone !== toZone) {
      crossings.push({ from: edge.from, to: edge.to, fromZone, toZone });
    }
  }

  // ── Generate structural insights ──
  // Only generate insights for root zones (not promoted sub-analysis zones)

  // Count files not covered by sub-analyses for proper percentage calculations
  const rootFileCount = inventory.files.filter(
    (f) => !isSubAnalyzedFile(f.path, subAnalyzedPrefixes)
  ).length;

  const structural = generateStructuralInsights(
    finalZones,
    crossings.filter((c) => !c.fromZone.includes(":") && !c.toZone.includes(":")),
    imports,
    rootFileCount
  );

  // ── Merge insights: structural (fresh) + accumulated AI ──

  // Extract previous AI insights by stripping the structural prefix
  // from the previous zone's combined insights array.
  for (const zone of finalZones) {
    const structuralForZone = structural.zoneInsights.get(zone.id) ?? [];
    const newAiForZone = aiZoneInsights.get(zone.id) ?? [];

    // Get accumulated AI insights from previous run
    let prevAi: string[] = [];
    if (validPrevious) {
      const prevZone = validPrevious.zones.find(
        (p) =>
          p.id === zone.id ||
          (p.files.length > 0 && p.files.some((f) => zone.files.includes(f)))
      );
      if (prevZone?.insights) {
        // Strip leading structural insights (they're deterministic and identical)
        let startIdx = 0;
        for (
          let i = 0;
          i < structuralForZone.length && i < prevZone.insights.length;
          i++
        ) {
          if (prevZone.insights[i] === structuralForZone[i]) {
            startIdx = i + 1;
          } else {
            break;
          }
        }
        prevAi = prevZone.insights.slice(startIdx);
      }
    }

    const allInsights = [...structuralForZone, ...prevAi, ...newAiForZone];
    zone.insights = allInsights.length > 0 ? allInsights : undefined;
  }

  // Global insights
  let prevGlobalAi: string[] = [];
  if (validPrevious?.insights) {
    const sg = structural.globalInsights;
    let startIdx = 0;
    for (
      let i = 0;
      i < sg.length && i < validPrevious.insights.length;
      i++
    ) {
      if (validPrevious.insights[i] === sg[i]) {
        startIdx = i + 1;
      } else {
        break;
      }
    }
    prevGlobalAi = validPrevious.insights.slice(startIdx);
  }

  const allGlobalInsights = [
    ...structural.globalInsights,
    ...prevGlobalAi,
    ...aiGlobalInsights,
  ];

  // ── Build findings: structural (pass 0) + preserved previous + new AI ──

  const structuralFindings: Finding[] = [];

  // Convert structural zone insights to findings at pass 0
  for (const zone of finalZones) {
    const zoneStructural = structural.zoneInsights.get(zone.id) ?? [];
    for (const text of zoneStructural) {
      structuralFindings.push({
        type: "observation",
        pass: 0,
        scope: zone.id,
        text,
        severity: text.includes("Low cohesion") || text.includes("too broad")
          ? "warning"
          : text.includes("High coupling")
            ? "warning"
            : text.includes("entry points")
              ? "warning"
              : "info",
      });
    }
  }

  // Convert structural global insights to findings
  for (const text of structural.globalInsights) {
    structuralFindings.push({
      type: "observation",
      pass: 0,
      scope: "global",
      text,
      severity: text.includes("circular") || text.includes("Bidirectional")
        ? "warning"
        : "info",
    });
  }

  // Preserved previous AI findings (from prior runs, excluding structural which are recomputed)
  // If meta-evaluation returned updated findings, use those instead (they have reassessed severities)
  const prevAiFindings: Finding[] = [];
  if (metaUpdatedFindings) {
    // Meta-evaluation updated the full findings array — use only AI findings (pass > 0)
    for (const f of metaUpdatedFindings) {
      if (f.pass > 0) {
        prevAiFindings.push(f);
      }
    }
  } else if (validPrevious?.findings) {
    for (const f of validPrevious.findings) {
      if (f.pass > 0) {
        prevAiFindings.push(f);
      }
    }
  }

  const allFindings = deduplicateFindings([...structuralFindings, ...prevAiFindings, ...aiFindings]);

  // ── Back-populate findings into insights for backward compatibility ──
  // AI enrichment may produce structured findings without corresponding legacy
  // insight strings. Ensure every finding's text appears in the appropriate
  // insights array so consumers reading only the legacy format stay in sync.

  const zoneInsightSets = new Map<string, Set<string>>();
  for (const zone of finalZones) {
    zoneInsightSets.set(zone.id, new Set(zone.insights ?? []));
  }
  const globalInsightSet = new Set(allGlobalInsights);

  for (const f of allFindings) {
    if (f.scope === "global") {
      if (!globalInsightSet.has(f.text)) {
        allGlobalInsights.push(f.text);
        globalInsightSet.add(f.text);
      }
    } else {
      const existing = zoneInsightSets.get(f.scope);
      if (existing && !existing.has(f.text)) {
        const zone = finalZones.find((z) => z.id === f.scope);
        if (zone) {
          if (!zone.insights) zone.insights = [];
          zone.insights.push(f.text);
          existing.add(f.text);
        }
      }
    }
  }

  // Track meta-evaluation count: enrichmentPass stays at 4 for UI, metaEvaluationCount tracks pass 5+
  const prevMetaCount = previousZones?.metaEvaluationCount ?? 0;
  const metaEvaluationCount = enrichmentPass >= 5 ? prevMetaCount + 1 : prevMetaCount > 0 ? prevMetaCount : undefined;
  // Cap enrichmentPass at 4 for UI display purposes
  const displayPass = enrichmentPass > 4 ? 4 : enrichmentPass;

  return {
    zones: sortZonesData({
      zones: allZones,
      crossings,
      unzoned,
      insights: allGlobalInsights.length > 0 ? allGlobalInsights : undefined,
      findings: allFindings.length > 0 ? allFindings : undefined,
      enrichmentPass: allFindings.length > 0 ? displayPass : undefined,
      ...(metaEvaluationCount ? { metaEvaluationCount } : {}),
      structureHash,
    }),
    tokenUsage: enrichTokenUsage,
  };
}
