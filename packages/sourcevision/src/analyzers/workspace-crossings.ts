/**
 * Cross-repo crossing computation for workspace aggregation.
 *
 * When multiple repos are aggregated into a workspace, some "external" npm
 * imports actually point to sibling workspace members. This module resolves
 * those external imports into ZoneCrossing entries so the aggregated
 * zones.json reflects true cross-repo architectural dependencies.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Zone, ZoneCrossing } from "../schema/index.js";
import type { SubAnalysis } from "./workspace.js";
import { toPosix } from "../util/paths.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** Package metadata extracted from a member's package.json. */
export interface MemberPackageInfo {
  /** npm package name (e.g., "@n-dx/llm-client", "rex"). */
  name: string;
  /** Resolved source entry file, relative to member root (e.g., "src/public.ts"). */
  entryFile?: string;
}

/** A resolved package map entry: member + optional entry file. */
export interface PackageMapEntry {
  member: SubAnalysis;
  entryFile?: string;
}

// ── Entry file resolution ────────────────────────────────────────────────────

/** Common entry file conventions, checked in order. */
const ENTRY_FILE_CONVENTIONS = [
  "src/index.ts",
  "src/public.ts",
  "src/index.tsx",
  "src/main.ts",
  "index.ts",
  "index.js",
];

/**
 * Map a built output path to its likely source path.
 *
 * Common patterns:
 *   dist/public.js  → src/public.ts
 *   dist/index.mjs  → src/index.ts
 *   lib/main.cjs    → src/main.ts
 */
function distToSource(distPath: string): string {
  return distPath
    .replace(/^\.\//, "")
    .replace(/^(dist|lib|build|out)\//, "src/")
    .replace(/\.(js|mjs|cjs|jsx)$/, ".ts");
}

/**
 * Extract the entry point path from a package.json exports or main field.
 *
 * Handles:
 * - `exports["."]` as string: `"./dist/public.js"`
 * - `exports["."]` as condition map: `{ import: "./dist/public.js" }`
 * - `main`: `"dist/index.js"`
 * - `module`: `"dist/index.mjs"`
 */
function extractEntryPath(pkgJson: Record<string, unknown>): string | null {
  // Try exports["."] first (most modern)
  const exports = pkgJson.exports as Record<string, unknown> | undefined;
  if (exports) {
    const dotExport = exports["."];
    if (typeof dotExport === "string") {
      return dotExport;
    }
    if (dotExport && typeof dotExport === "object") {
      const conditions = dotExport as Record<string, unknown>;
      // Prefer: import > default > require
      const path = conditions.import ?? conditions.default ?? conditions.require;
      if (typeof path === "string") {
        return path;
      }
    }
  }

  // Try main
  if (typeof pkgJson.main === "string") {
    return pkgJson.main;
  }

  // Try module
  if (typeof pkgJson.module === "string") {
    return pkgJson.module;
  }

  return null;
}

/**
 * Resolve the source-level entry file for a package.
 *
 * Uses package.json fields to find the built entry point, maps it back to
 * a source file, and verifies it exists in the member's zone files. Falls
 * back to common conventions (src/index.ts, src/public.ts, etc.).
 *
 * @param pkgJson - Partial package.json contents (exports, main, module).
 * @param allMemberFiles - All files across the member's zones (relative to member root).
 * @returns The source entry file path (relative to member root), or null.
 */
export function resolveEntryFile(
  pkgJson: Record<string, unknown>,
  allMemberFiles: string[],
): string | null {
  const fileSet = new Set(allMemberFiles);

  // Try to resolve from package.json fields
  const entryPath = extractEntryPath(pkgJson);
  if (entryPath) {
    const sourcePath = distToSource(entryPath);
    if (fileSet.has(sourcePath)) {
      return sourcePath;
    }
  }

  // Fall back to conventions
  for (const convention of ENTRY_FILE_CONVENTIONS) {
    if (fileSet.has(convention)) {
      return convention;
    }
  }

  return null;
}

// ── Package map ──────────────────────────────────────────────────────────────

/**
 * Read package.json from a member's root directory and extract package info.
 *
 * The member root is derived from svDir (which is the absolute path to the
 * member's .sourcevision/ directory).
 */
export function readMemberPackageInfo(member: SubAnalysis): MemberPackageInfo | null {
  const memberRoot = dirname(member.svDir);
  const pkgJsonPath = join(memberRoot, "package.json");

  let pkgJson: Record<string, unknown>;
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
  } catch {
    return null;
  }

  const name = pkgJson.name;
  if (typeof name !== "string" || !name) {
    return null;
  }

  // Collect all files across the member's zones for entry file resolution
  const allFiles = member.zones?.zones.flatMap((z) => z.files) ?? [];
  const entryFile = resolveEntryFile(pkgJson, allFiles) ?? undefined;

  return { name, entryFile };
}

/**
 * Build a map from npm package names to workspace members.
 *
 * @param members - The workspace members.
 * @param readInfo - Function to read package info from a member.
 *   Defaults to reading package.json from disk. Override for testing.
 */
export function buildPackageMap(
  members: SubAnalysis[],
  readInfo: (member: SubAnalysis) => MemberPackageInfo | null = readMemberPackageInfo,
): Map<string, PackageMapEntry> {
  const map = new Map<string, PackageMapEntry>();

  for (const member of members) {
    const info = readInfo(member);
    if (!info?.name) continue;

    map.set(info.name, {
      member,
      entryFile: info.entryFile,
    });
  }

  return map;
}

// ── Cross-repo crossing computation ──────────────────────────────────────────

/**
 * Find the target zone and file for a cross-repo import.
 *
 * When we know the entry file, we look it up in the promoted zones.
 * When we don't, we fall back to the first zone entry point of the target member.
 */
function resolveTarget(
  targetMember: SubAnalysis,
  entryFile: string | undefined,
  fileToZone: Map<string, string>,
  allZones: Zone[],
): { toFile: string; toZone: string } | null {
  // If we have a known entry file, look it up directly
  if (entryFile) {
    const prefixedFile = toPosix(join(targetMember.prefix, entryFile));
    const zone = fileToZone.get(prefixedFile);
    if (zone) {
      return { toFile: prefixedFile, toZone: zone };
    }
  }

  // Fallback: find the first promoted zone for this member that has entry points
  const memberZonePrefix = `${targetMember.id}:`;
  for (const zone of allZones) {
    if (!zone.id.startsWith(memberZonePrefix)) continue;
    if (zone.entryPoints.length > 0) {
      return { toFile: zone.entryPoints[0], toZone: zone.id };
    }
  }

  // Last resort: any zone for this member
  for (const zone of allZones) {
    if (!zone.id.startsWith(memberZonePrefix)) continue;
    if (zone.files.length > 0) {
      return { toFile: zone.files[0], toZone: zone.id };
    }
  }

  return null;
}

/**
 * Compute cross-repo zone crossings from workspace member external imports.
 *
 * Iterates over each member's external imports. When an external import's
 * package name matches a sibling member in the package map, it creates
 * zone crossings from the importing file's zone to the target member's
 * entry zone.
 *
 * @param members - All workspace members with their loaded data.
 * @param promotedZones - All promoted zones (with `{memberId}:{zoneId}` IDs).
 * @param packageMap - Map from npm package names to members (from buildPackageMap).
 * @returns Array of cross-repo zone crossings.
 */
export function computeCrossRepoCrossings(
  members: SubAnalysis[],
  promotedZones: Zone[],
  packageMap: Map<string, PackageMapEntry>,
): ZoneCrossing[] {
  // Build file→zone lookup for all promoted zones
  const fileToZone = new Map<string, string>();
  for (const zone of promotedZones) {
    for (const file of zone.files) fileToZone.set(file, zone.id);
  }

  const crossings: ZoneCrossing[] = [];
  const seen = new Set<string>();

  for (const member of members) {
    if (!member.imports?.external) continue;

    for (const ext of member.imports.external) {
      const entry = packageMap.get(ext.package);
      if (!entry) continue;

      // Skip self-imports (member importing its own package)
      if (entry.member.id === member.id) continue;

      // Resolve target zone and file in the sibling member
      const target = resolveTarget(entry.member, entry.entryFile, fileToZone, promotedZones);
      if (!target) continue;

      for (const importingFile of ext.importedBy) {
        const fromFilePrefixed = toPosix(join(member.prefix, importingFile));
        const fromZone = fileToZone.get(fromFilePrefixed);
        if (!fromZone) continue;

        // Deduplicate: same from→to→fromZone→toZone
        const key = `${fromFilePrefixed}\0${target.toFile}\0${fromZone}\0${target.toZone}`;
        if (seen.has(key)) continue;
        seen.add(key);

        crossings.push({
          from: fromFilePrefixed,
          to: target.toFile,
          fromZone,
          toZone: target.toZone,
        });
      }
    }
  }

  return crossings;
}
