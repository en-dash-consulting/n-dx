/**
 * What one analysis changed against the previous one, for the Live analysis
 * page's summary.
 *
 * Pure: it takes the two runs' recorded outcomes and the zone facts `sv
 * analyze` already wrote, and returns the difference. No LLM call, and no read
 * of its own — `routes-live-analyze.ts` supplies the files.
 *
 * The two sides come from different places on purpose. Counts and finding
 * identity come from `AnalysisOutcome`, which each run records about itself
 * (sourcevision's `analysis-outcome.ts`), because the previous run's data files
 * were overwritten and that record is all that survives of them. Zone *shape* —
 * what was renamed, what merged into what — comes instead from the current
 * `zones.json`, because the analyzer works it out while it still has both
 * partitions in hand and writes it down (`previousIds`, `stability`). Deriving
 * it again here from ids alone would be a second, worse implementation of
 * `computeZoneStability`.
 *
 * @module web/server/analysis-changes
 */

import type { Manifest } from "./domain-gateway.js";

/**
 * The run record `sv analyze` writes to `manifest.lastAnalysis` (and to each
 * line of `analyses.jsonl`).
 *
 * Reached through `Manifest` rather than as its own gateway export because it
 * *is* a field of the manifest: naming it separately would add a second import
 * of one shape, and the gateway's export cap exists to make exactly that kind
 * of growth a decision rather than a habit.
 */
export type RecordedAnalysisRun = NonNullable<Manifest["lastAnalysis"]>;

/** What a run left in `.sourcevision/` — the only side of the diff that survives the next run's writes. */
export type AnalysisOutcome = NonNullable<RecordedAnalysisRun["outcome"]>;

/** One zone that appeared, went, was renamed or was merged away. */
export interface AnalysisZoneChange {
  id: string;
  /** Its display name, when this run still has the zone; null for one that is gone. */
  name: string | null;
  /** Renamed: the id it had before. Merged: the zone its files went into. Null otherwise. */
  related: string | null;
}

export interface AnalysisZoneChanges {
  total: number;
  added: AnalysisZoneChange[];
  removed: AnalysisZoneChange[];
  merged: AnalysisZoneChange[];
  renamed: AnalysisZoneChange[];
}

/** Severity → number of findings. */
export type FindingCounts = Record<string, number>;

export interface AnalysisFindingChanges {
  /** What this run found. */
  now: FindingCounts;
  /** Not present in the previous run. */
  added: FindingCounts;
  /** Present in the previous run and gone from this one. */
  resolved: FindingCounts;
}

export interface AnalysisChanges {
  /** When the run being measured against started; null when there is no comparable previous run. */
  previousAt: string | null;
  files: { now: number; was: number | null };
  importEdges: { now: number; was: number | null };
  zones: AnalysisZoneChanges;
  findings: AnalysisFindingChanges;
}

/** The parts of `zones.json` this needs. Tolerant: every field may be absent. */
export interface ZoneShapeInput {
  zones?: Array<{ id?: unknown; name?: unknown; previousIds?: unknown; subZones?: unknown }>;
  stability?: { reassignedFiles?: unknown };
}

interface FlatZone {
  id: string;
  name: string;
  previousIds: string[];
}

/** Every zone in the tree, sub-zones included, in the order `zones.json` lists them. */
function flattenZones(input: ZoneShapeInput): FlatZone[] {
  const flat: FlatZone[] = [];
  const walk = (raw: unknown): void => {
    if (!raw || typeof raw !== "object") return;
    const zone = raw as { id?: unknown; name?: unknown; previousIds?: unknown; subZones?: unknown };
    if (typeof zone.id === "string") {
      flat.push({
        id: zone.id,
        name: typeof zone.name === "string" && zone.name.length > 0 ? zone.name : zone.id,
        previousIds: Array.isArray(zone.previousIds) ? zone.previousIds.filter((p): p is string => typeof p === "string") : [],
      });
    }
    for (const sub of Array.isArray(zone.subZones) ? zone.subZones : []) walk(sub);
  };
  for (const zone of Array.isArray(input.zones) ? input.zones : []) walk(zone);
  return flat;
}

/** `[file, fromZone, toZone]` triples, ignoring anything shaped otherwise. */
function reassignments(input: ZoneShapeInput): Array<[string, string, string]> {
  const raw = input.stability?.reassignedFiles;
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is [string, string, string] =>
    Array.isArray(entry) && entry.length >= 3 && entry.every((part) => typeof part === "string"));
}

/**
 * The surviving zone a gone zone's files mostly landed in, or null when they
 * scattered rather than merged.
 *
 * "Mostly" is a plurality, not a majority: a zone broken up three ways went
 * nowhere in particular and is reported as removed, but one whose files went
 * 8-to-1 into another zone was merged into it, and saying so is the whole point
 * of the distinction.
 */
function mergedInto(id: string, moves: ReadonlyArray<[string, string, string]>, current: ReadonlySet<string>): string | null {
  const destinations = new Map<string, number>();
  for (const [, from, to] of moves) {
    if (from !== id || !current.has(to)) continue;
    destinations.set(to, (destinations.get(to) ?? 0) + 1);
  }
  if (destinations.size === 0) return null;
  const ranked = [...destinations].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [[winner, took]] = ranked;
  const total = ranked.reduce((n, [, count]) => n + count, 0);
  return took * 2 > total ? winner : null;
}

function countBySeverity(findings: Record<string, string[]>): FindingCounts {
  const counts: FindingCounts = {};
  for (const [severity, keys] of Object.entries(findings)) counts[severity] = keys.length;
  return counts;
}

/** Keys in `findings` that `other` does not have, counted by the severity they hold in `findings`. */
function missingFrom(findings: Record<string, string[]>, other: Record<string, string[]>): FindingCounts {
  const seen = new Set(Object.values(other).flat());
  const counts: FindingCounts = {};
  for (const [severity, keys] of Object.entries(findings)) {
    const gone = keys.filter((key) => !seen.has(key)).length;
    if (gone > 0) counts[severity] = gone;
  }
  return counts;
}

/**
 * Compare `current` against `previous`.
 *
 * `previous` is null for the first run of a worktree, and for a run recorded
 * before outcomes existed. Everything then reports as the current state with no
 * "was" side, rather than as a run that invented every zone and finding it has:
 * an unknown previous state is not an empty one.
 */
export function computeAnalysisChanges(
  current: AnalysisOutcome,
  previous: AnalysisOutcome | null,
  previousAt: string | null,
  shape: ZoneShapeInput,
): AnalysisChanges {
  const flat = flattenZones(shape);
  const currentIds = new Set(flat.map((z) => z.id));
  const zones: AnalysisZoneChanges = { total: current.zoneIds.length, added: [], removed: [], merged: [], renamed: [] };

  if (previous) {
    const previousIds = new Set(previous.zoneIds);
    // A zone that kept its files and took a new id is a rename, not a removal
    // plus an addition — the analyzer records the old id for exactly this.
    const renamedFrom = new Map<string, FlatZone>();
    for (const zone of flat) {
      for (const was of zone.previousIds) {
        if (previousIds.has(was) && !currentIds.has(was)) renamedFrom.set(was, zone);
      }
    }
    for (const [was, zone] of renamedFrom) {
      zones.renamed.push({ id: zone.id, name: zone.name, related: was });
    }

    const renamedTo = new Set([...renamedFrom.values()].map((z) => z.id));
    for (const zone of flat) {
      if (!previousIds.has(zone.id) && !renamedTo.has(zone.id)) {
        zones.added.push({ id: zone.id, name: zone.name, related: null });
      }
    }

    const moves = reassignments(shape);
    for (const id of previous.zoneIds) {
      if (currentIds.has(id) || renamedFrom.has(id)) continue;
      const into = mergedInto(id, moves, currentIds);
      (into === null ? zones.removed : zones.merged).push({ id, name: null, related: into });
    }
  }

  return {
    previousAt: previous ? previousAt : null,
    files: { now: current.files, was: previous?.files ?? null },
    importEdges: { now: current.importEdges, was: previous?.importEdges ?? null },
    zones,
    findings: {
      now: countBySeverity(current.findings),
      added: previous ? missingFrom(current.findings, previous.findings) : {},
      resolved: previous ? missingFrom(previous.findings, current.findings) : {},
    },
  };
}
