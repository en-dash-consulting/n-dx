/**
 * Structural insights: deterministic, actionable readings of a partition's
 * graph metrics (cohesion, coupling, size, hubs, bidirectional coupling,
 * circular imports, call-graph traffic) and the file-structure findings that
 * go with them. Recomputed every run from the zones alone, so the same
 * structure always yields the same insights.
 *
 * Split out of `zones.ts`, which re-exports {@link generateStructuralInsights}.
 *
 * @module sourcevision/analyzers/zone-insights
 */

import { dirname } from "node:path";
import type { Finding, Imports, Zone, ZoneCrossing } from "../schema/index.js";
import { isAlgorithmicName } from "./zone-identity.js";

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
