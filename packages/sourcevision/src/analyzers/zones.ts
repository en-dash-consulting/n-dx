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

import { basename, dirname } from "node:path";
import { createHash } from "node:crypto";
import type {
  Inventory,
  Imports,
  ImportEdge,
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
  addDirectoryProximityEdges,
  louvainPhase1,
  mergeBidirectionalCoupling,
  mergeSmallCommunities,
  mergeSatelliteCommunities,
  capZoneCount,
  splitLargeCommunities,
} from "./louvain.js";
import { enrichZonesWithAI, enrichZonesPerZone } from "./enrich.js";
import type { EnrichResult, PerZoneEnrichResult } from "./enrich.js";
import { deduplicateFindings, enforceSeverityRules } from "./enrich-parsing.js";

/** Result from analyzeZones, including the zones data and optional token usage. */
export interface AnalyzeZonesResult {
  zones: Zones;
  tokenUsage?: AnalyzeTokenUsage;
  /** True when zone structure changed and enrichment pass was reset to 1 */
  structureChanged: boolean;
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
   * Default: {@link DEFAULT_MAX_ZONE_PERCENT} (30%).
   * Set to `100` to disable the zone size cap.
   */
  maxZonePercent?: number;
  /** Parent zone ID for sub-zone ID derivation. Reserved for subdivision. */
  parentId?: string;
  /** Current recursion depth. Reserved for subdivision. */
  depth?: number;
  /** Test files excluded from cohesion/coupling metric computation. */
  testFiles?: Set<string>;
}

/** Result of running the zone detection pipeline. */
export interface ZonePipelineResult {
  zones: Zone[];
  crossings: ZoneCrossing[];
  unzoned: string[];
  /** Zone IDs that were derived from filename patterns rather than directory structure. */
  filenameBasedZoneIds: Set<string>;
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
export function deriveZoneId(files: string[], parentId?: string): string {
  // When deriving sub-zone IDs, treat parent's ID segments as generic
  const skip = parentId
    ? new Set([...SKIPPABLE_SEGMENTS, ...parentId.split("/").map(s => s.toLowerCase())])
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
  parentId?: string
): string {
  const parentSegments = parentId
    ? new Set(parentId.split("/").map(s => s.toLowerCase()))
    : new Set<string>();

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

/**
 * Title-case a zone ID: "detail-panel" → "Detail Panel"
 */
export function deriveZoneName(id: string): string {
  return id
    .split("-")
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
  // Name unchanged from algorithmic default when ID has numeric suffix
  if (/-\d+$/.test(id) && name === deriveZoneName(id)) return true;
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

// ── Recursive subdivision ────────────────────────────────────────────────────

/** Zones with more than this many files are subdivided recursively. */
export const SUBDIVISION_THRESHOLD = 50;

/** Maximum recursion depth for subdivision to prevent infinite loops. */
export const MAX_SUBDIVISION_DEPTH = 3;

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

  // Run full pipeline on the zone's internal graph
  const result = runZonePipeline({
    edges: internalEdges,
    inventory,
    imports,
    scopeFiles: zone.files,
    maxZones: 8,
    parentId: zone.id,
    depth: depth + 1,
    testFiles,
  });

  // If pipeline found only 1 or 0 zones, no meaningful subdivision
  if (result.zones.length <= 1) {
    return [];
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

    if (isGenericZoneName(zone.name, zone.id)) {
      insights.push(
        `Generic zone name "${zone.name}" — enrichment did not assign a meaningful name reflecting this zone's domain purpose`
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

  // ── Call graph insights (when available) ──

  if (callGraphStats) {
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

  // ── File-structure recommendations ──

  // 2a. Flat directory spanning 3+ zones
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

  // 2b. Zone with scattered files (5+ directories)
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

  // 2c. Filename-derived zone
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

  return { zoneInsights, globalInsights, findings };
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
  maxSize?: number
): void {
  const tempMembers = new Map<string, string[]>();
  for (const [node, comm] of community) {
    let list = tempMembers.get(comm);
    if (!list) { list = []; tempMembers.set(comm, list); }
    list.push(node);
  }

  // Pass 1: merge communities with the same derived zone ID
  mergeByKey(community, tempMembers, (members) => deriveZoneId(members), maxSize);

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
  return {
    cohesion: totalEdgesFromZone > 0
      ? Math.round((internalEdgeCount / totalEdgesFromZone) * 100) / 100 : 1,
    coupling: totalEdgesFromZone > 0
      ? Math.round(((totalEdgesFromZone - internalEdgeCount) / totalEdgesFromZone) * 100) / 100 : 0,
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
 * When `parentId` is provided (subdivision), zone IDs are derived relative
 * to the parent and prefixed with `parentId/`. The `depth` parameter is
 * threaded to `subdivideZone` for recursion limiting.
 */
function buildZonesFromCommunities(
  community: Map<string, string>,
  graph: Map<string, Map<string, number>>,
  imports: Imports,
  inventory: Inventory,
  testFiles: Set<string>,
  parentId?: string,
  depth: number = 0,
  maxMergeSize?: number,
): { zones: Zone[]; filenameBasedZoneIds: Set<string> } {
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

  for (const [, members] of sortedCommunities) {
    let id = deriveZoneId(members, parentId);
    if (usedIds.has(id)) {
      const disambiguated = disambiguateZoneId(id, members, parentId);
      if (disambiguated !== id && !usedIds.has(disambiguated)) {
        id = disambiguated;
      } else {
        // Try filename-based derivation before merging or adding numeric suffix
        const filenameId = deriveZoneIdFromFilenames(members);
        if (filenameId && !usedIds.has(filenameId)) {
          id = filenameId;
          filenameBasedZoneIds.add(parentId ? `${parentId}/${id}` : id);
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
            const metrics = computeZoneMetrics(existing.files, graph, testFiles);
            existing.cohesion = metrics.cohesion;
            existing.coupling = metrics.coupling;
            // Re-subdivide with merged files
            existing.subZones = undefined;
            const subZones = subdivideZone(existing, imports, inventory, testFiles, depth);
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
    usedIds.add(id);

    // Prefix with parent zone ID for subdivision
    if (parentId) {
      id = `${parentId}/${id}`;
    }

    const memberSet = new Set(members);
    const entryPoints = computeEntryPoints(memberSet, imports);
    const { cohesion, coupling } = computeZoneMetrics(members, graph, testFiles);

    const zone: Zone = {
      id,
      name: deriveZoneName(id),
      description: describeZone(members, inventory),
      files: members,
      entryPoints,
      cohesion,
      coupling,
      ...(depth > 0 ? { depth } : {}),
    };

    const subZones = subdivideZone(zone, imports, inventory, testFiles, depth);
    if (subZones.length > 0) {
      zone.subZones = subZones;
    }

    zones.push(zone);
  }

  return { zones, filenameBasedZoneIds };
}

// ── Helper: collect unzoned files ────────────────────────────────────────────

/** Gather inventory files not assigned to any zone or sub-analysis. */
function collectUnzonedFiles(
  zones: Zone[],
  inventory: Inventory,
  subAnalyzedPrefixes: string[]
): string[] {
  const zonedFiles = new Set<string>();
  for (const zone of zones) {
    for (const f of zone.files) zonedFiles.add(f);
  }
  const unzoned: string[] = [];
  for (const entry of inventory.files) {
    if (
      !zonedFiles.has(entry.path) &&
      !isSubAnalyzedFile(entry.path, subAnalyzedPrefixes)
    ) {
      unzoned.push(entry.path);
    }
  }
  return unzoned;
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
): Promise<EnrichmentResult> {
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
      const result = await enrichZonesPerZone(
        expandedZones, preCrossings, inventory, imports, validPrevious, fileArchetypes, hints,
      );
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
    } else {
      const result = await enrichZonesWithAI(
        expandedZones, preCrossings, inventory, imports, validPrevious, fileArchetypes,
        currentContentHashes, hints,
      );
      finalZones = result.zones;
      aiZoneInsights = result.newZoneInsights;
      aiGlobalInsights = result.newGlobalInsights;
      aiFindings = result.newFindings;
      enrichmentPass = result.pass;
      enrichTokenUsage = result.tokenUsage;
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
  };
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

  const crossings: ZoneCrossing[] = [...promotedCrossings];
  for (const edge of imports.edges) {
    const fromZone = fileToZone.get(edge.from);
    const toZone = fileToZone.get(edge.to);
    if (fromZone && toZone && fromZone !== toZone) {
      crossings.push({ from: edge.from, to: edge.to, fromZone, toZone });
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
 * Default: 30% — prevents over-aggregation where one zone dominates the codebase.
 */
export const DEFAULT_MAX_ZONE_PERCENT = 30;

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
    maxZones = 15,
    maxZonePercent = DEFAULT_MAX_ZONE_PERCENT,
    parentId,
    depth = 0,
    testFiles = new Set<string>(),
  } = options;

  // ── Build undirected graph ──
  const graph = buildUndirectedGraph(edges);

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

  // ── Scale maxZones by file count ──
  // Small packages shouldn't fragment into many zones. Scale from 3 (≤45 files)
  // up to the configured cap (default 15 at 225+ files).
  // Also ensure we allow enough zones for the size policy to work —
  // if maxZonePercent limits zone size, we need at least ceil(n/maxSize) zones.
  const graphNodeCount = graph.size;
  const scaledByCount = Math.max(3, Math.floor(graphNodeCount / 15));
  const maxPct = Math.max(1, Math.min(100, maxZonePercent));
  const maxZoneSize = Math.max(3, Math.ceil(graphNodeCount * maxPct / 100));
  const minForSizePolicy = maxPct < 100 ? Math.ceil(graphNodeCount / maxZoneSize) : 0;
  const scaledMaxZones = Math.min(maxZones, Math.max(scaledByCount, minForSizePolicy));

  // ── Louvain community detection ──
  let community = louvainPhase1(graph);
  community = mergeBidirectionalCoupling(community, graph);
  community = mergeSmallCommunities(community, graph);
  community = mergeSatelliteCommunities(community, graph);
  community = capZoneCount(community, graph, scaledMaxZones);

  // ── Split oversized communities ──
  community = splitLargeCommunities(community, graph, maxZoneSize);

  mergeSameIdCommunities(community, maxPct < 100 ? maxZoneSize : undefined);
  community = capZoneCount(community, graph, scaledMaxZones);  // re-cap after split

  // ── Build zones from communities ──
  const { zones, filenameBasedZoneIds } = buildZonesFromCommunities(
    community, graph, imports, inventory, testFiles, parentId, depth,
    maxPct < 100 ? maxZoneSize : undefined,
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

  // ── Build crossings ──
  const crossings = buildCrossings(expandedZones, imports, []);

  return { zones: expandedZones, crossings, unzoned, filenameBasedZoneIds };
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
     * Default: {@link DEFAULT_MAX_ZONE_PERCENT} (30%).
     * Set to `100` to disable the zone size cap.
     */
    maxZonePercent?: number;
  }
): Promise<AnalyzeZonesResult> {
  const enrich = options?.enrich ?? true;
  const perZone = options?.perZone ?? false;
  const previousZones = options?.previousZones;
  const subAnalyses = options?.subAnalyses ?? [];

  // ── Exclude sub-analyzed files from Louvain ──
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
    .map(f => f.path);

  // Build set of test files for metric exclusion
  const testFiles = new Set<string>();
  for (const f of inventory.files) {
    if (f.role === "test") testFiles.add(f.path);
  }

  // ── Run zone detection pipeline ──
  const pipeline = runZonePipeline({
    edges: filteredEdges,
    inventory,
    imports,
    scopeFiles,
    maxZonePercent: options?.maxZonePercent,
    testFiles,
  });
  const { zones: expandedZones, unzoned, filenameBasedZoneIds } = pipeline;

  // ── Structure hash & change detection ──
  const structureHash = computeStructureHash(expandedZones);
  const structureChanged = previousZones?.structureHash !== structureHash;
  const validPrevious = structureChanged ? undefined : previousZones;

  if (structureChanged && previousZones?.enrichmentPass && options?.onReset) {
    options.onReset(previousZones.enrichmentPass, 1);
  }

  // ── Content hashes for stale-finding detection ──
  const { zoneContentHashes, globalContentHash } =
    computeContentHashes(expandedZones, inventory);

  // ── AI enrichment or preserve previous ──
  const enrichResult = await applyEnrichment(
    expandedZones, imports, inventory, validPrevious, enrich, perZone, options?.fileArchetypes,
    zoneContentHashes, options?.hints,
  );
  const { finalZones, aiZoneInsights, aiGlobalInsights, aiFindings,
    enrichmentPass, metaUpdatedFindings, enrichTokenUsage } = enrichResult;

  // ── Remap content hashes to post-enrichment zone IDs ──
  // Enrichment may rename zone IDs (e.g. "dom" → "dom-performance-monitoring").
  // The content hashes were computed with pre-enrichment IDs and must be remapped
  // so that downstream consumers can join zone metadata with content hashes by ID.
  const remappedContentHashes = remapContentHashKeys(
    zoneContentHashes, expandedZones, finalZones,
  );

  // ── Promote zones from sub-analyses ──
  const promotedZones: Zone[] = [];
  const promotedCrossings: ZoneCrossing[] = [];
  for (const sub of subAnalyses) {
    promotedZones.push(...promoteZones(sub));
    promotedCrossings.push(...promoteCrossings(sub));
  }
  const allZones = [...finalZones, ...promotedZones];

  // ── Build final crossings ──
  const crossings = buildCrossings(allZones, imports, promotedCrossings);

  // ── Generate structural insights ──
  const rootFileCount = inventory.files.filter(
    (f) => !isSubAnalyzedFile(f.path, subAnalyzedPrefixes)
  ).length;
  const structural = generateStructuralInsights(
    finalZones,
    crossings.filter((c) => !c.fromZone.includes(":") && !c.toZone.includes(":")),
    imports,
    rootFileCount,
    undefined,
    filenameBasedZoneIds,
  );

  // ── Merge insights ──
  mergeZoneInsights(finalZones, structural, aiZoneInsights, validPrevious);
  const allGlobalInsights = mergeGlobalInsights(
    structural, aiGlobalInsights, validPrevious
  );

  // ── Assemble findings ──
  const allFindings = assembleFindings(
    finalZones, structural, aiFindings, metaUpdatedFindings,
    validPrevious, previousZones, remappedContentHashes, globalContentHash
  );

  // ── Back-populate findings into insights for backward compatibility ──
  backPopulateInsights(finalZones, allFindings, allGlobalInsights);

  // ── Build result ──
  const prevMetaCount = previousZones?.metaEvaluationCount ?? 0;
  const metaEvaluationCount = enrichmentPass >= 5 ? prevMetaCount + 1 : prevMetaCount > 0 ? prevMetaCount : undefined;
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
      enrichmentPass: allFindings.length > 0 ? displayPass : undefined,
      ...(metaEvaluationCount ? { metaEvaluationCount } : {}),
      structureHash,
      zoneContentHashes: remappedContentHashes,
      ...(lastReset ? { lastReset } : {}),
    }),
    tokenUsage: enrichTokenUsage,
    structureChanged,
  };
}
