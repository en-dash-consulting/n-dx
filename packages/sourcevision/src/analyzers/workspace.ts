/**
 * Workspace analyzer — detects and incorporates pre-analyzed sub-directories.
 *
 * When a subdirectory already has `.sourcevision/`, it's treated as a
 * pre-analyzed unit. Its zones are promoted into the parent analysis
 * with prefixed IDs instead of re-running Louvain on its files.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import type {
  Manifest,
  Inventory,
  Imports,
  Zones,
  Zone,
  ZoneCrossing,
  SubAnalysisRef,
} from "../schema/index.js";
import { SV_DIR } from "../constants.js";
import { DATA_FILES } from "../schema/data-files.js";
import { toPosix } from "../util/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A detected sub-analysis with its loaded data. */
export interface SubAnalysis {
  /** Unique ID derived from directory path (e.g., "packages-rex"). */
  id: string;
  /** Path prefix relative to root (e.g., "packages/rex"). */
  prefix: string;
  /** Path to the .sourcevision directory. */
  svDir: string;
  /** Loaded manifest. */
  manifest: Manifest;
  /** Loaded zones (if available). */
  zones?: Zones;
  /** Loaded inventory (if available). */
  inventory?: Inventory;
  /** Loaded imports (if available). */
  imports?: Imports;
}

// ── Detection ────────────────────────────────────────────────────────────────

/**
 * Recursively scan for .sourcevision directories within the project tree.
 * Skips the root .sourcevision itself and common excluded directories.
 */
function findSubSvDirs(rootDir: string, currentDir: string, results: string[]): void {
  const SKIP_DIRS = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    "__pycache__",
    ".next",
    ".nuxt",
    ".svelte-kit",
    ".turbo",
    ".cache",
    "coverage",
    ".output",
  ]);

  let entries: string[];
  try {
    entries = readdirSync(currentDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(currentDir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (!stat.isDirectory()) continue;

    // Check if this directory has a .sourcevision subdirectory
    if (entry === SV_DIR) {
      // Skip the root's own .sourcevision
      const relPath = relative(rootDir, currentDir);
      if (relPath !== "") {
        results.push(currentDir);
      }
      continue;
    }

    // Check for .sourcevision inside this directory
    const svPath = join(fullPath, SV_DIR);
    if (existsSync(svPath) && statSync(svPath).isDirectory()) {
      results.push(fullPath);
      // Don't recurse into sub-analyzed directories (they manage their own children)
      continue;
    }

    // Recurse
    findSubSvDirs(rootDir, fullPath, results);
  }
}

/**
 * Generate a unique ID from a relative path.
 * "packages/rex" → "packages-rex"
 */
function pathToId(relativePath: string): string {
  return relativePath
    .replace(/[\/\\]/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

/**
 * Load a sub-analysis from a directory that has a .sourcevision folder.
 */
function loadSubAnalysis(rootDir: string, subDir: string): SubAnalysis | null {
  const svDir = join(subDir, SV_DIR);
  const manifestPath = join(svDir, DATA_FILES.manifest);

  if (!existsSync(manifestPath)) {
    return null;
  }

  let manifest: Manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  } catch {
    return null;
  }

  const prefix = toPosix(relative(rootDir, subDir));
  const id = pathToId(prefix);

  const result: SubAnalysis = {
    id,
    prefix,
    svDir,
    manifest,
  };

  // Load zones if available
  const zonesPath = join(svDir, DATA_FILES.zones);
  if (existsSync(zonesPath)) {
    try {
      result.zones = JSON.parse(readFileSync(zonesPath, "utf-8"));
    } catch {
      // Zones unavailable
    }
  }

  // Load inventory if available
  const inventoryPath = join(svDir, DATA_FILES.inventory);
  if (existsSync(inventoryPath)) {
    try {
      result.inventory = JSON.parse(readFileSync(inventoryPath, "utf-8"));
    } catch {
      // Inventory unavailable
    }
  }

  // Load imports if available
  const importsPath = join(svDir, DATA_FILES.imports);
  if (existsSync(importsPath)) {
    try {
      result.imports = JSON.parse(readFileSync(importsPath, "utf-8"));
    } catch {
      // Imports unavailable
    }
  }

  return result;
}

/**
 * Detect all sub-analyses within the project tree.
 * Returns an array of SubAnalysis objects for directories that have
 * their own .sourcevision/ with a valid manifest.
 */
export function detectSubAnalyses(rootDir: string): SubAnalysis[] {
  const subDirs: string[] = [];
  findSubSvDirs(rootDir, rootDir, subDirs);

  const results: SubAnalysis[] = [];
  for (const subDir of subDirs) {
    const sub = loadSubAnalysis(rootDir, subDir);
    if (sub) {
      results.push(sub);
    }
  }

  return results.sort((a, b) => a.prefix.localeCompare(b.prefix));
}

// ── Zone Promotion ───────────────────────────────────────────────────────────

/**
 * Promote zones from a sub-analysis into the parent.
 * - Prefixes zone IDs to avoid collisions
 * - Adjusts file paths to be relative to root
 * - Sets childId and depth on promoted zones
 */
export function promoteZones(sub: SubAnalysis): Zone[] {
  if (!sub.zones?.zones) {
    return [];
  }

  return sub.zones.zones.map((zone) => ({
    ...zone,
    id: `${sub.id}:${zone.id}`,
    // File paths in sub-analysis are relative to sub-analysis root
    // Prefix them to make them relative to the parent root
    files: zone.files.map((f) => toPosix(join(sub.prefix, f))),
    entryPoints: zone.entryPoints.map((f) => toPosix(join(sub.prefix, f))),
    childId: sub.id,
    depth: 1,
  }));
}

/**
 * Promote crossings from a sub-analysis.
 * Prefixes zone IDs and adjusts file paths.
 */
export function promoteCrossings(sub: SubAnalysis): ZoneCrossing[] {
  if (!sub.zones?.crossings) {
    return [];
  }

  return sub.zones.crossings.map((c) => ({
    from: toPosix(join(sub.prefix, c.from)),
    to: toPosix(join(sub.prefix, c.to)),
    fromZone: `${sub.id}:${c.fromZone}`,
    toZone: `${sub.id}:${c.toZone}`,
  }));
}

/**
 * Get the path prefixes covered by sub-analyses.
 * Files under these prefixes should be excluded from the root's Louvain analysis.
 *
 * We use prefix matching (not explicit file lists) because sub-analyses may be
 * stale — new files added since the sub-analysis was run would otherwise leak
 * into the root analysis.
 */
export function getSubAnalyzedPrefixes(subAnalyses: SubAnalysis[]): string[] {
  return subAnalyses.map((sub) => sub.prefix + "/");
}

/**
 * Check if a file path is covered by any sub-analysis prefix.
 */
export function isSubAnalyzedFile(path: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => path.startsWith(prefix));
}

/**
 * Get the set of files that are covered by sub-analyses.
 * @deprecated Use getSubAnalyzedPrefixes + isSubAnalyzedFile for prefix-based matching.
 */
export function getSubAnalyzedFiles(subAnalyses: SubAnalysis[]): Set<string> {
  const files = new Set<string>();

  for (const sub of subAnalyses) {
    if (sub.inventory?.files) {
      for (const f of sub.inventory.files) {
        files.add(toPosix(join(sub.prefix, f.path)));
      }
    } else if (sub.zones?.zones) {
      // Fallback to zone files if inventory unavailable
      for (const zone of sub.zones.zones) {
        for (const f of zone.files) {
          files.add(toPosix(join(sub.prefix, f)));
        }
      }
    }
  }

  return files;
}

/**
 * Build SubAnalysisRef entries for the manifest.
 */
export function buildSubAnalysisRefs(subAnalyses: SubAnalysis[]): SubAnalysisRef[] {
  return subAnalyses.map((sub) => ({
    id: sub.id,
    prefix: sub.prefix,
    manifestPath: toPosix(join(sub.prefix, SV_DIR, DATA_FILES.manifest)),
  }));
}
