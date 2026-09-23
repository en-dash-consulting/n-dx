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

import { basename, dirname, extname } from "node:path";
import { createHash } from "node:crypto";
import type {
  Inventory,
  Imports,
  ImportEdge,
  Zone,
  ZoneCrossing,
  Zones,
  ZoneStability,
  Finding,
  AnalyzeTokenUsage,
  SubAnalysisRef,
  ProjectProfile,
  PartitionReview,
  ZoneArea,
} from "../schema/index.js";
import type { SubAnalysis } from "./workspace.js";
import { assessPartitionHealth, formatPartitionLine, reviewPreviousPartition } from "./partition-review.js";
import { addRouteFeatureEdges, buildRouteLayout, detectRouteConventions, routeFeatureZoneId } from "./route-convention.js";
import type { RouteLayout } from "./route-convention.js";
import {
  buildPackageMap,
  computeCrossRepoCrossings,
} from "./workspace-crossings.js";
import {
  promoteZones,
  promoteCrossings,
  getSubAnalyzedPrefixes,
  isSubAnalyzedFile,
} from "./workspace.js";
import { sortZonesData } from "../util/sort.js";
import {
  buildUndirectedGraph,
  addDirectoryProximityEdges,
  louvainPhase1,
  mergeBidirectionalCoupling,
  mergeSmallCommunities,
  mergeSatelliteCommunities,
  capZoneCount,
  splitLargeCommunities,
  splitByFirstDifferingDirectory,
} from "./louvain.js";
import type { MergeLogEntry } from "./louvain.js";
import { enrichZonesWithAI, enrichZonesPerZone } from "./enrich.js";
import { judgeFindings, judgeZoneFragility, judgeHeuristicFindings, judgeMoves } from "./enrich-judge.js";
import { cascadeEnrichment } from "./enrich-cascade.js";
import { dedupeZoneNames, deepestDistinguishingSegment, idFromStems, idsFollowNames, isAlgorithmicName, renameZoneRefs, reprefixSubZones, zoneIdsOf } from "./zone-identity.js";
import { getJudgmentRoute } from "./claude-client.js";
import { recordPartitionReview, setRunMode } from "./run-ledger.js";
import { computeAreas } from "./zone-areas.js";
import { nameAreas } from "./area-naming.js";
import { nameSubZones } from "./subzone-naming.js";
import { emptyAnalyzeTokenUsage } from "./token-usage.js";
import { deduplicateFindings, enforceSeverityRules } from "./enrich-parsing.js";
import { detectPinDivergence, detectImportNeighborMoves } from "./move-recommendations.js";
import type { MoveContext } from "./move-recommendations.js";

/** Result from analyzeZones, including the zones data and optional token usage. */
export interface AnalyzeZonesResult {
  zones: Zones;
  tokenUsage?: AnalyzeTokenUsage;
  /** True when zone structure changed and enrichment pass was reset to 1 */
  structureChanged: boolean;
  /** Final ids of zones the cascade left for `sv narrate` (with `deferNarration`). */
  pendingNarration?: string[];
  /** Final ids of zones whose generated names `sv narrate` still has to produce. */
  pendingNames?: string[];
}

/** Options for the reusable zone detection pipeline. */
export interface ZonePipelineOptions {
  /** Import edges to cluster (pre-filtered for scope). */
  edges: ImportEdge[];
  /** Full inventory for zone descriptions and file metadata. */
  inventory: Inventory;
  /** Full imports for entry point detection and crossing computation. */
  imports: Imports;
  /** File paths in scope for zone assignment. */
  scopeFiles: string[];
  /** Maximum number of root-level zones. Default: 15. */
  maxZones?: number;
  /**
   * Maximum percentage of scope files a single zone may contain (1–100).
   * Default: {@link DEFAULT_MAX_ZONE_PERCENT} (15%).
   * Set to `100` to disable the zone size cap.
   */
  maxZonePercent?: number;
  /** Parent zone ID for sub-zone ID derivation. Reserved for subdivision. */
  parentId?: string;
  /** Current recursion depth. Reserved for subdivision. */
  depth?: number;
  /** Test files excluded from cohesion/coupling metric computation. */
  testFiles?: Set<string>;
  /**
   * Manual zone overrides: file path → target zone ID.
   * Files listed here are moved to the specified zone after Louvain detection
   * and proximity assignment, overriding the algorithmic placement.
   * Stored in `.n-dx.json` under `sourcevision.zones.pins`.
   */
  zonePins?: Record<string, string>;
  /**
   * Minimum zone size for the small-zone merge pass. Zones with fewer files
   * than this threshold are merged into their closest neighbor by import affinity.
   * Default: 3. Configurable via `sourcevision.zones.mergeThreshold` in `.n-dx.json`.
   */
  smallZoneMergeThreshold?: number;
  /**
   * Previous zone assignments for stability bias. When provided, synthetic
   * co-zone edges are added to the graph before Louvain to bias toward
   * preserving the previous topology. Files that shared a zone previously
   * are more likely to remain co-zoned.
   */
  previousZoneAssignment?: Map<string, string>;
  /**
   * Weight multiplier for co-zone stability edges, relative to the median
   * import edge weight. Default: 0.5. Set to 0 to disable stability bias.
   */
  stabilityWeight?: number;
  /**
   * File-based routing layout (see `route-convention.ts`). Its generic
   * segments are skipped in id derivation and its route features are tied
   * together with proximity edges.
   */
  routeLayout?: RouteLayout;
  /** Louvain resolution; above 1.0 favours smaller communities. Default 1.0. */
  resolution?: number;
  /**
   * Use this file → community assignment for production files instead of
   * Louvain (subdivision's directory fallback). Tests are still quarantined.
   */
  presetCommunity?: Map<string, string>;
  /**
   * Put tests in test-only directories into their own communities. Default
   * true; subdivision turns it off — inside a zone, a test belongs with the
   * code it tests, not in a one-file sliver of its own.
   */
  quarantineTests?: boolean;
}

/** Result of running the zone detection pipeline. */
export interface ZonePipelineResult {
  zones: Zone[];
  crossings: ZoneCrossing[];
  unzoned: string[];
  /** Zone IDs that were derived from filename patterns rather than directory structure. */
  filenameBasedZoneIds: Set<string>;
  /** Log of small-zone merge decisions for debuggability. */
  smallZoneMergeLog: MergeLogEntry[];
}

// ── Stability bias ──────────────────────────────────────────────────────────

/**
 * Compute the median edge weight from the import-only graph.
 * Used to calibrate stability edge weight relative to real import signals.
 */
function medianEdgeWeight(importGraph: Map<string, Map<string, number>>): number {
  const weights: number[] = [];
  const seen = new Set<string>();
  for (const [node, neighbors] of importGraph) {
    for (const [neighbor, weight] of neighbors) {
      const key = node < neighbor ? `${node}\0${neighbor}` : `${neighbor}\0${node}`;
      if (!seen.has(key)) {
        seen.add(key);
        weights.push(weight);
      }
    }
  }
  if (weights.length === 0) return 1;
  weights.sort((a, b) => a - b);
  const mid = Math.floor(weights.length / 2);
  return weights.length % 2 === 0 ? (weights[mid - 1] + weights[mid]) / 2 : weights[mid];
}

/**
 * Add synthetic co-zone edges to bias Louvain toward preserving the previous
 * zone topology. For each pair of files that shared a zone, add an edge with
 * weight = median_import_weight * stabilityWeight.
 *
 * Only adds edges between files that are both present in the current graph.
 * Does NOT add edges for new files (not in previousZoneAssignment) — they
 * are assigned purely by import affinity.
 *
 * The edges are added to `graph` (which Louvain operates on) but NOT to
 * `importOnlyGraph` (used for cohesion/coupling metrics), so stability bias
 * doesn't inflate measured cohesion.
 */
function addStabilityEdges(
  graph: Map<string, Map<string, number>>,
  importOnlyGraph: Map<string, Map<string, number>>,
  previousAssignment: Map<string, string>,
  stabilityWeight: number,
): void {
  const edgeWeight = medianEdgeWeight(importOnlyGraph) * stabilityWeight;
  if (edgeWeight <= 0) return;

  // Group files by their previous zone
  const zoneMembers = new Map<string, string[]>();
  for (const [file, zone] of previousAssignment) {
    // Only include files that exist in the current graph
    if (!graph.has(file)) continue;
    let members = zoneMembers.get(zone);
    if (!members) {
      members = [];
      zoneMembers.set(zone, members);
    }
    members.push(file);
  }

  // Add pairwise co-zone edges (capped for large zones to avoid O(n²) blowup)
  const MAX_PAIRS_PER_ZONE = 500;
  for (const members of zoneMembers.values()) {
    if (members.length < 2) continue;
    const totalPairs = members.length * (members.length - 1) / 2;

    if (totalPairs <= MAX_PAIRS_PER_ZONE) {
      // Small zone: add all pairwise edges
      for (let i = 0; i < members.length; i++) {
        const a = members[i];
        const aNeighbors = graph.get(a)!;
        for (let j = i + 1; j < members.length; j++) {
          const b = members[j];
          const bNeighbors = graph.get(b)!;
          aNeighbors.set(b, (aNeighbors.get(b) ?? 0) + edgeWeight);
          bNeighbors.set(a, (bNeighbors.get(a) ?? 0) + edgeWeight);
        }
      }
    } else {
      // Large zone: connect each file to its existing import neighbors within
      // the zone, plus a star topology through the first member as hub.
      // This gives O(n) edges instead of O(n²) while still biasing Louvain.
      const hub = members[0];
      const hubNeighbors = graph.get(hub)!;
      const memberSet = new Set(members);

      for (let i = 1; i < members.length; i++) {
        const file = members[i];
        const fileNeighbors = graph.get(file)!;

        // Star edge: connect to hub
        hubNeighbors.set(file, (hubNeighbors.get(file) ?? 0) + edgeWeight);
        fileNeighbors.set(hub, (fileNeighbors.get(hub) ?? 0) + edgeWeight);

        // Reinforce existing import edges within the zone
        for (const [neighbor, _] of importOnlyGraph.get(file) ?? []) {
          if (memberSet.has(neighbor) && neighbor !== hub) {
            const nNeighbors = graph.get(neighbor)!;
            fileNeighbors.set(neighbor, (fileNeighbors.get(neighbor) ?? 0) + edgeWeight);
            nNeighbors.set(file, (nNeighbors.get(file) ?? 0) + edgeWeight);
          }
        }
      }
    }
  }
}

// ── Zone identity preservation ───────────────────────────────────────────────

/** Default minimum file overlap ratio to inherit previous zone identity.
 * Requires strong overlap from both the previous and new zone perspectives so
 * a large merged zone cannot inherit the identity of a tiny prior zone it
 * happens to fully contain. */
const ZONE_OVERLAP_THRESHOLD = 0.5;

/**
 * Overlap required to inherit identity from a partition the review rejected.
 * Its ids and names were derived from fragments; at the default 0.5 a new
 * zone that merges two fragments takes one fragment's label. Only a zone that
 * is substantially the same set of files keeps the old identity.
 */
const REJECTED_PARTITION_OVERLAP_THRESHOLD = 0.8;

/**
 * Preserve previous zone IDs and names when a new zone has high file overlap
 * with a previous zone. Uses a greedy best-match approach: for each new zone,
 * find the previous zone with the strongest reciprocal overlap; if both the
 * previous-zone retention and new-zone retention exceed the threshold, inherit
 * the previous ID/name/description.
 *
 * This prevents the LLM from inventing new names for zones whose file
 * membership barely changed — the #1 source of zone identity instability.
 */
export function preservePreviousZoneIdentity(
  newZones: Zone[],
  previousZones: Zone[],
  threshold: number = ZONE_OVERLAP_THRESHOLD,
  opts: { keepIds?: boolean } = {},
): Zone[] {
  if (previousZones.length === 0) return newZones;

  // Build file sets for previous zones
  const prevFileSets = previousZones.map(z => ({
    zone: z,
    files: new Set(z.files),
  }));

  const usedPrevIds = new Set<string>();
  const result: Zone[] = [];

  for (const zone of newZones) {
    const newFiles = new Set(zone.files);
    let bestMatch: { zone: Zone; overlap: number } | null = null;

    for (const prev of prevFileSets) {
      if (usedPrevIds.has(prev.zone.id)) continue;

      // Require strong overlap in both directions. This still allows modest
      // growth or shrinkage, but avoids renaming a large merged zone after a
      // tiny predecessor that happens to be fully contained within it.
      let intersection = 0;
      for (const f of prev.files) {
        if (newFiles.has(f)) intersection++;
      }
      const prevOverlap = prev.files.size > 0 ? intersection / prev.files.size : 0;
      const newOverlap = newFiles.size > 0 ? intersection / newFiles.size : 0;
      const overlap = Math.min(prevOverlap, newOverlap);

      if (overlap >= threshold && (!bestMatch || overlap > bestMatch.overlap)) {
        bestMatch = { zone: prev.zone, overlap };
      }
    }

    if (bestMatch) {
      usedPrevIds.add(bestMatch.zone.id);
      if (opts.keepIds) {
        // The id derivation changed on purpose; only a chosen name carries over.
        const chosen = !isAlgorithmicName(bestMatch.zone.name, zoneIdsOf(bestMatch.zone));
        if (chosen) console.log(`  [zones] keeping name "${bestMatch.zone.name}" for "${zone.id}" (was "${bestMatch.zone.id}", ${(bestMatch.overlap * 100).toFixed(0)}% file overlap)`);
        result.push(chosen
          ? { ...zone, name: bestMatch.zone.name, description: bestMatch.zone.description || zone.description }
          : zone);
        continue;
      }
      console.log(`  [zones] preserving identity: "${zone.id}" → "${bestMatch.zone.id}" (${(bestMatch.overlap * 100).toFixed(0)}% file overlap)`);
      result.push(reprefixSubZones({
        ...zone,
        id: bestMatch.zone.id,
        name: bestMatch.zone.name,
        description: bestMatch.zone.description || zone.description,
        ...(bestMatch.zone.previousIds?.length ? { previousIds: bestMatch.zone.previousIds } : {}),
      }, zone.id));
    } else {
      result.push(zone);
    }
  }

  return result;
}

/**
 * After identity preservation restores a previous zone's name and
 * description, put the cascade's labels back where they should win: the
 * description is templated from current facts, so it is always the cascade's;
 * the name is the cascade's only when the preserved one is the algorithmic
 * default (a chosen name from an earlier run stays, for stability).
 */
export function reapplyCascadeLabels(preserved: Zone[], cascade: Zone[]): Zone[] {
  const byFiles = new Map(cascade.map((z) => [[...z.files].sort().join("\u0000"), z]));
  return preserved.map((zone) => {
    const source = byFiles.get([...zone.files].sort().join("\u0000"));
    if (!source) return zone;
    const keepName = !isAlgorithmicName(zone.name, zoneIdsOf(zone));
    return { ...zone, description: source.description, name: keepName ? zone.name : source.name };
  });
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

/** Segments skipped during zone ID derivation (generic + test directories). */
const SKIPPABLE_SEGMENTS = new Set([
  ...GENERIC_SEGMENTS,
  "tests", "test", "spec", "specs", "mocks",
]);

/**
 * Derive a zone ID from the most common directory segment among files.
 * Root-level files → "root".
 *
 * When `parentId` is provided (for sub-zone derivation), the parent's ID
 * segments are treated as generic and skipped, producing deeper, more
 * specific names (e.g., "agent" instead of "hench").
 */
export function deriveZoneId(files: string[], parentId?: string, extraSkip?: ReadonlySet<string>): string {
  // When deriving sub-zone IDs, treat parent's ID segments as generic
  const skip = parentId || extraSkip?.size
    ? new Set([...SKIPPABLE_SEGMENTS, ...(extraSkip ?? []), ...(parentId ? parentId.split("/").map(s => s.toLowerCase()) : [])])
    : SKIPPABLE_SEGMENTS;

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
      const normalized = part.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (!normalized || skip.has(part) || skip.has(normalized)) continue;
      segmentCounts.set(
        normalized,
        (segmentCounts.get(normalized) ?? 0) + 1
      );
      found = true;
      break;
    }
    // If all segments were skipped, use the last one
    if (!found && parts.length > 0) {
      const last = parts[parts.length - 1];
      const normalized = last.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (normalized) {
        segmentCounts.set(normalized, (segmentCounts.get(normalized) ?? 0) + 1);
      }
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
 * Disambiguate a zone ID by finding the most common path segment that
 * appears AFTER the baseId segment in file paths. Returns `${baseId}-${next}`
 * (e.g., "routes-admin") or just `baseId` if no discriminator found.
 */
export function disambiguateZoneId(
  baseId: string,
  files: string[],
  parentId?: string,
  extraSkip?: ReadonlySet<string>,
): string {
  const parentSegments = new Set([
    ...(parentId ? parentId.split("/").map(s => s.toLowerCase()) : []),
    ...(extraSkip ?? []),
  ]);

  const nextCounts = new Map<string, number>();

  for (const file of files) {
    const parts = dirname(file).split("/");
    // Find the index of the baseId segment
    let baseIdx = -1;
    for (let i = 0; i < parts.length; i++) {
      const normalized = parts[i].toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (normalized === baseId) {
        baseIdx = i;
        break;
      }
    }
    if (baseIdx === -1) continue;

    // Look for the first meaningful segment after baseId
    for (let i = baseIdx + 1; i < parts.length; i++) {
      const normalized = parts[i].toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
      if (
        !normalized ||
        SKIPPABLE_SEGMENTS.has(normalized) ||
        parentSegments.has(normalized)
      ) {
        continue;
      }
      nextCounts.set(normalized, (nextCounts.get(normalized) ?? 0) + 1);
      break;
    }
  }

  if (nextCounts.size === 0) return baseId;

  // Pick the most common next segment, tie-break lexicographic
  let bestSegment = "";
  let bestCount = 0;
  for (const [seg, count] of nextCounts) {
    if (count > bestCount || (count === bestCount && seg < bestSegment)) {
      bestSegment = seg;
      bestCount = count;
    }
  }

  return bestSegment ? `${baseId}-${bestSegment}` : baseId;
}

/** Words skipped during filename-based zone ID derivation (too generic). */
const FILENAME_SKIP_WORDS = new Set([
  "test", "spec", "index", "utils", "helpers", "types",
  "config", "constants", "main", "app", "mod", "lib",
]);

/**
 * Derive a zone ID from the dominant theme word in filename stems.
 * Used as a fallback when directory-based derivation produces duplicate IDs.
 *
 * Algorithm:
 * 1. Filter out test files (*.test.ts, *.spec.ts)
 * 2. Extract filename stems, split by `-`, `_`, and camelCase boundaries
 * 3. Skip generic words (index, utils, types, etc.)
 * 4. Count word frequency (deduplicated per file)
 * 5. Return the most common word if it appears in ≥30% of source files (min 2 files)
 * 6. Tie-break lexicographically for determinism
 */
export function deriveZoneIdFromFilenames(files: string[]): string | null {
  // Filter out test files
  const sourceFiles = files.filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts")
      && !f.endsWith(".test.js") && !f.endsWith(".spec.js")
      && !f.endsWith(".test.tsx") && !f.endsWith(".spec.tsx")
  );
  if (sourceFiles.length < 2) return null;

  const wordCounts = new Map<string, number>();

  for (const file of sourceFiles) {
    const stem = basename(file).replace(/\.[^.]+$/, "");
    // Split by `-`, `_`, and camelCase boundaries
    const words = stem
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[-_\s]+/)
      .filter((w) => w.length > 1 && !FILENAME_SKIP_WORDS.has(w));

    // Deduplicate per file
    const unique = new Set(words);
    for (const word of unique) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1);
    }
  }

  if (wordCounts.size === 0) return null;

  // Find the most common word, tie-break lexicographically
  let bestWord = "";
  let bestCount = 0;
  for (const [word, count] of wordCounts) {
    if (count > bestCount || (count === bestCount && word < bestWord)) {
      bestWord = word;
      bestCount = count;
    }
  }

  // Must appear in ≥30% of source files and at least 2 files
  const threshold = Math.max(2, Math.ceil(sourceFiles.length * 0.3));
  if (bestCount < threshold) return null;

  return bestWord;
}

function deriveZoneIdFromFileStems(
  files: string[],
  excludedWords: Iterable<string> = [],
): string | null {
  const SMALL_COMMUNITY_STEM_SKIP_WORDS = new Set(["index", "test", "spec"]);
  const sourceFiles = files.filter(
    (f) => !f.endsWith(".test.ts") && !f.endsWith(".spec.ts")
      && !f.endsWith(".test.js") && !f.endsWith(".spec.js")
      && !f.endsWith(".test.tsx") && !f.endsWith(".spec.tsx")
  );

  if (sourceFiles.length < 2 || sourceFiles.length > 3) return null;

  const skipWords = new Set(
    [...excludedWords]
      .flatMap((word) => word.split("/"))
      .map((word) => word.toLowerCase())
  );

  const stems = [...new Set(
    sourceFiles
      .map((file) => basename(file).replace(/\.[^.]+$/, ""))
      .filter((stem) => {
        const norm = stem.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "");
        return norm && !SMALL_COMMUNITY_STEM_SKIP_WORDS.has(norm) && !skipWords.has(norm);
      })
      .sort()
  )];

  if (stems.length < 2) return null;
  // Words, not raw stems: camelCase split and route syntax stripped, so
  // CosmicCallout + DashboardGrid → cosmic-callout-dashboard-grid rather
  // than cosmiccallout-dashboardgrid.
  return idFromStems(stems.slice(0, 2));
}

/**
 * Title-case a zone ID: "detail-panel" → "Detail Panel"
 */
export function deriveZoneName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Generic zone name detection ──────────────────────────────────────────────

const GENERIC_BASES = new Set([
  "src", "lib", "app", "packages", "internal", "pkg",
  "root", "tests", "test", "spec", "specs", "mocks",
  "source", "library", "application", "package",
]);

function isGenericZoneName(name: string, id: string): boolean {
  // "Src 2", "Lib 3" etc — generic base + numeric suffix
  const match = name.match(/^(\w+)\s+(\d+)$/);
  if (match && GENERIC_BASES.has(match[1].toLowerCase())) return true;
  // A placeholder from this or an earlier numbered id ("Routes 8" on routes-6)
  if (/-\d+$/.test(id) && isAlgorithmicName(name, [id])) return true;
  return false;
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
  unzonedFiles: string[],
  maxZoneSize?: number,
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

  // Track pending additions per zone to enforce size cap
  const pendingCounts = new Map<string, number>();
  const zoneSizes = new Map<string, number>();
  for (const zone of zones) {
    zoneSizes.set(zone.id, zone.files.length);
  }

  for (const file of [...unzonedFiles].sort()) {
    let dir = dirname(file);
    let assigned = false;

    while (dir && dir !== ".") {
      const counts = dirZones.get(dir);
      if (counts && counts.size > 0) {
        // Pick zone with most files in this directory, tie-break by ID
        // Skip zones that are already at the size cap
        let bestZone = "";
        let bestCount = 0;
        for (const [zoneId, count] of counts) {
          if (maxZoneSize) {
            const currentSize = (zoneSizes.get(zoneId) ?? 0) + (pendingCounts.get(zoneId) ?? 0);
            if (currentSize >= maxZoneSize) continue;
          }
          if (count > bestCount || (count === bestCount && zoneId < bestZone)) {
            bestZone = zoneId;
            bestCount = count;
          }
        }

        if (!bestZone) {
          // All candidate zones in this directory are full, try parent
          const parent = dirname(dir);
          if (parent === dir) break;
          dir = parent;
          continue;
        }

        let list = assignments.get(bestZone);
        if (!list) {
          list = [];
          assignments.set(bestZone, list);
        }
        list.push(file);
        pendingCounts.set(bestZone, (pendingCounts.get(bestZone) ?? 0) + 1);
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

// ── Zone pinning ─────────────────────────────────────────────────────────────

/**
 * Apply manual zone pins by moving files from their detected zone to the
 * pinned target zone. Files whose target zone doesn't exist are skipped.
 * This runs after Louvain detection and proximity assignment.
 */
/**
 * A configured zone pin that could not be applied this run.
 * `target-zone-absent` is the important one: the pin's target zone did not
 * form (Louvain non-determinism), so the file silently fell back elsewhere.
 */
export interface ZonePinSkip {
  file: string;
  targetZoneId: string;
  reason: "target-zone-absent" | "file-unzoned";
}

export function applyZonePins(
  zones: Zone[],
  pins: Record<string, string>,
  skipped?: ZonePinSkip[],
): Zone[] {
  // Build file → source zone index
  const fileToZoneIdx = new Map<string, number>();
  for (let i = 0; i < zones.length; i++) {
    for (const f of zones[i].files) {
      fileToZoneIdx.set(f, i);
    }
  }

  // Build zone ID → index
  const zoneIdToIdx = new Map<string, number>();
  for (let i = 0; i < zones.length; i++) {
    // Earlier ids first, so a current id always wins over someone's alias.
    for (const prev of zones[i].previousIds ?? []) if (!zoneIdToIdx.has(prev)) zoneIdToIdx.set(prev, i);
  }
  for (let i = 0; i < zones.length; i++) {
    zoneIdToIdx.set(zones[i].id, i);
  }

  // Collect moves: [file, sourceIdx, targetIdx]
  const moves: [string, number, number][] = [];
  for (const [file, targetZoneId] of Object.entries(pins)) {
    const sourceIdx = fileToZoneIdx.get(file);
    const targetIdx = zoneIdToIdx.get(targetZoneId);
    if (targetIdx === undefined) {
      // The pin's target zone did not form this run — the file is NOT moved
      // and silently lands wherever Louvain put it. Surface this.
      skipped?.push({ file, targetZoneId, reason: "target-zone-absent" });
      continue;
    }
    if (sourceIdx === undefined) {
      skipped?.push({ file, targetZoneId, reason: "file-unzoned" });
      continue;
    }
    if (sourceIdx === targetIdx) continue; // already in target zone
    moves.push([file, sourceIdx, targetIdx]);
  }

  if (moves.length === 0) return zones;

  // Apply moves immutably
  const result = zones.map((z) => ({ ...z, files: [...z.files] }));
  for (const [file, sourceIdx, targetIdx] of moves) {
    const srcFiles = result[sourceIdx].files;
    const idx = srcFiles.indexOf(file);
    if (idx !== -1) srcFiles.splice(idx, 1);
    result[targetIdx].files.push(file);
  }

  // Remove zones that became empty
  return result.filter((z) => z.files.length > 0);
}

// ── Declared zone anchors (issue #210, Part 2) ───────────────────────────────

/**
 * A config-declared zone that is forced to exist from a file glob, regardless
 * of what Louvain produced. This gives single-target pin consolidations a
 * stable anchor so they are deterministic across runs.
 * Configured in `.n-dx.json` under `sourcevision.zones.anchors`.
 */
export interface ZoneAnchor {
  id: string;
  name: string;
  include: string[];
  exclude?: string[];
}

/** Minimal, dependency-free path-glob → anchored RegExp (`**`, `*`, `?`). */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++; // consume `**/` as "any depth incl. none"
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += `\\${c}`;
    } else {
      re += c;
    }
  }
  return new RegExp(`^${re}$`);
}

function matchesAnyGlob(path: string, globs: readonly RegExp[]): boolean {
  return globs.some((g) => g.test(path));
}

/**
 * Resolve which scope files each anchor claims. Anchors are evaluated in
 * declared order; the first anchor whose include matches (and exclude does
 * not) wins a file. Returns ordered file lists plus anchors that matched
 * nothing (surfaced as a warning).
 */
function matchAnchorFiles(
  scopeFiles: readonly string[],
  anchors: readonly ZoneAnchor[],
): { byAnchor: Map<string, string[]>; emptyAnchors: ZoneAnchor[] } {
  const compiled = anchors.map((a) => ({
    anchor: a,
    include: a.include.map(globToRegExp),
    exclude: (a.exclude ?? []).map(globToRegExp),
  }));
  const byAnchor = new Map<string, string[]>();
  for (const { anchor } of compiled) byAnchor.set(anchor.id, []);
  for (const file of scopeFiles) {
    for (const { anchor, include, exclude } of compiled) {
      if (matchesAnyGlob(file, include) && !matchesAnyGlob(file, exclude)) {
        byAnchor.get(anchor.id)!.push(file);
        break;
      }
    }
  }
  for (const files of byAnchor.values()) files.sort();
  const emptyAnchors = compiled
    .filter(({ anchor }) => byAnchor.get(anchor.id)!.length === 0)
    .map(({ anchor }) => anchor);
  return { byAnchor, emptyAnchors };
}

/**
 * Force declared anchors to exist as zones: carve their files out of whatever
 * zone Louvain/enrichment placed them in and reconstitute a zone with the
 * anchor's id/name. Applied after enrichment and before zone pins so that pins
 * targeting an anchor id always resolve deterministically.
 */
function assertAnchorZones(
  zones: Zone[],
  anchors: readonly ZoneAnchor[],
  scopeFiles: readonly string[],
  imports: Imports,
): { zones: Zone[]; emptyAnchors: ZoneAnchor[] } {
  if (anchors.length === 0) return { zones, emptyAnchors: [] };
  const { byAnchor, emptyAnchors } = matchAnchorFiles(scopeFiles, anchors);
  const anchorIds = new Set(anchors.map((a) => a.id));

  // Glob-matched files are governed by the anchor's glob.
  const globAnchored = new Set<string>();
  for (const files of byAnchor.values()) for (const f of files) globAnchored.add(f);

  // A pre-existing zone sharing an anchor's id (e.g. a file already pinned to
  // that id by the pipeline) folds its non-glob files INTO the anchor — the
  // user pinned to that id meaning the anchor. Build each anchor's final set.
  const anchorFiles = new Map<string, string[]>();
  for (const anchor of anchors) {
    const base = byAnchor.get(anchor.id) ?? [];
    const sameId = zones.find((z) => z.id === anchor.id);
    const folded = (sameId?.files ?? []).filter((f) => !globAnchored.has(f));
    anchorFiles.set(anchor.id, [...new Set([...base, ...folded])].sort());
  }
  const anchored = new Set<string>(globAnchored);
  for (const files of anchorFiles.values()) for (const f of files) anchored.add(f);

  // Remove anchored files from other zones; drop any zone whose id collides
  // with an anchor (its files were folded above) and zones that empty out.
  const stripped = zones
    .map((z) => ({ ...z, files: z.files.filter((f) => !anchored.has(f)) }))
    .filter((z) => z.files.length > 0 && !anchorIds.has(z.id));

  // Cohesion/coupling straight from import edges (no undirected graph here).
  const metricsFor = (memberSet: Set<string>): { cohesion: number; coupling: number } => {
    let internal = 0;
    let total = 0;
    for (const e of imports.edges) {
      if (!memberSet.has(e.from)) continue;
      total++;
      if (memberSet.has(e.to)) internal++;
    }
    if (total === 0) return { cohesion: memberSet.size <= 1 ? 1 : 0, coupling: 0 };
    return {
      cohesion: Math.round((internal / total) * 100) / 100,
      coupling: Math.round(((total - internal) / total) * 100) / 100,
    };
  };

  const anchorZones: Zone[] = [];
  for (const anchor of anchors) {
    const files = anchorFiles.get(anchor.id) ?? [];
    if (files.length === 0) continue;
    const memberSet = new Set(files);
    const { cohesion, coupling } = metricsFor(memberSet);
    const prev = zones.find((z) => z.id === anchor.id);
    anchorZones.push({
      id: anchor.id,
      name: anchor.name,
      description: prev?.description ?? `Declared zone anchor (${files.length} files).`,
      files,
      entryPoints: computeEntryPoints(memberSet, imports),
      cohesion,
      coupling,
    });
  }

  return { zones: [...stripped, ...anchorZones], emptyAnchors };
}

// ── Recursive subdivision ────────────────────────────────────────────────────

/**
 * Absolute floor for the subdivision threshold. A zone with fewer than this
 * many files is never subdivided regardless of project size — the noise
 * floor below which sub-zoning is more confusing than useful.
 */
export const SUBDIVISION_THRESHOLD_MIN = 12;

/**
 * Project-relative subdivision trigger. Any zone exceeding this fraction of
 * total project files is considered "likely multiple concerns" and gets
 * recursively split — independent of its measured cohesion (a 29-file zone
 * with cohesion 0.79 routinely contains 3+ architectural roles glued
 * together by a few shared types).
 */
export const SUBDIVISION_THRESHOLD_PCT = 0.15;

/**
 * Compute the subdivision threshold for a project of `totalFiles` files.
 * Caller passes `inventory.files.length` — we use the larger of the absolute
 * floor and the project-relative fraction so small repos still subdivide
 * meaningful blobs and large repos don't fragment into noise.
 *
 * Legacy export `SUBDIVISION_THRESHOLD` kept as the absolute floor so any
 * external consumer pinning to the constant still gets reasonable behavior.
 */
export function subdivisionThreshold(totalFiles: number): number {
  return Math.max(SUBDIVISION_THRESHOLD_MIN, Math.min(SUBDIVISION_THRESHOLD_CAP, Math.floor(totalFiles * SUBDIVISION_THRESHOLD_PCT)));
}

/**
 * Upper bound on the subdivision trigger. With areas as the top level, a zone
 * is a leaf of a hierarchy rather than the whole map, and a 100-file zone
 * inside a 1,000-file project still has structure worth drawing: 15% of the
 * project (150 files) meant nothing below the zones ever split.
 */
export const SUBDIVISION_THRESHOLD_CAP = 30;

/** @deprecated use {@link subdivisionThreshold}(totalFiles) — kept for back-compat */
export const SUBDIVISION_THRESHOLD = SUBDIVISION_THRESHOLD_MIN;

/** A subdivision whose largest child holds this share of the parent or more is rejected. */
export const LOPSIDED_CHILD_SHARE = 0.7;
/** Louvain resolution for the second subdivision attempt. */
const SUBDIVISION_RETRY_RESOLUTION = 2.0;
/** Smallest directory group kept on its own by the directory fallback. */
const SUBDIVISION_MIN_CHILD = 3;

/** At least two children and none holding {@link LOPSIDED_CHILD_SHARE} of the parent. */
export function isBalancedSubdivision(children: Zone[], parentSize: number): boolean {
  if (children.length < 2 || parentSize === 0) return false;
  const largest = children.reduce((n, z) => Math.max(n, z.files.length), 0);
  return largest / parentSize < LOPSIDED_CHILD_SHARE;
}

/** Maximum recursion depth for subdivision to prevent infinite loops. */
export const MAX_SUBDIVISION_DEPTH = 3;

/**
 * Map a test file path to its community ID.
 *
 * - A top-level test root groups by suite: `Tests/<suite>/…` → one community
 *   per suite (multi-target Swift projects), `tests/x.test.ts` → the root.
 * - A test directory nested in a production tree (`app/utils/__tests__/`,
 *   `src/core/tests/`) groups with its parent directory: `tests:app/utils`.
 *   Lumping every nested `__tests__` directory together produced one
 *   250-file zone named after whichever parent was most common.
 * - Anything else falls back to a single "tests" community.
 */
export function deriveTestSuiteCommunity(filePath: string): string {
  const segments = filePath.split("/");
  for (let i = 0; i < segments.length - 1; i++) {
    const lc = segments[i].toLowerCase();
    if (!TEST_DIR_SEGMENTS.has(lc)) continue;
    if (i > 0) {
      // A test root inside a package (`packages/web/tests/unit/…`) keeps its
      // suite; a `__tests__` directory is itself the suite.
      const parent = segments.slice(0, i).join("/");
      const suite = lc !== "__tests__" && i + 2 < segments.length ? segments[i + 1] : undefined;
      return suite ? `tests:${parent}#${suite}` : `tests:${parent}`;
    }
    // Top-level test root: per suite when the file sits in a subdirectory.
    if (i + 2 < segments.length) return `tests:${segments[i]}#${segments[i + 1]}`;
    return `tests:${segments[i]}`;
  }
  return "tests";
}

const TEST_DIR_SEGMENTS = new Set(["tests", "test", "__tests__", "spec", "specs", "e2e"]);

/**
 * Zone id for a test community keyed by its parent path: `tests-<leaf>`,
 * walking up the path (`tests-digest-utils`) until the id is unused, so two
 * `utils/__tests__` directories in different features stay two zones.
 */
function testCommunityZoneId(key: string, used: ReadonlySet<string>, extraSkip?: ReadonlySet<string>): string {
  const [parentPath, suiteRaw] = key.split("#");
  const suite = suiteRaw ? suiteRaw.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, "") : "";
  const withSuite = (id: string) => (suite ? `${id}-${suite}` : id);
  const all = parentPath
    .split("/")
    .map((p) => p.toLowerCase().replace(/_/g, "-").replace(/^-+|-+$/g, ""))
    .filter((p) => p && !TEST_DIR_SEGMENTS.has(p));
  const meaningful = all.filter((p) => !GENERIC_SEGMENTS.has(p) && !extraSkip?.has(p));
  if (all.length === 0) {
    const id = withSuite("tests");
    return used.has(id) ? uniqueSuffix(id, used) : id;
  }
  // Shortest meaningful suffix first; then the full path, generic segments
  // included, so `app/utils` becomes `tests-app-utils` when `tests-utils` is taken.
  for (const segs of [meaningful, all]) {
    for (let k = 1; k <= segs.length; k++) {
      const id = withSuite(`tests-${segs.slice(-k).join("-")}`);
      if (!used.has(id)) return id;
    }
  }
  return uniqueSuffix(withSuite(`tests-${all.join("-")}`), used);
}

function uniqueSuffix(base: string, used: ReadonlySet<string>): string {
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Test communities below `minSize` files are folded into their nearest
 * ancestor test community (`tests:app/utils/format` → `tests:app/utils` →
 * `tests:app`), so nested test directories of one or two files do not each
 * become a zone.
 */
export function foldSmallTestCommunities(assignments: Map<string, string>, minSize: number): void {
  for (let pass = 0; pass < 8; pass++) {
    const sizes = new Map<string, number>();
    for (const c of assignments.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
    let moved = false;
    for (const [file, c] of assignments) {
      if ((sizes.get(c) ?? 0) >= minSize || !c.startsWith("tests:")) continue;
      const path = c.slice("tests:".length);
      const hash = path.indexOf("#");
      const slash = path.lastIndexOf("/");
      const parent = hash !== -1
        ? `tests:${path.slice(0, hash)}`
        : slash === -1 ? "tests" : `tests:${path.slice(0, slash)}`;
      if (parent === c) continue;
      assignments.set(file, parent);
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Subdivide a large zone by running the full zone pipeline on its internal
 * import graph. Returns sub-zones with IDs prefixed by parent zone ID.
 *
 * Uses the same algorithm at every zoom level (resolution escalation,
 * proximity edges, splitLargeCommunities, mergeSameIdCommunities) and
 * stores cross-sub-zone edges on `zone.subCrossings`.
 */
export function subdivideZone(
  zone: Zone,
  imports: Imports,
  inventory: Inventory,
  testFiles: Set<string> = new Set(),
  depth: number = 0,
  routeLayout?: RouteLayout,
): Zone[] {
  // Don't subdivide small zones or if we've hit max depth. The threshold is
  // project-size-relative — a 29-file zone in a 111-file project is 26 % of
  // the codebase and almost certainly contains multiple architectural roles
  // glued by shared types; under the legacy flat 50-file gate, that zone
  // would never have been touched.
  const threshold = subdivisionThreshold(inventory.files.length);
  if (zone.files.length < threshold || depth >= MAX_SUBDIVISION_DEPTH) {
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

  // Run full pipeline on the zone's internal graph. A split whose largest
  // child keeps most of the parent is not a subdivision — it is the parent
  // again plus slivers, and recursing on it built three-deep chains of one
  // dominant child. Retry finer, then by directory, then give up.
  const base = {
    edges: internalEdges,
    inventory,
    imports,
    scopeFiles: zone.files,
    maxZones: 8,
    parentId: zone.id,
    depth: depth + 1,
    testFiles,
    routeLayout,
    quarantineTests: false,
  };
  const attempts: Array<() => ZonePipelineResult | null> = [
    () => runZonePipeline(base),
    () => runZonePipeline({ ...base, resolution: SUBDIVISION_RETRY_RESOLUTION }),
    () => {
      const preset = splitByFirstDifferingDirectory(zone.files, SUBDIVISION_MIN_CHILD);
      return preset ? runZonePipeline({ ...base, presetCommunity: preset }) : null;
    },
  ];
  let result: ZonePipelineResult | undefined;
  for (const attempt of attempts) {
    const r = attempt();
    if (r && isBalancedSubdivision(r.zones, zone.files.length)) {
      result = r;
      break;
    }
  }
  if (!result) return [];

  // Slivers: children below the minimum join the sibling they share the most
  // import edges with (else the largest), and the split is rebuilt from that
  // assignment so ids, metrics and crossings are computed as usual.
  const small = result.zones.filter((z) => z.files.length < SUBDIVISION_MIN_CHILD);
  if (small.length > 0 && result.zones.length - small.length >= 2) {
    const childOf = new Map<string, string>();
    for (const z of result.zones) for (const f of z.files) childOf.set(f, z.id);
    const big = result.zones.filter((z) => z.files.length >= SUBDIVISION_MIN_CHILD);
    const largest = [...big].sort((a, b) => b.files.length - a.files.length)[0];
    const preset = new Map<string, string>();
    for (const z of big) for (const f of z.files) preset.set(f, z.id);
    for (const z of small) {
      const members = new Set(z.files);
      const links = new Map<string, number>();
      for (const e of internalEdges) {
        const other = members.has(e.from) ? e.to : members.has(e.to) ? e.from : undefined;
        const target = other && !members.has(other) ? childOf.get(other) : undefined;
        if (target && big.some((b) => b.id === target)) links.set(target, (links.get(target) ?? 0) + 1);
      }
      const best = [...links.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? largest.id;
      for (const f of z.files) preset.set(f, best);
    }
    const folded = runZonePipeline({ ...base, presetCommunity: preset });
    // Balanced only thanks to slivers is not balanced: no sub-zones then.
    if (!isBalancedSubdivision(folded.zones, zone.files.length)) return [];
    result = folded;
  }

  // Store sub-crossings on parent zone
  if (result.crossings.length > 0) {
    zone.subCrossings = result.crossings;
  }

  return result.zones;
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

/**
 * Version of the zone-partitioning algorithm. Folded into the input
 * fingerprint so that a sourcevision upgrade which changes how files are
 * grouped invalidates any cached partition produced by an older algorithm —
 * even when the project's files and zone config are byte-identical.
 *
 * BUMP THIS whenever the zone partition output changes for unchanged inputs
 * (graph construction, Louvain params, subdivision/merge thresholds, scope
 * filtering, etc.). Without the bump, `analyzeZones` reuses the prior
 * partition (see the reuse path keyed on computeInputFingerprint), so users
 * silently keep stale zones — and, e.g., an empty codebase map — until they
 * delete `.sourcevision`. Monotonic integer; history is intentionally terse.
 */
export const ZONE_ALGORITHM_VERSION = 5;

/**
 * Hash the analysis inputs that determine the Louvain partition, independent
 * of the partition itself. Same file contents + same zone config + same
 * algorithm version → same fingerprint → safe to reuse the previous zone
 * structure and skip the non-deterministic Louvain re-run that would
 * otherwise reset enrichmentPass.
 */
export function computeInputFingerprint(
  inventory: Inventory,
  zonePins?: Record<string, string>,
  smallZoneMergeThreshold?: number,
  maxZonePercent?: number,
  zoneAnchors?: readonly ZoneAnchor[],
  algorithmVersion: number = ZONE_ALGORITHM_VERSION,
): string {
  const fileData = inventory.files
    .map((f) => `${f.path}\0${f.hash}`)
    .sort()
    .join("\n");
  const pinData = Object.entries(zonePins ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");
  const anchorData = (zoneAnchors ?? [])
    .map((a) =>
      `${a.id}|${a.name}|${[...a.include].sort().join(",")}|${[...(a.exclude ?? [])].sort().join(",")}`,
    )
    .sort()
    .join("\n");
  const cfg = `mt=${smallZoneMergeThreshold ?? ""}\0mzp=${maxZonePercent ?? ""}`;
  const algo = `algo=${algorithmVersion}`;
  return createHash("sha256")
    .update(`${algo}\0\0${fileData}\0\0${pinData}\0\0${anchorData}\0\0${cfg}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Hash a zone's file contents for change detection between runs.
 * Uses inventory content hashes (already computed) so we detect code changes
 * even when the zone structure (file membership) stays the same.
 */
export function computeZoneContentHash(
  zone: Zone,
  fileHashes: Map<string, string>
): string {
  const data = [...zone.files]
    .sort()
    .map((f) => `${f}\0${fileHashes.get(f) ?? ""}`)
    .join("\n");
  return createHash("sha256").update(data).digest("hex").slice(0, 16);
}

// Imported from zone-hash.ts to break circular dependency with enrich.ts.
// Both zones.ts and enrich.ts need this function; placing it in a third
// module prevents the cycle.
import { computeGlobalContentHash } from "./zone-hash.js";
export { computeGlobalContentHash } from "./zone-hash.js";

// ── Structural insights ─────────────────────────────────────────────────────

/**
 * Generate deterministic, actionable insights from graph metrics.
 *
 * Recomputed every run — same structure always produces the same insights.
 * These insights translate raw cohesion/coupling numbers into architectural
 * guidance:
 *
 * - **Isolated files**: multiple files with no import edges — cohesion is
 *   unmeasurable (reported as 0). Not inherently bad, but the grouping is
 *   based on proximity rather than structural evidence.
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
 * When all connected zones achieve perfect cohesion, it validates that the
 * Louvain community detection successfully identified the codebase's natural
 * architectural boundaries. Isolated-file zones (cohesion 0) are excluded
 * from this assessment — their grouping is proximity-based, not structural.
 */
export function generateStructuralInsights(
  zones: Zone[],
  crossings: ZoneCrossing[],
  imports: Imports,
  totalFiles: number,
  callGraphStats?: { zoneStats: Array<{ zoneId: string; internalCalls: number; outgoingCalls: number; incomingCalls: number; callCohesion: number; callCoupling: number }>; crossZonePatterns: Array<{ fromZone: string; toZone: string; callCount: number }> },
  filenameBasedZoneIds?: Set<string>,
): { zoneInsights: Map<string, string[]>; globalInsights: string[]; findings: Finding[] } {
  const zoneInsights = new Map<string, string[]>();
  const globalInsights: string[] = [];
  const findings: Finding[] = [];

  for (const zone of zones) {
    zoneInsights.set(zone.id, []);
  }

  collectPerZoneInsights(zones, crossings, totalFiles, zoneInsights);
  collectHubFileInsights(crossings, globalInsights);
  collectBidirectionalCouplingInsights(crossings, globalInsights);
  collectSizeImbalanceInsights(zones, globalInsights);
  collectCircularDependencyInsights(imports, globalInsights);

  if (callGraphStats) {
    collectCallGraphInsights(zones, callGraphStats, zoneInsights, globalInsights);
  }

  collectFileStructureFindings(zones, filenameBasedZoneIds, findings);

  return { zoneInsights, globalInsights, findings };
}

// ── Per-zone metric insights ────────────────────────────────────────────────

/** Cohesion, coupling, size, entry point, and naming insights per zone. */
function collectPerZoneInsights(
  zones: Zone[],
  crossings: ZoneCrossing[],
  totalFiles: number,
  zoneInsights: Map<string, string[]>,
): void {
  for (const zone of zones) {
    const insights = zoneInsights.get(zone.id)!;
    const pct = totalFiles > 0
      ? Math.round((zone.files.length / totalFiles) * 100)
      : 0;

    if (zone.cohesion === 0 && zone.coupling === 0 && zone.files.length > 1) {
      insights.push(
        `Isolated files — no import edges between ${zone.files.length} files, cohesion is unmeasurable (reported as 0)`
      );
    } else if (zone.cohesion >= 0.8) {
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

    if (isGenericZoneName(zone.name, zone.id)) {
      insights.push(
        `Generic zone name "${zone.name}" — enrichment did not assign a meaningful name reflecting this zone's domain purpose`
      );
    }
  }
}

// ── Hub file detection ──────────────────────────────────────────────────────

/** Find files imported across 3+ zones (cross-cutting dependencies). */
function collectHubFileInsights(
  crossings: ZoneCrossing[],
  globalInsights: string[],
): void {
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
}

// ── Bidirectional coupling ──────────────────────────────────────────────────

/** Detect zone pairs that import from each other. */
function collectBidirectionalCouplingInsights(
  crossings: ZoneCrossing[],
  globalInsights: string[],
): void {
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
}

// ── Zone size imbalance ─────────────────────────────────────────────────────

/** Flag when largest zone dwarfs smallest (>5× ratio). */
function collectSizeImbalanceInsights(
  zones: Zone[],
  globalInsights: string[],
): void {
  if (zones.length > 2) {
    const sizes = zones.map((z) => z.files.length).sort((a, b) => a - b);
    if (sizes[sizes.length - 1] > sizes[0] * 5) {
      globalInsights.push(
        `Size imbalance: largest zone has ${sizes[sizes.length - 1]} files vs smallest with ${sizes[0]} — uneven decomposition`
      );
    }
  }
}

// ── Circular dependency reporting ───────────────────────────────────────────

/** Surface file-level circular dependency counts from import analysis. */
function collectCircularDependencyInsights(
  imports: Imports,
  globalInsights: string[],
): void {
  if (imports.summary.circularCount > 0) {
    globalInsights.push(
      `${imports.summary.circularCount} circular dependency chain${imports.summary.circularCount > 1 ? "s" : ""} detected — see imports.json for details`
    );
  }
}

// ── Call graph insights ─────────────────────────────────────────────────────

type CallGraphStats = NonNullable<Parameters<typeof generateStructuralInsights>[4]>;

/** Per-zone and global insights derived from the function call graph. */
function collectCallGraphInsights(
  zones: Zone[],
  callGraphStats: CallGraphStats,
  zoneInsights: Map<string, string[]>,
  globalInsights: string[],
): void {
  const { zoneStats, crossZonePatterns } = callGraphStats;
  const zoneStatsMap = new Map(zoneStats.map((s) => [s.zoneId, s]));

  // Per-zone call graph insights
  for (const zone of zones) {
    const stats = zoneStatsMap.get(zone.id);
    if (!stats) continue;
    const insights = zoneInsights.get(zone.id)!;

    // Call cohesion divergence from import cohesion
    const cohesionDiff = Math.abs(stats.callCohesion - zone.cohesion);
    if (cohesionDiff > 0.3) {
      if (stats.callCohesion < zone.cohesion) {
        insights.push(
          `Call cohesion (${stats.callCohesion}) much lower than import cohesion (${zone.cohesion}) — functions call across zone boundaries more than imports suggest`
        );
      } else {
        insights.push(
          `Call cohesion (${stats.callCohesion}) much higher than import cohesion (${zone.cohesion}) — tighter runtime coupling within zone than import structure suggests`
        );
      }
    }

    // High incoming call traffic
    if (stats.incomingCalls > 20) {
      insights.push(
        `${stats.incomingCalls} incoming calls from other zones — heavily depended-on runtime API`
      );
    }
  }

  // Global cross-zone call patterns
  const topCrossZone = crossZonePatterns.slice(0, 3);
  for (const pattern of topCrossZone) {
    if (pattern.callCount >= 10) {
      globalInsights.push(
        `Heavy cross-zone calls: "${pattern.fromZone}" → "${pattern.toZone}" (${pattern.callCount} calls) — tight runtime coupling`
      );
    }
  }

  // Total cross-zone call percentage
  const totalCalls = zoneStats.reduce((s, z) => s + z.internalCalls + z.outgoingCalls, 0);
  const totalCrossZone = zoneStats.reduce((s, z) => s + z.outgoingCalls, 0);
  if (totalCalls > 0) {
    const pct = Math.round((totalCrossZone / totalCalls) * 100);
    if (pct > 40) {
      globalInsights.push(
        `${pct}% of function calls cross zone boundaries — high runtime inter-zone dependency`
      );
    }
  }
}

// ── File-structure recommendations ──────────────────────────────────────────

/** Directory-spanning zones, scattered files, and filename-derived zone IDs. */
function collectFileStructureFindings(
  zones: Zone[],
  filenameBasedZoneIds: Set<string> | undefined,
  findings: Finding[],
): void {
  // Flat directory spanning 3+ zones
  const dirToZones = new Map<string, Set<string>>();
  for (const zone of zones) {
    for (const f of zone.files) {
      const dir = dirname(f);
      let set = dirToZones.get(dir);
      if (!set) { set = new Set(); dirToZones.set(dir, set); }
      set.add(zone.id);
    }
  }
  for (const [dir, zoneSet] of dirToZones) {
    if (zoneSet.size >= 3) {
      const names = [...zoneSet].sort().join(", ");
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: "global",
        text: `${dir}/ contains files from ${zoneSet.size} zones (${names}) — consider grouping into subdirectories to clarify architectural boundaries`,
        severity: "info",
      });
    }
  }

  // Zone with scattered files (5+ directories)
  for (const zone of zones) {
    const dirs = new Set(zone.files.map((f) => dirname(f)));
    if (dirs.size >= 5) {
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zone.id,
        text: `Zone "${zone.id}" has files across ${dirs.size} directories — consider consolidating under a dedicated directory`,
        severity: "info",
      });
    }
  }

  // Numeric suffix zones — overflow communities requiring pin or merge decision.
  // Mirrors the cross-package residual zone dissolution policy but applies it
  // to intra-package overflow communities (e.g. web-2, src-2, unit-3).
  for (const zone of zones) {
    const leafId = zone.id.includes("/") ? zone.id.split("/").pop()! : zone.id;
    if (/-\d+$/.test(leafId)) {
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zone.id,
        text: `Zone "${leafId}" has a numeric suffix indicating an overflow community — pin its files to a named zone or merge with the base zone to eliminate the ambiguous ID`,
        severity: "warning",
      });
    }
  }

  // Filename-derived zone
  if (filenameBasedZoneIds) {
    for (const zoneId of filenameBasedZoneIds) {
      const zone = zones.find((z) => z.id === zoneId);
      if (!zone || zone.files.length === 0) continue;
      const primaryDir = dirname(zone.files[0]);
      const leafId = zoneId.includes("/") ? zoneId.split("/").pop()! : zoneId;
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zoneId,
        text: `Zone "${leafId}" was identified from filename patterns, not directory structure — consider creating ${primaryDir}/${leafId}/ and moving related files there`,
        severity: "info",
      });
    }
  }
}

// ── Helper: merge same-ID communities ────────────────────────────────────────

/**
 * Merge Louvain communities that derive the same zone ID or share the same
 * dominant package root. Prevents a single package from fragmenting into
 * multiple root-level zones (e.g., "rex" + "rex-cli" or "sourcevision" +
 * "sourcevision-tests"). After merging, the combined zone may be subdivided
 * into properly named sub-zones.
 */
function mergeSameIdCommunities(
  community: Map<string, string>,
  maxSize?: number,
  extraSkip?: ReadonlySet<string>,
): void {
  const tempMembers = new Map<string, string[]>();
  for (const [node, comm] of community) {
    let list = tempMembers.get(comm);
    if (!list) { list = []; tempMembers.set(comm, list); }
    list.push(node);
  }

  // Pass 1: merge communities with the same derived zone ID
  mergeByKey(community, tempMembers, (members) => deriveZoneId(members, undefined, extraSkip), maxSize);

  // Rebuild member map after pass 1 (community assignments may have changed)
  tempMembers.clear();
  for (const [node, comm] of community) {
    let list = tempMembers.get(comm);
    if (!list) { list = []; tempMembers.set(comm, list); }
    list.push(node);
  }

  // Pass 2: merge communities whose files predominantly share the same
  // package root (e.g., packages/rex/src/* and packages/rex/tests/*)
  mergeByKey(community, tempMembers, (members) => dominantPackageRoot(members), maxSize);
}

/**
 * Generic community merger: group communities by a key derived from their
 * members, then merge all communities that share the same non-null key into
 * the largest one.
 *
 * When `maxSize` is provided, merges that would create a community exceeding
 * the limit are skipped — this prevents the same-ID merge from undoing
 * size-based splits.
 */
function mergeByKey(
  community: Map<string, string>,
  tempMembers: Map<string, string[]>,
  keyFn: (members: string[]) => string | null,
  maxSize?: number,
): void {
  const keyToCommunities = new Map<string, string[]>();
  for (const [comm, members] of tempMembers) {
    const key = keyFn(members);
    if (!key) continue;
    let list = keyToCommunities.get(key);
    if (!list) { list = []; keyToCommunities.set(key, list); }
    list.push(comm);
  }

  for (const [, comms] of keyToCommunities) {
    if (comms.length <= 1) continue;
    comms.sort((a, b) => {
      const sizeA = tempMembers.get(a)?.length ?? 0;
      const sizeB = tempMembers.get(b)?.length ?? 0;
      return sizeB - sizeA || a.localeCompare(b);
    });
    const target = comms[0];
    let targetSize = tempMembers.get(target)?.length ?? 0;
    for (let i = 1; i < comms.length; i++) {
      const sourceMembers = tempMembers.get(comms[i])!;
      // Skip merge if it would exceed the max zone size policy
      if (maxSize && targetSize + sourceMembers.length > maxSize) continue;
      for (const node of sourceMembers) {
        community.set(node, target);
      }
      targetSize += sourceMembers.length;
    }
  }
}

/**
 * Determine the dominant package root for a set of files.
 * Returns the `packages/<name>` prefix if ≥70% of files share it, else null.
 * This prevents artificial splits within a single domain package.
 */
function dominantPackageRoot(files: string[]): string | null {
  if (files.length === 0) return null;

  const rootCounts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/");
    if (parts.length >= 2 && parts[0] === "packages") {
      const root = `packages/${parts[1]}`;
      rootCounts.set(root, (rootCounts.get(root) ?? 0) + 1);
    }
  }

  if (rootCounts.size === 0) return null;

  // Find the most common package root
  let bestRoot = "";
  let bestCount = 0;
  for (const [root, count] of rootCounts) {
    if (count > bestCount || (count === bestCount && root < bestRoot)) {
      bestRoot = root;
      bestCount = count;
    }
  }

  // Only merge if the dominant root covers ≥70% of the community's files
  const ratio = bestCount / files.length;
  return ratio >= 0.7 ? bestRoot : null;
}

// ── Helper: compute zone metrics ─────────────────────────────────────────────

/**
 * Compute cohesion and coupling metrics for a set of files in a zone.
 * Test files are excluded from the calculation — both as iteration sources
 * and as neighbors — because test→source and source→test edges represent
 * test dependencies, not architectural coupling. Without this exclusion,
 * zones with many test files (e.g. E2E suites) produce misleading metrics
 * where test-file neighbors inflate internal/external edge counts.
 */
function computeZoneMetrics(
  files: string[],
  graph: Map<string, Map<string, number>>,
  testFiles: Set<string>,
): { cohesion: number; coupling: number } {
  const memberSet = new Set(files);
  let internalEdgeCount = 0;
  let totalEdgesFromZone = 0;
  let productionNodeCount = 0;
  for (const node of files) {
    if (testFiles.has(node)) continue;
    productionNodeCount++;
    const neighbors = graph.get(node);
    if (!neighbors) continue;
    for (const [neighbor] of neighbors) {
      if (testFiles.has(neighbor)) continue;
      totalEdgesFromZone++;
      if (memberSet.has(neighbor)) internalEdgeCount++;
    }
  }
  // A zone with ≤1 production files cannot form internal production edges,
  // so cohesion/coupling are structurally meaningless. Return healthy defaults
  // to avoid false-positive risk alerts on test-dominated or single-file zones.
  if (productionNodeCount <= 1) {
    return { cohesion: 1, coupling: 0 };
  }
  // Multiple production files but zero edges: files are completely isolated
  // from each other. Cohesion is 0 (no evidence of relatedness), not 1.
  // Returning 1 here would be a metric artifact — perfect cohesion should
  // require actual internal edges, not merely the absence of external ones.
  if (totalEdgesFromZone === 0) {
    return { cohesion: 0, coupling: 0 };
  }
  return {
    cohesion: Math.round((internalEdgeCount / totalEdgesFromZone) * 100) / 100,
    coupling: Math.round(((totalEdgesFromZone - internalEdgeCount) / totalEdgesFromZone) * 100) / 100,
  };
}

// ── Helper: compute entry points ─────────────────────────────────────────────

/** Find files imported from outside the given member set. */
function computeEntryPoints(
  memberSet: Set<string>,
  imports: Imports,
): string[] {
  const entryPoints: string[] = [];
  for (const edge of imports.edges) {
    if (memberSet.has(edge.to) && !memberSet.has(edge.from)) {
      if (!entryPoints.includes(edge.to)) {
        entryPoints.push(edge.to);
      }
    }
  }
  return entryPoints;
}

// ── Helper: build zones from communities ─────────────────────────────────────

/**
 * Convert Louvain community assignments into Zone objects with metrics.
 * Computes entry points, cohesion/coupling, and recursive subdivision.
 *
 * Cohesion/coupling are computed from `metricsGraph` (import edges only),
 * not from the clustering `graph` which includes proximity edges. This
 * prevents isolated files grouped by directory proximity from receiving
 * artificially perfect cohesion scores.
 *
 * When `parentId` is provided (subdivision), zone IDs are derived relative
 * to the parent and prefixed with `parentId/`. The `depth` parameter is
 * threaded to `subdivideZone` for recursion limiting.
 */
function buildZonesFromCommunities(
  community: Map<string, string>,
  graph: Map<string, Map<string, number>>,
  metricsGraph: Map<string, Map<string, number>>,
  imports: Imports,
  inventory: Inventory,
  testFiles: Set<string>,
  parentId?: string,
  depth: number = 0,
  maxMergeSize?: number,
  routeLayout?: RouteLayout,
): { zones: Zone[]; filenameBasedZoneIds: Set<string> } {
  const extraSkip = routeLayout?.genericSegments;
  const communityMembers = new Map<string, string[]>();
  for (const [node, comm] of community) {
    let list = communityMembers.get(comm);
    if (!list) {
      list = [];
      communityMembers.set(comm, list);
    }
    list.push(node);
  }

  const usedIds = new Set<string>();
  const zones: Zone[] = [];
  const filenameBasedZoneIds = new Set<string>();

  const sortedCommunities = [...communityMembers.entries()]
    .map(([comm, members]) => [comm, members.sort()] as const)
    .sort(([, a], [, b]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  for (const [communityId, members] of sortedCommunities) {
    // Quarantined-test communities have IDs of the form `tests:<suite>` from
    // deriveTestSuiteCommunity. The default `deriveZoneId` skips "tests" as
    // a generic segment, so a community whose files all live in a test
    // directory would collide with the production zone that shares the
    // adjacent segment (e.g. `tests/core/` derives to "core" which
    // collides with `src/core/`). Honor the community ID directly so test
    // zones get a stable test-flavored id (`tests-<suite>`).
    let id: string;
    if (communityId === "tests" || communityId.startsWith("tests:")) {
      id = testCommunityZoneId(communityId.slice("tests:".length), usedIds, extraSkip);
    } else {
      id = deriveZoneId(members, parentId, extraSkip);
      // Directory derivation fell through to a route-generic segment: flat
      // route files directly under the root. Name the zone after the route.
      if (routeLayout && extraSkip?.has(id)) {
        id = routeFeatureZoneId(members, routeLayout) ?? id;
      }
    }
    if (usedIds.has(id)) {
      const disambiguated = disambiguateZoneId(id, members, parentId, extraSkip);
      // One segment below the base was not enough (or was taken): walk the
      // shared directory prefix from its deepest segment up.
      const deeper = disambiguated !== id && !usedIds.has(disambiguated)
        ? undefined
        : deepestDistinguishingSegment(members, new Set([...SKIPPABLE_SEGMENTS, ...(extraSkip ?? []), id]), usedIds);
      if (disambiguated !== id && !usedIds.has(disambiguated)) {
        id = disambiguated;
      } else if (deeper) {
        id = deeper;
      } else {
        // Try filename-based derivation before merging or adding numeric suffix
        const filenameId = deriveZoneIdFromFilenames(members);
        if (filenameId && !usedIds.has(filenameId)) {
          id = filenameId;
          filenameBasedZoneIds.add(parentId ? `${parentId}/${id}` : id);
        } else {
          const stemId = deriveZoneIdFromFileStems(members, [
            id,
            ...(parentId ? parentId.split("/") : []),
          ]);
          if (stemId && !usedIds.has(stemId)) {
            id = stemId;
          } else {
          // Merge into existing zone instead of creating a numbered duplicate,
          // but only if the combined size doesn't exceed the zone size cap
          const targetId = parentId ? `${parentId}/${id}` : id;
          const existing = zones.find(z => z.id === targetId);
          if (existing && (!maxMergeSize || existing.files.length + members.length <= maxMergeSize)) {
            existing.files.push(...members);
            existing.files.sort();
            existing.description = describeZone(existing.files, inventory);
            const mergedSet = new Set(existing.files);
            existing.entryPoints = computeEntryPoints(mergedSet, imports);
            const metrics = computeZoneMetrics(existing.files, metricsGraph, testFiles);
            existing.cohesion = metrics.cohesion;
            existing.coupling = metrics.coupling;
            // Re-subdivide with merged files
            existing.subZones = undefined;
            const subZones = subdivideZone(existing, imports, inventory, testFiles, depth, routeLayout);
            if (subZones.length > 0) {
              existing.subZones = subZones;
            }
            continue; // Skip creating a new zone
          }
          // Fallback: numeric suffix when merge would exceed size cap
          let suffix = 2;
          while (usedIds.has(`${id}-${suffix}`)) suffix++;
          id = `${id}-${suffix}`;
          }
        }
      }
    }
    usedIds.add(id);

    // Prefix with parent zone ID for subdivision
    if (parentId) {
      id = `${parentId}/${id}`;
    }

    const memberSet = new Set(members);
    const entryPoints = computeEntryPoints(memberSet, imports);
    const { cohesion, coupling } = computeZoneMetrics(members, metricsGraph, testFiles);

    const zone: Zone = {
      id,
      // A sub-zone is named for itself, not its path ("Global Nav", not
      // "Components/global Nav"); the parent is already on screen around it.
      name: deriveZoneName(id.slice(id.lastIndexOf("/") + 1)),
      description: describeZone(members, inventory),
      files: members,
      entryPoints,
      cohesion,
      coupling,
      ...(depth > 0 ? { depth } : {}),
    };

    // Test zones are not subdivided: their structure mirrors the code's.
    const isTestCommunity = communityId === "tests" || communityId.startsWith("tests:");
    const subZones = isTestCommunity ? [] : subdivideZone(zone, imports, inventory, testFiles, depth, routeLayout);
    if (subZones.length > 0) {
      zone.subZones = subZones;
    }

    zones.push(zone);
  }

  return { zones, filenameBasedZoneIds };
}

// ── Helper: compute content hashes ───────────────────────────────────────────

/** Compute per-zone and global content hashes for stale-finding detection. */
function computeContentHashes(
  zones: Zone[],
  inventory: Inventory
): { zoneContentHashes: Record<string, string>; globalContentHash: string } {
  const fileHashes = new Map<string, string>();
  for (const f of inventory.files) {
    fileHashes.set(f.path, f.hash);
  }
  const zoneContentHashes: Record<string, string> = {};
  for (const zone of zones) {
    zoneContentHashes[zone.id] = computeZoneContentHash(zone, fileHashes);
  }
  const globalContentHash = computeGlobalContentHash(zoneContentHashes);
  return { zoneContentHashes, globalContentHash };
}

/**
 * Remap content hash keys from pre-enrichment zone IDs to post-enrichment IDs.
 *
 * Enrichment (AI or fast-mode preservation) may rename zone IDs. This function
 * builds a mapping by matching zones positionally (same index = same zone) and
 * returns a new hash record keyed by the final zone IDs.
 *
 * If no IDs changed, the original record is returned as-is for efficiency.
 */
function remapContentHashKeys(
  originalHashes: Record<string, string>,
  preEnrichmentZones: Zone[],
  postEnrichmentZones: Zone[],
): Record<string, string> {
  // Build old→new ID mapping. Zones are matched by array position since
  // enrichment preserves zone order and count.
  const idMap = new Map<string, string>();
  let anyChanged = false;
  const limit = Math.min(preEnrichmentZones.length, postEnrichmentZones.length);
  for (let i = 0; i < limit; i++) {
    const oldId = preEnrichmentZones[i].id;
    const newId = postEnrichmentZones[i].id;
    if (oldId !== newId) {
      anyChanged = true;
    }
    idMap.set(oldId, newId);
  }

  if (!anyChanged) return originalHashes;

  const remapped: Record<string, string> = {};
  for (const [key, hash] of Object.entries(originalHashes)) {
    const newKey = idMap.get(key) ?? key;
    remapped[newKey] = hash;
  }
  return remapped;
}

// ── Helper: AI enrichment ────────────────────────────────────────────────────

/** Result of enrichment or preservation of previous zone data. */
interface EnrichmentResult {
  finalZones: Zone[];
  aiZoneInsights: Map<string, string[]>;
  aiGlobalInsights: string[];
  aiFindings: Finding[];
  enrichmentPass: number;
  metaUpdatedFindings: Finding[] | null;
  enrichTokenUsage?: AnalyzeTokenUsage;
  /** Files of the zones the LLM actually enriched this pass — the ones worth a fragility judgment. */
  enrichedFiles?: Set<string>;
  /** The cascade already judged fragility; the assemble-time hook must not ask again. */
  fragilityJudged?: boolean;
  /** The cascade ran: descriptions are templated from facts and must survive identity preservation. */
  cascade?: boolean;
  /** Judgment-made findings that bypass the support/paraphrase judgment. */
  prejudgedFindings?: Finding[];
  /** Files of zones whose narration was deferred; mapped to final ids after pins. */
  deferredFiles?: Set<string>;
  /** Files of zones whose generated names were deferred; mapped to final ids after pins. */
  deferredNameFiles?: Set<string>;
}

/**
 * Run AI enrichment (per-zone or batch) or preserve previous zone names
 * when running in fast mode with unchanged structure.
 */
async function applyEnrichment(
  expandedZones: Zone[],
  imports: Imports,
  inventory: Inventory,
  validPrevious: Zones | undefined,
  enrich: boolean,
  perZone: boolean,
  fileArchetypes?: Map<string, string | null>,
  currentContentHashes?: Record<string, string>,
  hints?: string,
  projectProfile?: ProjectProfile,
  narrate = false,
  deferNarration = false,
): Promise<EnrichmentResult> {
  let finalZones = expandedZones;
  let aiZoneInsights = new Map<string, string[]>();
  let aiGlobalInsights: string[] = [];
  let aiFindings: Finding[] = [];
  let enrichmentPass = 0;
  let metaUpdatedFindings: Finding[] | null = null;
  let enrichTokenUsage: AnalyzeTokenUsage | undefined;
  let enrichedZoneIds: Set<string> | undefined;
  let enrichedFiles: Set<string> | undefined;
  let fragilityJudged = false;
  let cascadeRan = false;
  let prejudgedFindings: Finding[] | undefined;
  let deferredFiles: Set<string> | undefined;
  let deferredNameFiles: Set<string> | undefined;

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

    // The cascade (enrich-cascade.ts) is the default whenever a judgment
    // route resolves; --narrate forces the generative prompts over every
    // zone. Without a route this branch is never taken, so the no-key path
    // is exactly the one below.
    const cascade = !narrate && getJudgmentRoute("zone.judge") === "typesafe";
    if (cascade) {
      setRunMode("cascade");
      const result = await cascadeEnrichment(
        expandedZones, preCrossings, inventory, imports, validPrevious, fileArchetypes, hints, projectProfile,
        { deferNarration },
      );
      if (result.deferredZoneIds.size > 0) {
        deferredFiles = new Set(result.zones.filter((z) => result.deferredZoneIds.has(z.id)).flatMap((z) => z.files));
      }
      if (result.deferredNameZoneIds.size > 0) {
        deferredNameFiles = new Set(result.zones.filter((z) => result.deferredNameZoneIds.has(z.id)).flatMap((z) => z.files));
      }
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
      enrichedZoneIds = result.enrichedZoneIds;
      fragilityJudged = result.fragilityJudged;
      cascadeRan = true;
      prejudgedFindings = result.prejudgedFindings;
    } else if (perZone) {
      const result = await enrichZonesPerZone(
        expandedZones, preCrossings, inventory, imports, validPrevious, fileArchetypes, hints,
      );
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
      enrichedZoneIds = result.enrichedZoneIds;
    } else {
      const result = await enrichZonesWithAI(
        expandedZones, preCrossings, inventory, imports, validPrevious, fileArchetypes,
        currentContentHashes, hints, projectProfile,
      );
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
      enrichedZoneIds = result.enrichedZoneIds;
      if (result._updatedFindings) {
        metaUpdatedFindings = result._updatedFindings;
      }
    }

    // Zone ids can still change after this point (identity preservation,
    // pins), so remember the enriched zones by file rather than by id.
    if (enrichedZoneIds) {
      enrichedFiles = new Set(
        finalZones.filter((z) => enrichedZoneIds!.has(z.id)).flatMap((z) => z.files),
      );
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
        return { ...zone, id: prev.id, name: prev.name, description: prev.description };
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

  return {
    finalZones,
    aiZoneInsights,
    aiGlobalInsights,
    aiFindings,
    enrichmentPass,
    metaUpdatedFindings,
    enrichTokenUsage,
    enrichedFiles,
    fragilityJudged,
    cascade: cascadeRan,
    prejudgedFindings,
    deferredFiles,
    deferredNameFiles,
  };
}

// ── Helper: resolve directory-targeted edges ─────────────────────────────────

/**
 * Resolve an import-edge target to actual file paths.
 *
 * JS/TS imports target individual files — a direct `fileSet.has()` hit returns
 * the target unchanged. Go imports target package *directories* (e.g.
 * `internal/handler`), so when the target is missing from the file set we fall
 * back to prefix-matching to find all constituent files beneath that directory.
 *
 * @param target - edge target path (file or directory)
 * @param fileSet - set of all known file paths (typically zone files or inventory)
 * @returns matched file paths (empty when no match)
 */
export function resolveEdgeTarget(target: string, fileSet: Set<string>): string[] {
  // Direct match — JS/TS file-level imports, or any exact file path
  if (fileSet.has(target)) return [target];

  // Directory prefix match — Go package-level imports
  const prefix = target + "/";
  const matches: string[] = [];
  for (const file of fileSet) {
    if (file.startsWith(prefix)) matches.push(file);
  }
  return matches;
}

// ── Helper: build crossings ──────────────────────────────────────────────────

/** Build zone crossings from import edges and promoted sub-analysis crossings. */
function buildCrossings(
  allZones: Zone[],
  imports: Imports,
  promotedCrossings: ZoneCrossing[]
): ZoneCrossing[] {
  const fileToZone = new Map<string, string>();
  for (const zone of allZones) {
    for (const file of zone.files) fileToZone.set(file, zone.id);
  }
  const allFiles = new Set(fileToZone.keys());

  const crossings: ZoneCrossing[] = [...promotedCrossings];
  for (const edge of imports.edges) {
    const fromZone = fileToZone.get(edge.from);
    if (!fromZone) continue;

    const targets = resolveEdgeTarget(edge.to, allFiles);
    for (const target of targets) {
      const toZone = fileToZone.get(target);
      if (toZone && fromZone !== toZone) {
        crossings.push({ from: edge.from, to: target, fromZone, toZone });
      }
    }
  }
  return crossings;
}

// ── Helper: merge insights ───────────────────────────────────────────────────

/**
 * Merge zone insights: structural (fresh, deterministic) + accumulated AI
 * from previous runs + new AI from current enrichment.
 */
function mergeZoneInsights(
  finalZones: Zone[],
  structural: { zoneInsights: Map<string, string[]> },
  aiZoneInsights: Map<string, string[]>,
  validPrevious: Zones | undefined
): void {
  for (const zone of finalZones) {
    const structuralForZone = structural.zoneInsights.get(zone.id) ?? [];
    const newAiForZone = aiZoneInsights.get(zone.id) ?? [];

    let prevAi: string[] = [];
    if (validPrevious) {
      const prevZone = validPrevious.zones.find(
        (p) =>
          p.id === zone.id ||
          (p.files.length > 0 && p.files.some((f) => zone.files.includes(f)))
      );
      if (prevZone?.insights) {
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
}

/**
 * Merge global insights: structural + previous AI + new AI.
 * Returns the combined global insights array.
 */
function mergeGlobalInsights(
  structural: { globalInsights: string[] },
  aiGlobalInsights: string[],
  validPrevious: Zones | undefined
): string[] {
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

  return [
    ...structural.globalInsights,
    ...prevGlobalAi,
    ...aiGlobalInsights,
  ];
}

// ── Helper: assemble findings ────────────────────────────────────────────────

/**
 * Build the complete findings array: structural (pass 0) + preserved previous
 * AI findings + new AI findings. Handles stale-content detection and deduplication.
 */
function assembleFindings(
  finalZones: Zone[],
  structural: { zoneInsights: Map<string, string[]>; globalInsights: string[]; findings: Finding[] },
  aiFindings: Finding[],
  metaUpdatedFindings: Finding[] | null,
  validPrevious: Zones | undefined,
  previousZones: Zones | undefined,
  zoneContentHashes: Record<string, string>,
  globalContentHash: string
): Finding[] {
  const structuralFindings: Finding[] = [];

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
              : text.includes("Generic zone name")
                ? "warning"
                : "info",
      });
    }
  }

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

  // Check content staleness for preserved previous findings
  const prevContentHashes = previousZones?.zoneContentHashes;
  function isContentStale(finding: Finding): boolean {
    if (!prevContentHashes) return false;
    if (finding.scope === "global") {
      const prevGlobal = computeGlobalContentHash(prevContentHashes);
      return prevGlobal !== globalContentHash;
    }
    const prevHash = prevContentHashes[finding.scope];
    const currHash = zoneContentHashes[finding.scope];
    if (!prevHash || !currHash) return true;
    return prevHash !== currHash;
  }

  const prevAiFindings: Finding[] = [];
  if (metaUpdatedFindings) {
    for (const f of metaUpdatedFindings) {
      if (f.pass > 0 && !isContentStale(f)) {
        prevAiFindings.push(f);
      }
    }
  } else if (validPrevious?.findings) {
    for (const f of validPrevious.findings) {
      if (f.pass > 0 && !isContentStale(f)) {
        prevAiFindings.push(f);
      }
    }
  }

  return enforceSeverityRules(deduplicateFindings([...structuralFindings, ...structural.findings, ...prevAiFindings, ...aiFindings]));
}

// ── Helper: back-populate insights ───────────────────────────────────────────

/**
 * Ensure every finding's text appears in the appropriate insights array.
 * AI enrichment may produce structured findings without corresponding legacy
 * insight strings — this keeps backward compatibility for legacy consumers.
 */
function backPopulateInsights(
  finalZones: Zone[],
  allFindings: Finding[],
  allGlobalInsights: string[]
): void {
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
}

// ── Zone detection pipeline ──────────────────────────────────────────────────

/**
 * Maximum percentage of project files a single zone should contain.
 * Zones exceeding this threshold are split via internal Louvain subdivision.
 * Default: 15% — prevents over-aggregation where one zone dominates the codebase.
 */
export const DEFAULT_MAX_ZONE_PERCENT = 15;

/**
 * Run the full zone detection pipeline: graph construction, Louvain community
 * detection, community merging/splitting, zone construction with subdivision,
 * proximity assignment, and crossing computation.
 *
 * This is the shared pipeline used by both root-level analysis and (future)
 * recursive zone subdivision.
 */
export function runZonePipeline(options: ZonePipelineOptions): ZonePipelineResult {
  const {
    edges,
    inventory,
    imports,
    scopeFiles,
    maxZones = 30,
    maxZonePercent = DEFAULT_MAX_ZONE_PERCENT,
    parentId,
    depth = 0,
    testFiles = new Set<string>(),
    zonePins,
    smallZoneMergeThreshold = 3,
    previousZoneAssignment,
    stabilityWeight = 0.5,
    routeLayout,
    resolution = 1.0,
    presetCommunity,
    quarantineTests: quarantine = true,
  } = options;

  // ── Resolve directory-targeted edges ──
  // Go import edges target package directories (e.g. "internal/handler") rather
  // than individual files. Expand these to per-file edges so Louvain clusters
  // real files instead of phantom directory nodes.
  const scopeFileSet = new Set(scopeFiles);
  const resolvedEdges: ImportEdge[] = [];
  for (const edge of edges) {
    const targets = resolveEdgeTarget(edge.to, scopeFileSet);
    if (targets.length === 0 || (targets.length === 1 && targets[0] === edge.to)) {
      resolvedEdges.push(edge);
    } else {
      for (const t of targets) {
        resolvedEdges.push({ ...edge, to: t });
      }
    }
  }

  // ── Build undirected graph ──
  const graph = buildUndirectedGraph(resolvedEdges);

  // Snapshot the import-only graph for metrics computation. Proximity edges
  // exist to help Louvain cluster disconnected files but they are NOT
  // evidence of architectural cohesion — inflating cohesion for zones
  // whose files share a directory but never import each other.
  const importOnlyGraph: Map<string, Map<string, number>> = new Map();
  for (const [node, neighbors] of graph) {
    importOnlyGraph.set(node, new Map(neighbors));
  }

  // ── Add directory proximity edges ──
  // Only for files not already in the import graph, and only those sharing
  // a directory with at least one other non-import file. Files with imports
  // are clustered purely by import structure; files without imports get
  // proximity-based grouping among themselves.
  const importGraphNodes = new Set(graph.keys());
  const nonImportFiles = scopeFiles.filter(f => !importGraphNodes.has(f));

  const nonImportDirCounts = new Map<string, number>();
  for (const f of nonImportFiles) {
    const lastSlash = f.lastIndexOf("/");
    const dir = lastSlash === -1 ? "." : f.slice(0, lastSlash);
    nonImportDirCounts.set(dir, (nonImportDirCounts.get(dir) ?? 0) + 1);
  }
  const clusterableNonImportFiles = nonImportFiles.filter(f => {
    const lastSlash = f.lastIndexOf("/");
    const dir = lastSlash === -1 ? "." : f.slice(0, lastSlash);
    return (nonImportDirCounts.get(dir) ?? 0) >= 2;
  });
  addDirectoryProximityEdges(graph, clusterableNonImportFiles);

  // ── Route features ──
  // Route modules are wired by path, not by importing each other; tie each
  // route feature's files together so shared-component imports do not decide
  // the grouping. Added after the import-only snapshot, like proximity edges.
  if (routeLayout) addRouteFeatureEdges(graph, scopeFiles, routeLayout);

  // ── Add co-zone stability bias from previous run ──
  // When previous zones exist, add synthetic edges between files that shared
  // a zone. This biases Louvain toward preserving the previous topology while
  // still allowing genuine import changes to override the bias.
  if (previousZoneAssignment && previousZoneAssignment.size > 0 && stabilityWeight > 0) {
    addStabilityEdges(graph, importOnlyGraph, previousZoneAssignment, stabilityWeight);
  }

  // ── Quarantine tests from production partitioning (selective) ──
  // Tests routinely import production code heavily — `XYZTests.swift`
  // touches every type in `XYZ.swift`, which makes Louvain glue tests to
  // their subjects' zones. We strip those tests from the Louvain input and
  // drop them into their own per-suite zone(s).
  //
  // BUT: only when the tests live in a TEST-ONLY directory. Go convention
  // puts `user_test.go` next to `user.go` inside `internal/handler/`; that
  // package boundary IS the architectural unit and the test belongs with
  // it. So a test file whose directory also contains production files is
  // a "colocated" test and stays with its package.
  const productionDirs = new Set<string>();
  for (const f of scopeFiles) {
    if (testFiles.has(f)) continue;
    const slash = f.lastIndexOf("/");
    productionDirs.add(slash === -1 ? "" : f.slice(0, slash));
  }
  const quarantineTests = new Set<string>();
  for (const t of quarantine ? testFiles : []) {
    if (!scopeFileSet.has(t)) continue;
    const slash = t.lastIndexOf("/");
    const dir = slash === -1 ? "" : t.slice(0, slash);
    if (!productionDirs.has(dir)) quarantineTests.add(t);
  }
  // Filter AFTER proximity + stability edges are added so production files
  // without imports still appear in productionGraph via proximity links.
  const productionGraph: Map<string, Map<string, number>> = new Map();
  for (const [node, neighbors] of graph) {
    if (quarantineTests.has(node)) continue;
    const filtered = new Map<string, number>();
    for (const [n, w] of neighbors) {
      if (quarantineTests.has(n)) continue;
      filtered.set(n, w);
    }
    productionGraph.set(node, filtered);
  }
  // Ensure non-quarantined scope files with NO edges at all still get
  // partitioned (would otherwise be dropped on the floor by Louvain and
  // re-collected as "unzoned" with no chance to land in a real zone).
  for (const f of scopeFiles) {
    if (quarantineTests.has(f)) continue;
    if (!productionGraph.has(f)) productionGraph.set(f, new Map());
  }

  // ── Scale maxZones by file count ──
  // Small packages shouldn't fragment into many zones. Scale from 3 (≤36 files)
  // up to the configured cap (default 30 at 360+ files).
  // Also ensure we allow enough zones for the size policy to work —
  // if maxZonePercent limits zone size, we need at least ceil(n/maxSize) zones.
  // graphNodeCount reflects the partitioning surface (production only) so
  // maxZoneSize stays relative to the code that's actually being clustered.
  const graphNodeCount = productionGraph.size;
  const scaledByCount = Math.max(3, Math.floor(graphNodeCount / 12));
  const maxPct = Math.max(1, Math.min(100, maxZonePercent));
  const maxZoneSize = Math.max(3, Math.ceil(graphNodeCount * maxPct / 100));
  const minForSizePolicy = maxPct < 100 ? Math.ceil(graphNodeCount / maxZoneSize) : 0;
  const scaledMaxZones = Math.min(maxZones, Math.max(scaledByCount, minForSizePolicy));

  // ── Louvain community detection (production only) ──
  const smallZoneMergeLog: MergeLogEntry[] = [];
  let community: Map<string, string>;
  if (presetCommunity) {
    community = new Map();
    for (const node of productionGraph.keys()) {
      const c = presetCommunity.get(node);
      if (c !== undefined) community.set(node, c);
    }
  } else {
    community = louvainPhase1(productionGraph, 100, resolution, previousZoneAssignment);
    community = mergeBidirectionalCoupling(community, productionGraph);
    community = mergeSmallCommunities(community, productionGraph, smallZoneMergeThreshold, smallZoneMergeLog);
    community = mergeSatelliteCommunities(community, productionGraph);
    community = capZoneCount(community, productionGraph, scaledMaxZones, maxPct < 100 ? maxZoneSize : undefined);

    // ── Split oversized communities (production only) ──
    community = splitLargeCommunities(community, productionGraph, maxZoneSize);

    mergeSameIdCommunities(community, maxPct < 100 ? maxZoneSize : undefined, routeLayout?.genericSegments);
    community = capZoneCount(community, productionGraph, scaledMaxZones, maxPct < 100 ? maxZoneSize : undefined);  // re-cap after split
  }

  // ── Drop quarantined tests into their own per-suite zones ──
  // Group quarantined test files by their top-level Tests/<suite>/ prefix
  // so multi-target projects (e.g. GoToBedCoreTests + GoToBedTests) get a
  // zone per suite rather than one mega-tests zone. Colocated tests
  // (`internal/foo/*_test.go`) stayed in productionGraph and are already
  // partitioned alongside their package.
  const testAssignments = new Map<string, string>();
  for (const testFile of quarantineTests) {
    testAssignments.set(testFile, deriveTestSuiteCommunity(testFile));
  }
  foldSmallTestCommunities(testAssignments, smallZoneMergeThreshold);
  for (const [testFile, c] of testAssignments) community.set(testFile, c);

  // ── Build zones from communities ──
  const { zones, filenameBasedZoneIds } = buildZonesFromCommunities(
    community, graph, importOnlyGraph, imports, inventory, testFiles, parentId, depth,
    maxPct < 100 ? maxZoneSize : undefined, routeLayout,
  );

  // ── Assign unzoned files by directory proximity ──
  const zonedFiles = new Set<string>();
  for (const zone of zones) {
    for (const f of zone.files) zonedFiles.add(f);
  }
  const initialUnzoned = scopeFiles.filter(f => !zonedFiles.has(f));
  const { zones: expandedZones, remaining: unzoned } = assignByProximity(
    zones, initialUnzoned, maxPct < 100 ? maxZoneSize : undefined,
  );

  // ── Apply zone pins ──
  const pinnedZones = zonePins && Object.keys(zonePins).length > 0
    ? applyZonePins(expandedZones, zonePins)
    : expandedZones;

  // ── Build crossings ──
  const crossings = buildCrossings(pinnedZones, imports, []);

  return { zones: pinnedZones, crossings, unzoned, filenameBasedZoneIds, smallZoneMergeLog };
}

// ── Non-importable file extensions ────────────────────────────────────────────

/**
 * File extensions that cannot form import edges in any JS/TS module system.
 * Including these in zone detection produces noise zones (e.g. logo, web-landing)
 * with false-positive 'at-risk' labels and distorted cohesion scores of 0.
 */
const NON_IMPORTABLE_EXTENSIONS = new Set([
  // Binary image assets
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".avif", ".bmp", ".tiff",
  // Vector and font assets
  ".svg", ".woff", ".woff2", ".ttf", ".otf", ".eot",
  // Media assets
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".pdf",
  // Markup and style (not importable as modules)
  ".html", ".htm", ".css", ".scss", ".less", ".sass",
  // Data and documentation
  ".md", ".mdx", ".json", ".yaml", ".yml", ".toml",
  // Lock files
  ".lock",
]);

// ── Helper: prepare scope and edges ──────────────────────────────────────────

/** Filter sub-analyzed files from edges/inventory and build the test file set. */
function prepareScopeAndEdges(
  inventory: Inventory,
  imports: Imports,
  subAnalyses: SubAnalysis[],
): {
  filteredEdges: ImportEdge[];
  scopeFiles: string[];
  testFiles: Set<string>;
  subAnalyzedPrefixes: string[];
} {
  const subAnalyzedPrefixes = getSubAnalyzedPrefixes(subAnalyses);
  const filteredEdges = subAnalyzedPrefixes.length > 0
    ? imports.edges.filter(
        (e) =>
          !isSubAnalyzedFile(e.from, subAnalyzedPrefixes) &&
          !isSubAnalyzedFile(e.to, subAnalyzedPrefixes)
      )
    : imports.edges;

  const scopeFiles = inventory.files
    .filter(f => !isSubAnalyzedFile(f.path, subAnalyzedPrefixes))
    .filter(f => !NON_IMPORTABLE_EXTENSIONS.has(extname(f.path).toLowerCase()))
    .map(f => f.path);

  const testFiles = new Set<string>();
  for (const f of inventory.files) {
    if (f.role === "test") testFiles.add(f.path);
  }

  return { filteredEdges, scopeFiles, testFiles, subAnalyzedPrefixes };
}

// ── Helper: promote sub-analyses ─────────────────────────────────────────────

/**
 * Promote zones and crossings from sub-analyses into the root zone list.
 * Also resolves workspace member npm imports (e.g. `@n-dx/llm-client`) into
 * zone crossings so foundation-tier coupling is visible in the monorepo graph.
 */
function promoteSubAnalyses(
  subAnalyses: SubAnalysis[],
  pinnedFinalZones: Zone[],
): { allZones: Zone[]; promotedCrossings: ZoneCrossing[] } {
  const promotedZones: Zone[] = [];
  const promotedCrossings: ZoneCrossing[] = [];
  for (const sub of subAnalyses) {
    promotedZones.push(...promoteZones(sub));
    promotedCrossings.push(...promoteCrossings(sub));
  }
  const allZones = dedupeZonesById([...pinnedFinalZones, ...promotedZones]);

  if (subAnalyses.length > 0) {
    const packageMap = buildPackageMap(subAnalyses);
    const crossRepoCrossings = computeCrossRepoCrossings(
      subAnalyses, allZones, packageMap,
    );
    promotedCrossings.push(...crossRepoCrossings);
  }

  return { allZones, promotedCrossings };
}

function dedupeZonesById(zones: Zone[]): Zone[] {
  const seen = new Set<string>();
  const out: Zone[] = [];
  for (const zone of zones) {
    if (seen.has(zone.id)) continue;
    seen.add(zone.id);
    out.push(zone);
  }
  return out;
}

// ── Helper: skipped-pin findings ─────────────────────────────────────────────

/**
 * Turn un-appliable zone pins into visible warnings. The dominant case is
 * `target-zone-absent`: the pin's target zone did not form in this Louvain
 * run, so the pinned files silently fell back elsewhere — previously this was
 * only detectable by diffing `zones.json` (see issue #210).
 */
function computeSkippedPinFindings(skipped: ZonePinSkip[]): Finding[] {
  if (skipped.length === 0) return [];
  const findings: Finding[] = [];

  const absentByZone = new Map<string, string[]>();
  const unzoned: ZonePinSkip[] = [];
  for (const s of skipped) {
    if (s.reason === "target-zone-absent") {
      const list = absentByZone.get(s.targetZoneId) ?? [];
      list.push(s.file);
      absentByZone.set(s.targetZoneId, list);
    } else {
      unzoned.push(s);
    }
  }

  for (const [zoneId, files] of [...absentByZone.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const sorted = [...files].sort();
    const shown = sorted.slice(0, 8).join(", ");
    const more = sorted.length > 8 ? `, +${sorted.length - 8} more` : "";
    findings.push({
      type: "anti-pattern",
      pass: 0,
      scope: "global",
      severity: "warning",
      category: "structural",
      text:
        `Zone pin target "${zoneId}" did not form this analysis run — ` +
        `${sorted.length} pin(s) skipped and those files fell back to their Louvain zone. ` +
        `Single-target consolidations to "${zoneId}" are non-deterministic until it is a stable anchor. ` +
        `Skipped: ${shown}${more}.`,
      related: [zoneId, ...sorted],
    });
  }

  for (const s of unzoned.sort((a, b) => a.file.localeCompare(b.file))) {
    findings.push({
      type: "anti-pattern",
      pass: 0,
      scope: "global",
      severity: "info",
      category: "structural",
      text: `Zone pin for "${s.file}" → "${s.targetZoneId}" skipped: the file is not present in any detected zone (out of scope or unzoned).`,
      related: [s.file, s.targetZoneId],
    });
  }

  return findings;
}

/** Warn when a declared anchor's globs matched zero files. */
function computeEmptyAnchorFindings(emptyAnchors: readonly ZoneAnchor[]): Finding[] {
  return [...emptyAnchors]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => ({
      type: "anti-pattern" as const,
      pass: 0,
      scope: "global",
      severity: "warning" as const,
      category: "structural" as const,
      text:
        `Declared zone anchor "${a.id}" matched no files (include: ${a.include.join(", ")}). ` +
        `The anchor zone will not exist, so pins targeting "${a.id}" will be skipped — ` +
        `fix the glob or remove the anchor.`,
      related: [a.id],
    }));
}

// ── Helper: move recommendations ─────────────────────────────────────────────

/** Detect pin divergence and import-neighbor move recommendations. */
function computeMoveFindings(
  pinnedFinalZones: Zone[],
  crossings: ZoneCrossing[],
  edges: ImportEdge[],
  zonePins: Record<string, string>,
): Finding[] {
  const rootCrossings = crossings.filter(
    (c) => !c.fromZone.includes(":") && !c.toZone.includes(":"),
  );
  const moveCtx: MoveContext = {
    zones: pinnedFinalZones,
    crossings: rootCrossings,
    edges,
    zonePins,
  };
  return [
    ...detectPinDivergence(moveCtx),
    ...detectImportNeighborMoves(moveCtx),
  ];
}

// ── Zone stability computation ───────────────────────────────────────────────

/**
 * Compute zone stability metrics by comparing new zones against previous zones.
 */
export function computeZoneStability(
  newZones: Zone[],
  previousZones: Zone[],
): ZoneStability {
  // Build file→zone maps
  const prevFileZone = new Map<string, string>();
  const prevZoneIds = new Set<string>();
  for (const z of previousZones) {
    prevZoneIds.add(z.id);
    for (const f of z.files) prevFileZone.set(f, z.id);
  }

  // A zone renamed from a numbered id is the same zone: map its old id to
  // the new one so the rename is not counted as a removal plus an addition.
  const canonical = new Map<string, string>();
  for (const z of newZones) for (const prev of z.previousIds ?? []) canonical.set(prev, z.id);
  for (const [f, id] of prevFileZone) prevFileZone.set(f, canonical.get(id) ?? id);
  for (const [prev, now] of canonical) {
    if (prevZoneIds.delete(prev)) prevZoneIds.add(now);
  }

  const newZoneIds = new Set(newZones.map(z => z.id));

  // File retention: files present in both runs that kept the same zone
  let retained = 0;
  let comparable = 0;
  const reassigned: [string, string, string][] = [];

  for (const z of newZones) {
    for (const f of z.files) {
      const prevZone = prevFileZone.get(f);
      if (prevZone !== undefined) {
        comparable++;
        if (prevZone === z.id) {
          retained++;
        } else {
          reassigned.push([f, prevZone, z.id]);
        }
      }
    }
  }

  // Zone persistence
  let persisted = 0;
  for (const id of newZoneIds) {
    if (prevZoneIds.has(id)) persisted++;
  }
  const newCount = newZoneIds.size - persisted;
  const removedCount = prevZoneIds.size - persisted;

  return {
    fileRetention: comparable > 0 ? Math.round((retained / comparable) * 100) / 100 : 1,
    persistedZones: persisted,
    newZones: newCount,
    removedZones: removedCount,
    reassignedFiles: reassigned,
  };
}

// ── Helper: build final result ───────────────────────────────────────────────

/** Assemble the final AnalyzeZonesResult with sorted zones data. */
function buildAnalyzeZonesResult(opts: {
  allZones: Zone[];
  crossings: ZoneCrossing[];
  unzoned: string[];
  allGlobalInsights: string[];
  allFindings: Finding[];
  enrichmentPass: number;
  structureHash: string;
  inputFingerprint: string;
  remappedContentHashes: Record<string, string>;
  previousZones: Zones | undefined;
  structureChanged: boolean;
  enrichTokenUsage: AnalyzeTokenUsage | undefined;
  stability?: ZoneStability;
  pendingNarration?: string[];
  pendingNames?: string[];
  partitionReview?: PartitionReview;
  areas?: ZoneArea[];
  enrichmentMode?: Zones["enrichmentMode"];
}): AnalyzeZonesResult {
  const {
    allZones, crossings, unzoned, allGlobalInsights, allFindings,
    enrichmentPass, structureHash, inputFingerprint, remappedContentHashes,
    previousZones, structureChanged, enrichTokenUsage, stability, pendingNarration, pendingNames,
    partitionReview, areas, enrichmentMode,
  } = opts;

  const prevMetaCount = previousZones?.metaEvaluationCount ?? 0;
  const metaEvaluationCount = enrichmentPass >= 5
    ? prevMetaCount + 1
    : prevMetaCount > 0 ? prevMetaCount : undefined;
  const displayPass = enrichmentPass > 4 ? 4 : enrichmentPass;
  const lastReset = (structureChanged && previousZones?.enrichmentPass)
    ? { from: previousZones.enrichmentPass, to: 1 }
    : undefined;

  return {
    zones: sortZonesData({
      zones: allZones,
      crossings,
      unzoned,
      insights: allGlobalInsights.length > 0 ? allGlobalInsights : undefined,
      findings: allFindings.length > 0 ? allFindings : undefined,
      enrichmentPass: enrichmentPass > 0 ? displayPass : undefined,
      ...(enrichmentPass > 0 && enrichmentMode ? { enrichmentMode } : {}),
      ...(metaEvaluationCount ? { metaEvaluationCount } : {}),
      structureHash,
      inputFingerprint,
      zoneContentHashes: remappedContentHashes,
      ...(lastReset ? { lastReset } : {}),
      ...(stability ? { stability } : {}),
      ...(partitionReview ? { partitionReview } : {}),
      algorithmVersion: ZONE_ALGORITHM_VERSION,
      ...(areas && areas.length > 0 ? { areas } : {}),
    }),
    tokenUsage: enrichTokenUsage,
    structureChanged,
    ...(pendingNarration && pendingNarration.length > 0 ? { pendingNarration } : {}),
    ...(pendingNames && pendingNames.length > 0 ? { pendingNames } : {}),
  };
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
    /** Called when structure change is detected, before AI enrichment begins. */
    onReset?: (fromPass: number, toPass: number) => void;
    /** File archetype classifications for enrichment prompts. */
    fileArchetypes?: Map<string, string | null>;
    /** Project context from .sourcevision/hints.md, injected into enrichment prompts. */
    hints?: string;
    /**
     * Maximum percentage of project files a single zone may contain (1–100).
     * Zones exceeding this are split via internal Louvain subdivision.
     * Default: {@link DEFAULT_MAX_ZONE_PERCENT} (15%).
     * Set to `100` to disable the zone size cap.
     */
    maxZonePercent?: number;
    /**
     * Manual zone overrides: file path → target zone ID.
     * Passed through to the zone pipeline to override Louvain placement.
     */
    zonePins?: Record<string, string>;
    /**
     * Minimum zone size for small-zone merge. Zones below this are auto-merged.
     * Default: 3. Configurable via `sourcevision.zones.mergeThreshold` in `.n-dx.json`.
     */
    smallZoneMergeThreshold?: number;
    /**
     * Declared zone anchors: zones forced to exist from a file glob so that
     * single-target pin consolidations are deterministic across runs.
     * Configured in `.n-dx.json` under `sourcevision.zones.anchors`.
     */
    zoneAnchors?: ZoneAnchor[];
    /**
     * Skip Louvain zone detection and reuse the zone structure from previousZones.
     * Used by --full enrichment passes to avoid non-deterministic re-partitioning.
     */
    reuseStructure?: boolean;
    /**
     * Force the generative enrichment prompts over every zone even when a
     * judgment route would otherwise select the cascade (`--narrate`).
     */
    narrate?: boolean;
    /** Cascade only: leave escalated zones for `sv narrate`; their final ids come back in `pendingNarration`. */
    deferNarration?: boolean;
    /**
     * Detected project profile (frameworks, release infra, import-graph quality).
     * Forwarded to the AI enrichment prompt so the LLM can suppress
     * recommendations that contradict the project's actual shape.
     */
    projectProfile?: ProjectProfile;
  }
): Promise<AnalyzeZonesResult> {
  const enrich = options?.enrich ?? true;
  const perZone = options?.perZone ?? false;
  const previousZones = options?.previousZones;
  const subAnalyses = options?.subAnalyses ?? [];

  // ── Prepare scope ──
  const { filteredEdges, scopeFiles, testFiles, subAnalyzedPrefixes } =
    prepareScopeAndEdges(inventory, imports, subAnalyses);

  let expandedZones: Zone[];
  let unzoned: string[];
  let filenameBasedZoneIds: Set<string> | undefined;
  let structureHash: string;
  let structureChanged: boolean;

  const inventoryPaths = inventory.files.map((f) => f.path);
  const routeLayout = buildRouteLayout(inventoryPaths, detectRouteConventions(inventoryPaths));

  const inputFingerprint = computeInputFingerprint(
    inventory,
    options?.zonePins,
    options?.smallZoneMergeThreshold,
    options?.maxZonePercent,
    options?.zoneAnchors,
  );

  // Reuse the previous zone partition when the caller explicitly asks for it
  // (--full enrichment passes) OR when the analysis inputs are byte-identical
  // to the previous run. The latter prevents non-deterministic Louvain from
  // re-partitioning — and thus resetting enrichmentPass to 1 — on a no-op
  // re-analyze where no code or zone config changed.
  const inputsUnchanged =
    !!previousZones?.zones?.length &&
    !!previousZones.structureHash &&
    previousZones.inputFingerprint === inputFingerprint;

  // A previous partition is reused (inputs unchanged) or seeds Louvain
  // (inputs changed) only after it passes review — otherwise a fragmented
  // partition is frozen across runs and upgrades. An explicit reuse request
  // (--full passes within one analyze) skips the review.
  let partitionReview: PartitionReview | undefined = previousZones?.partitionReview;
  let trustPrevious = true;
  let freshReview = false;
  // A partition from another algorithm version is neither reused nor used as
  // the stability seed: seeding would pull the new algorithm back toward the
  // old grouping, which is exactly what the version bump is meant to escape.
  const algorithmChanged =
    !!previousZones?.zones?.length && previousZones.algorithmVersion !== ZONE_ALGORITHM_VERSION;
  if (algorithmChanged && !options?.reuseStructure) {
    trustPrevious = false;
    partitionReview = undefined;
    console.log(`  [partition] zone algorithm changed (v${previousZones?.algorithmVersion ?? "?"} → v${ZONE_ALGORITHM_VERSION}) — re-partitioned without stability bias`);
  } else if (previousZones?.zones?.length && !options?.reuseStructure) {
    const decision = await reviewPreviousPartition(previousZones, inputFingerprint, { maxZonePercent: options?.maxZonePercent });
    partitionReview = decision.review;
    trustPrevious = decision.trustPrevious;
    freshReview = decision.fresh;
  }
  const reuseStructure = (options?.reuseStructure ?? false) || (inputsUnchanged && trustPrevious);

  if (reuseStructure && previousZones) {
    // Reuse existing zone structure — skip Louvain to avoid non-deterministic
    // re-partitioning that resets enrichmentPass on every --full iteration.
    expandedZones = previousZones.zones.map((z) => ({ ...z }));
    unzoned = previousZones.unzoned ?? [];
    filenameBasedZoneIds = undefined;
    structureHash = previousZones.structureHash ?? computeStructureHash(expandedZones);
    structureChanged = false;
  } else {
    // ── Build previous zone assignment for stability bias ──
    let previousZoneAssignment: Map<string, string> | undefined;
    if (previousZones?.zones && trustPrevious) {
      previousZoneAssignment = new Map<string, string>();
      for (const zone of previousZones.zones) {
        for (const file of zone.files) {
          previousZoneAssignment.set(file, zone.id);
        }
      }
    }

    // ── Run zone detection pipeline ──
    const pipeline = runZonePipeline({
      routeLayout,
      edges: filteredEdges,
      inventory,
      imports,
      scopeFiles,
      maxZonePercent: options?.maxZonePercent,
      testFiles,
      zonePins: options?.zonePins,
      smallZoneMergeThreshold: options?.smallZoneMergeThreshold,
      previousZoneAssignment,
    });
    const mergeLog = pipeline.smallZoneMergeLog;
    expandedZones = pipeline.zones;
    unzoned = pipeline.unzoned;
    filenameBasedZoneIds = pipeline.filenameBasedZoneIds;

    // Log small-zone merge decisions for debuggability
    if (mergeLog.length > 0) {
      for (const entry of mergeLog) {
        console.log(`  [zones] merged small zone "${entry.smallCommunity}" (${entry.memberCount} files) → "${entry.mergedInto}" (import weight: ${entry.importWeight})`);
      }
    }

    // ── Structure hash & change detection ──
    structureHash = computeStructureHash(expandedZones);
    structureChanged = previousZones?.structureHash !== structureHash;
    if (partitionReview?.rejected && !trustPrevious) {
      partitionReview = { ...partitionReview, after: assessPartitionHealth(expandedZones, options?.maxZonePercent) };
    }
  }
  if (partitionReview && freshReview) {
    const line = formatPartitionLine(partitionReview);
    if (line) console.log(line);
    recordPartitionReview({ ...partitionReview, reused: reuseStructure });
  }

  // After an algorithm change the previous zones' ids are the old derivation's;
  // their enrichment is not valid for the new ids even when file sets match.
  // Chosen names still carry over through identity preservation below.
  const validPrevious = structureChanged || algorithmChanged ? undefined : previousZones;

  if (structureChanged && previousZones?.enrichmentPass && options?.onReset) {
    options.onReset(previousZones.enrichmentPass, 1);
  }

  // ── Content hashes for stale-finding detection ──
  const { zoneContentHashes, globalContentHash } =
    computeContentHashes(expandedZones, inventory);

  // ── AI enrichment or preserve previous ──
  const enrichResult = await applyEnrichment(
    expandedZones, imports, inventory, validPrevious, enrich, perZone, options?.fileArchetypes,
    zoneContentHashes, options?.hints, options?.projectProfile, options?.narrate === true,
    options?.deferNarration === true,
  );
  const { finalZones: enrichedZones, aiZoneInsights, aiGlobalInsights,
    enrichmentPass, metaUpdatedFindings, enrichedFiles, fragilityJudged } = enrichResult;
  let { aiFindings, enrichTokenUsage } = enrichResult;

  // ── Preserve previous zone identity for high-overlap zones ──
  let finalZones = previousZones
    ? preservePreviousZoneIdentity(
        enrichedZones,
        previousZones.zones,
        trustPrevious ? ZONE_OVERLAP_THRESHOLD : REJECTED_PARTITION_OVERLAP_THRESHOLD,
        { keepIds: algorithmChanged },
      )
    : enrichedZones;
  if (enrichResult.cascade && previousZones) {
    finalZones = reapplyCascadeLabels(finalZones, enrichedZones);
  }
  // Preservation can hand two zones the same name; the smaller falls back.
  finalZones = dedupeZoneNames(finalZones);

  // ── Sub-zone names, at every depth ──
  let pendingSubZoneNames: string[] = [];
  if (enrich) {
    const sub = await nameSubZones(finalZones, {
      projectDir: options?.projectProfile?.projectDir,
      fileArchetypes: options?.fileArchetypes,
      routeLayout,
      previous: previousZones?.zones,
      defer: options?.deferNarration === true,
    });
    finalZones = sub.zones;
    pendingSubZoneNames = sub.pending;
  }

  // ── Numbered ids follow chosen names ──
  const idRename = idsFollowNames(finalZones);
  if (idRename.renamed.size > 0) {
    finalZones = idRename.zones;
    aiFindings = renameZoneRefs(aiFindings, idRename.renamed);
    for (const [from, to] of idRename.renamed) {
      const ins = aiZoneInsights.get(from);
      if (ins) { aiZoneInsights.delete(from); aiZoneInsights.set(to, ins); }
      console.log(`  [zones] id follows name: "${from}" → "${to}"`);
    }
  }

  // ── Remap content hashes to post-enrichment zone IDs ──
  const remappedContentHashes = remapContentHashKeys(
    zoneContentHashes, expandedZones, finalZones,
  );

  // ── Force declared anchor zones to exist (before pins resolve) ──
  const { zones: anchoredZones, emptyAnchors } =
    options?.zoneAnchors && options.zoneAnchors.length > 0
      ? assertAnchorZones(finalZones, options.zoneAnchors, scopeFiles, imports)
      : { zones: finalZones, emptyAnchors: [] as ZoneAnchor[] };

  // ── Apply zone pins (post-enrichment) ──
  const skippedPins: ZonePinSkip[] = [];
  const pinnedFinalZones = options?.zonePins && Object.keys(options.zonePins).length > 0
    ? applyZonePins(anchoredZones, options.zonePins, skippedPins)
    : anchoredZones;

  // ── Promote sub-analyses and build crossings ──
  const { allZones, promotedCrossings } =
    promoteSubAnalyses(subAnalyses, pinnedFinalZones);
  const crossings = buildCrossings(allZones, imports, promotedCrossings);

  // ── Generate structural insights + move recommendations ──
  const rootFileCount = inventory.files.filter(
    (f) => !isSubAnalyzedFile(f.path, subAnalyzedPrefixes)
  ).length;
  const structural = generateStructuralInsights(
    pinnedFinalZones,
    crossings.filter((c) => !c.fromZone.includes(":") && !c.toZone.includes(":")),
    imports,
    rootFileCount,
    undefined,
    filenameBasedZoneIds,
  );
  structural.findings.push(
    ...computeMoveFindings(pinnedFinalZones, crossings, imports.edges, options?.zonePins ?? {}),
    ...computeSkippedPinFindings(skippedPins),
    ...computeEmptyAnchorFindings(emptyAnchors),
  );

  // ── Move judgment (enrich-judge.ts) ──
  // Where do the most cross-linked files belong? Inert without a route.
  const moves = await judgeMoves(pinnedFinalZones, crossings, Math.max(1, enrichmentPass));
  structural.findings.push(...moves.findings);
  if (moves.calls > 0) {
    enrichTokenUsage ??= emptyAnalyzeTokenUsage();
    enrichTokenUsage.calls += moves.calls;
    enrichTokenUsage.inputTokens += moves.tokenUsage?.input ?? 0;
    enrichTokenUsage.outputTokens += moves.tokenUsage?.output ?? 0;
  }

  // ── Judgment step (enrich-judge.ts) ──
  // After extraction, before assembleFindings' enforceSeverityRules, for every
  // enrichment mode at once. Inert without a judgment route. Here — not inside
  // applyEnrichment — because the evidence a finding is judged against
  // (post-rename crossings, heuristic findings) only exists at this point.
  const judged = await judgeFindings(aiFindings, {
    zones: pinnedFinalZones,
    crossings,
    heuristics: structural.findings,
    projectDir: options?.projectProfile?.projectDir,
  });
  const fragilityZones = enrichedFiles && !fragilityJudged
    ? pinnedFinalZones.filter((z) => z.files.some((f) => enrichedFiles.has(f)))
    : [];
  const fragility = await judgeZoneFragility(fragilityZones, crossings, enrichmentPass);
  aiFindings = [...judged.findings, ...fragility.findings, ...(enrichResult.prejudgedFindings ?? [])];
  for (const r of [judged, fragility]) {
    if (r.calls === 0) continue;
    enrichTokenUsage ??= emptyAnalyzeTokenUsage();
    enrichTokenUsage.calls += r.calls;
    enrichTokenUsage.inputTokens += r.tokenUsage?.input ?? 0;
    enrichTokenUsage.outputTokens += r.tokenUsage?.output ?? 0;
  }

  // ── Merge insights ──
  mergeZoneInsights(pinnedFinalZones, structural, aiZoneInsights, validPrevious);
  const allGlobalInsights = mergeGlobalInsights(
    structural, aiGlobalInsights, validPrevious
  );

  // ── Assemble findings ──
  let allFindings = assembleFindings(
    pinnedFinalZones, structural, aiFindings, metaUpdatedFindings,
    validPrevious, previousZones, remappedContentHashes, globalContentHash
  );

  // ── Heuristic judgment (enrich-judge.ts) ──
  // After assembly, because assembleFindings builds the per-zone heuristic
  // warnings itself (entry-point width, cohesion/coupling) on top of
  // `structural.findings`. Is each warning a real problem or a detection
  // artifact? Inert without a route; only demotes, never escalates, so
  // running after enforceSeverityRules changes nothing that rule guards.
  const heuristicJudged = await judgeHeuristicFindings(allFindings, {
    zones: pinnedFinalZones,
    crossings,
    projectDir: options?.projectProfile?.projectDir,
  });
  allFindings = heuristicJudged.findings;
  if (heuristicJudged.calls > 0) {
    enrichTokenUsage ??= emptyAnalyzeTokenUsage();
    enrichTokenUsage.calls += heuristicJudged.calls;
    enrichTokenUsage.inputTokens += heuristicJudged.tokenUsage?.input ?? 0;
    enrichTokenUsage.outputTokens += heuristicJudged.tokenUsage?.output ?? 0;
  }

  // ── Back-populate findings into insights for backward compatibility ──
  backPopulateInsights(pinnedFinalZones, allFindings, allGlobalInsights);

  // ── Zone stability metrics ──
  const stability = previousZones?.zones
    ? computeZoneStability(allZones, previousZones.zones)
    : undefined;

  if (stability) {
    const pct = (stability.fileRetention * 100).toFixed(0);
    const moved = stability.reassignedFiles.length;
    console.log(`  [zones] stability: ${pct}% file retention, ${stability.persistedZones} persisted / ${stability.newZones} new / ${stability.removedZones} removed zones${moved > 0 ? `, ${moved} files reassigned` : ""}`);
  }

  // ── Build result ──
  // Deferred narration: the cascade knew the zones by their pre-pin ids;
  // hand the narrator the final ids by file membership.
  const byFiles = (files: Set<string> | undefined): string[] | undefined =>
    files && files.size > 0
      ? pinnedFinalZones.filter((z) => z.files.some((f) => files.has(f))).map((z) => z.id)
      : undefined;
  const pendingNarration = byFiles(enrichResult.deferredFiles);
  const pendingNames = byFiles(enrichResult.deferredNameFiles);

  // ── Areas: the level above zones ──
  let areas = computeAreas({ zones: allZones, crossings, testFiles, routeLayout });
  const pendingAreaNames: string[] = [];
  if (areas.length > 0 && enrich) {
    const named = await nameAreas(areas, allZones, {
      projectDir: options?.projectProfile?.projectDir,
      fileArchetypes: options?.fileArchetypes,
      routeLayout,
      previous: previousZones?.areas,
      defer: options?.deferNarration === true,
    });
    areas = named.areas;
    pendingAreaNames.push(...named.pending);
  }
  if (areas.length > 0) {
    console.log(`  [areas] ${allZones.length} zones in ${areas.length} areas: ${areas.map((a) => `${a.name} (${a.zones.length})`).join(", ")}`);
  }

  return buildAnalyzeZonesResult({
    allZones, crossings, unzoned, allGlobalInsights, allFindings,
    enrichmentPass, structureHash, inputFingerprint, remappedContentHashes,
    previousZones, structureChanged, enrichTokenUsage, stability, pendingNarration,
    partitionReview, areas,
    pendingNames: [...(pendingNames ?? []), ...pendingAreaNames, ...pendingSubZoneNames],
    // A run that enriched says how; one that reused the previous enrichment
    // (--fast on an unchanged structure) keeps the previous mode.
    enrichmentMode: enrichResult.cascade ? "cascade" : enrich && enrichTokenUsage ? "generative" : validPrevious?.enrichmentMode,
  });
}
