/**
 * legacy.json's per-file entries summed, and the SDLC profile's counts they
 * must equal, in one comparable shape.
 */

import type { LegacyFileEntry, SdlcLegacyConstructs } from "../../src/schema/index.js";

/** The profile's counts a per-file list can be summed to. */
export function profileCounts(c: SdlcLegacyConstructs) {
  return {
    files: c.files,
    uses: c.uses,
    notices: c.notices,
    removedIn: c.removedIn,
    deprecatedIn: c.deprecatedIn,
    rules: Object.fromEntries(Object.entries(c.rules).map(([rule, r]) => [rule, { uses: r.uses, files: r.files }])),
  };
}

/** The same counts summed over legacy.json's files. */
export function fileTotals(files: readonly LegacyFileEntry[]) {
  const sum = (into: Record<string, number>, from: Record<string, number>) => {
    for (const [k, n] of Object.entries(from)) into[k] = (into[k] ?? 0) + n;
  };
  const removedIn: Record<string, number> = {};
  const deprecatedIn: Record<string, number> = {};
  const rules: Record<string, { uses: number; files: number }> = {};
  for (const f of files) {
    sum(removedIn, f.removedIn);
    sum(deprecatedIn, f.deprecatedIn);
    for (const u of f.constructs) (rules[u.rule] ??= { uses: 0, files: 0 }).uses++;
    for (const rule of new Set(f.constructs.map((u) => u.rule))) rules[rule].files++;
  }
  return {
    files: files.filter((f) => f.constructs.length > 0).length,
    uses: files.reduce((n, f) => n + f.uses, 0),
    notices: files.reduce((n, f) => n + f.notices, 0),
    removedIn,
    deprecatedIn,
    rules: Object.fromEntries(Object.entries(rules).sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Files per floor version, as the profile's `versionFloors.floors`. */
export function floorTotals(files: readonly LegacyFileEntry[]): Record<string, number> {
  const floors: Record<string, number> = {};
  for (const f of files) if (f.floor) floors[f.floor.version] = (floors[f.floor.version] ?? 0) + 1;
  return floors;
}
