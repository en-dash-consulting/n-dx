/**
 * File-move recommendation engine.
 *
 * Detects files whose physical location diverges from their architectural zone
 * membership and emits concrete move-file findings with predicted metric impact.
 *
 * Two detection strategies:
 *
 * 1. **Pin divergence** — A zone pin overrides Louvain placement, meaning the
 *    file's import structure says "zone A" but a human pinned it to "zone B".
 *    If zone B has a clear directory majority, suggest moving the file there.
 *
 * 2. **Import neighbor majority** — A file's import neighbors (both importers
 *    and importees) are predominantly in a different directory. This suggests
 *    the file has drifted from its logical home.
 */

import { dirname } from "node:path";
import type { Zone, ImportEdge, ZoneCrossing, MoveFileFinding } from "../schema/index.js";

/** Common test directory segments — files under these are test files. */
const TEST_DIR_SEGMENTS = /(?:^|\/)(tests?|__tests?__|spec|__spec__)\//;

/** File extensions that represent importable source code. */
const SOURCE_EXTENSIONS = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/;

/** Input context for move recommendation analysis. */
export interface MoveContext {
  zones: Zone[];
  crossings: ZoneCrossing[];
  edges: ImportEdge[];
  zonePins: Record<string, string>;
}

interface MajorityDirOptions {
  excludeFile?: string;
  /** When true, ignore files under test directories (tests/, __tests__/, etc.). */
  excludeTests?: boolean;
  /** When true, only count importable source files (.ts, .tsx, .js, .jsx, etc.). */
  sourceOnly?: boolean;
}

/**
 * Find the majority directory for a zone's files.
 * Returns the directory that contains the most files, or undefined if the zone
 * has no qualifying files.
 */
function majorityDirectory(zone: Zone, opts?: MajorityDirOptions): string | undefined {
  const dirCounts = new Map<string, number>();
  for (const f of zone.files) {
    if (f === opts?.excludeFile) continue;
    if (opts?.excludeTests && TEST_DIR_SEGMENTS.test(f)) continue;
    if (opts?.sourceOnly && !SOURCE_EXTENSIONS.test(f)) continue;
    const dir = dirname(f);
    dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
  }

  let best: string | undefined;
  let bestCount = 0;
  for (const [dir, count] of dirCounts) {
    if (count > bestCount) {
      best = dir;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Count cross-zone edges involving a specific file that would be eliminated
 * if the file moved to the target zone.
 */
function countEliminatedEdges(
  file: string,
  targetZoneFiles: Set<string>,
  edges: ImportEdge[],
): number {
  let count = 0;
  for (const edge of edges) {
    if (edge.from === file && targetZoneFiles.has(edge.to)) count++;
    else if (edge.to === file && targetZoneFiles.has(edge.from)) count++;
  }
  return count;
}

/**
 * Detect files that are pinned to a zone different from their Louvain placement.
 *
 * For each pin, if the file's current directory doesn't match the target zone's
 * majority directory, emit a move-file finding suggesting physical relocation.
 */
export function detectPinDivergence(ctx: MoveContext): MoveFileFinding[] {
  const findings: MoveFileFinding[] = [];
  if (!ctx.zonePins || Object.keys(ctx.zonePins).length === 0) return findings;

  // Build zone lookup
  const zoneById = new Map(ctx.zones.map(z => [z.id, z]));

  for (const [file, targetZoneId] of Object.entries(ctx.zonePins)) {
    const targetZone = zoneById.get(targetZoneId);
    if (!targetZone) continue;

    // Skip test files — they are pinned for zone metrics, not physical placement.
    if (TEST_DIR_SEGMENTS.test(file)) continue;

    // Find the target zone's majority source directory (excluding the pinned file
    // itself and test files — test files are pinned for zone health metrics but
    // should not drive where source files should live).
    const targetDir = majorityDirectory(targetZone, { excludeFile: file, excludeTests: true, sourceOnly: true });
    if (!targetDir) continue;

    const fileDir = dirname(file);
    // Skip if file is already in the target zone's directory
    if (fileDir === targetDir) continue;

    // Skip if the target directory is a subdirectory of the file's directory.
    // This avoids pushing zone-root files (gateways, index modules) into
    // subdirectories — they sit at the root by architectural intent.
    if (targetDir.startsWith(fileDir + "/")) continue;

    // Compute predicted impact: edges between this file and target zone files
    const targetFiles = new Set(targetZone.files);
    const impact = countEliminatedEdges(file, targetFiles, ctx.edges);

    findings.push({
      type: "move-file",
      pass: 0,
      scope: targetZoneId,
      text: `File "${file}" is pinned to zone "${targetZone.name}" but lives in ${fileDir}/ — consider moving to ${targetDir}/ to align physical location with architectural zone`,
      severity: "warning",
      related: [file],
      from: file,
      to: `${targetDir}/`,
      moveReason: "zone-pin-override",
      predictedImpact: impact,
    });
  }

  return findings;
}

/**
 * Detect files whose import neighbors are predominantly in another directory.
 *
 * For each file, compute the directory distribution of all files it imports
 * from or is imported by. If >80% of neighbors are in a single directory
 * different from the file's own directory, suggest moving.
 *
 * Only considers files with 2+ import neighbors to avoid noisy recommendations.
 */
export function detectImportNeighborMoves(ctx: MoveContext): MoveFileFinding[] {
  const findings: MoveFileFinding[] = [];

  // Build set of all known files across all zones
  const allFiles = new Set<string>();
  for (const zone of ctx.zones) {
    for (const f of zone.files) allFiles.add(f);
  }

  // Build neighbor map: file → set of neighboring files
  const neighbors = new Map<string, Set<string>>();
  for (const edge of ctx.edges) {
    if (!allFiles.has(edge.from) || !allFiles.has(edge.to)) continue;
    if (!neighbors.has(edge.from)) neighbors.set(edge.from, new Set());
    if (!neighbors.has(edge.to)) neighbors.set(edge.to, new Set());
    neighbors.get(edge.from)!.add(edge.to);
    neighbors.get(edge.to)!.add(edge.from);
  }

  for (const [file, neighborSet] of neighbors) {
    if (neighborSet.size < 2) continue;

    const fileDir = dirname(file);

    // Count neighbors by directory
    const dirCounts = new Map<string, number>();
    for (const neighbor of neighborSet) {
      const dir = dirname(neighbor);
      dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
    }

    // Find the majority directory among neighbors
    let bestDir = "";
    let bestCount = 0;
    for (const [dir, count] of dirCounts) {
      if (count > bestCount) {
        bestDir = dir;
        bestCount = count;
      }
    }

    // Check if >80% of neighbors are in a single directory
    const ratio = bestCount / neighborSet.size;
    if (ratio <= 0.8) continue;

    // Skip if file is already in the majority directory
    if (fileDir === bestDir) continue;

    // Count cross-directory edges that would be resolved
    let crossDirEdges = 0;
    for (const edge of ctx.edges) {
      if (edge.from === file && dirname(edge.to) !== fileDir) crossDirEdges++;
      else if (edge.to === file && dirname(edge.from) !== fileDir) crossDirEdges++;
    }

    findings.push({
      type: "move-file",
      pass: 0,
      scope: "global",
      text: `File "${file}" has ${Math.round(ratio * 100)}% of import neighbors in ${bestDir}/ but lives in ${fileDir}/ — consider relocating`,
      severity: "info",
      related: [file],
      from: file,
      to: `${bestDir}/`,
      moveReason: "import-neighbor-majority",
      predictedImpact: crossDirEdges,
    });
  }

  return findings;
}
