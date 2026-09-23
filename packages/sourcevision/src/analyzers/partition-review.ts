/**
 * Partition review: should the previous zone partition stand?
 *
 * A partition outlives the run that produced it twice over. When the analysis
 * inputs are unchanged (`inputFingerprint` matches) it is reused verbatim; when
 * they change, it seeds Louvain and adds co-zone stability edges, which on a
 * fragmented partition rebuilds the same fragments. Either way nothing ever
 * asked whether the partition was any good, so a bad one — twenty one- and
 * two-file zones on a React Router app — was frozen until someone deleted
 * `.sourcevision/`, and a sourcevision upgrade could not reach it.
 *
 * This module asks. Deterministic health signals come first and decide the
 * clear cases on their own; in the borderline band one Jev Noul over the
 * whole map decides ("would a maintainer recognise this as the architecture?").
 * The pairwise merge questions the naming step asks cannot answer that: each
 * pair can look defensible while the map as a whole is noise.
 *
 * A rejected partition is re-derived from scratch — no reuse, no stability
 * bias — at most once per `inputFingerprint`, so a project whose fresh
 * partition is no better does not re-partition on every run.
 *
 * @module sourcevision/analyzers/partition-review
 */

import type { PartitionHealth, PartitionReview, Zone, ZoneCrossing } from "../schema/index.js";
import { ClaudeClientError, getJudgmentRoute } from "./claude-client.js";
import { askJev, noul } from "./jev-client.js";
import type { JsonValue } from "./jev-client.js";

// ── Thresholds ───────────────────────────────────────────────────────────────

/** A zone with this many files or fewer is a fragment, not a module. */
export const SMALL_ZONE_MAX_FILES = 2;

/** Below this many zones the share of small ones says nothing. */
export const MIN_ZONES_FOR_REVIEW = 8;

/** Small-zone share at or above which the partition is rejected without asking. */
export const FRAGMENTED_SMALL_SHARE = 0.4;

/**
 * Signals at or above which the partition is borderline and Jev is asked.
 * Numeric-suffix ids (`routes-7`) mark overflow communities the id derivation
 * could not tell apart — a symptom, not proof, so they only ever lead to a
 * question.
 */
export const BORDERLINE_SMALL_SHARE = 0.2;
export const BORDERLINE_NUMERIC_SHARE = 0.25;

/**
 * A top-level zone above this share of all zoned files, with no balanced
 * sub-zones, is oversized: `max(2 × maxZonePercent, 30%)`.
 */
export function oversizedShare(maxZonePercent = 15): number {
  return Math.max((2 * maxZonePercent) / 100, 0.3);
}

/** Map Noul at or below which the partition is rejected. */
export const MAP_REJECT_MAX_PROBABILITY = 0.3;

/** Zones and files per zone sent as evidence. */
const MAP_ZONE_LIMIT = 60;
const MAP_FILE_SAMPLE = 6;

// ── Health ───────────────────────────────────────────────────────────────────

/** Deterministic partition-health signals. */
export function assessPartitionHealth(zones: Zone[], maxZonePercent?: number): PartitionHealth {
  const total = zones.length;
  const smallZones = zones.filter((z) => z.files.length <= SMALL_ZONE_MAX_FILES).length;
  const numericIds = zones.filter((z) => /-\d+$/.test(z.id)).length;
  const fileCount = zones.reduce((n, z) => n + z.files.length, 0);
  const largest = zones.reduce((n, z) => Math.max(n, z.files.length), 0);
  const smallShare = total > 0 ? round2(smallZones / total) : 0;
  const numericShare = total > 0 ? round2(numericIds / total) : 0;
  const limit = oversizedShare(maxZonePercent);
  const oversized = zones.filter((z) => fileCount > 0 && z.files.length / fileCount > limit && !hasBalancedSubZones(z)).length;

  let verdict: PartitionHealth["verdict"] = "healthy";
  const reasons: string[] = [];
  if (total >= MIN_ZONES_FOR_REVIEW) {
    if (smallShare >= FRAGMENTED_SMALL_SHARE) {
      verdict = "fragmented";
      reasons.push(`${smallZones}/${total} zones hold ${SMALL_ZONE_MAX_FILES} files or fewer`);
    } else {
      if (smallShare >= BORDERLINE_SMALL_SHARE) {
        reasons.push(`${smallZones}/${total} zones hold ${SMALL_ZONE_MAX_FILES} files or fewer`);
      }
      if (numericShare >= BORDERLINE_NUMERIC_SHARE) {
        reasons.push(`${numericIds}/${total} zone ids carry a numeric suffix`);
      }
    }
  }
  // Oversized zones matter at any zone count: one zone holding most of a
  // project is the opposite failure from fragmentation.
  if (verdict !== "fragmented" && oversized > 0) {
    reasons.push(`${oversized} zone${oversized === 1 ? "" : "s"} over ${Math.round(limit * 100)}% of files without a balanced subdivision`);
  }
  if (verdict === "healthy" && reasons.length > 0) verdict = "borderline";

  return {
    zones: total,
    smallZones,
    smallShare,
    numericIds,
    largestShare: fileCount > 0 ? round2(largest / fileCount) : 0,
    verdict,
    ...(reasons.length > 0 ? { reasons } : {}),
  };
}

function hasBalancedSubZones(zone: Zone): boolean {
  const kids = zone.subZones ?? [];
  if (kids.length < 2 || zone.files.length === 0) return false;
  return kids.reduce((n, k) => Math.max(n, k.files.length), 0) / zone.files.length < 0.7;
}

// ── Jev map judgment ─────────────────────────────────────────────────────────

/**
 * One Noul over the whole map. Names and descriptions are left out on purpose:
 * a generated name can make a fragment look like a module, and the question is
 * whether the grouping of files is sensible, not whether it is well labelled.
 */
export function buildPartitionMapRequest(
  zones: Zone[],
  crossings: ZoneCrossing[],
): { state: JsonValue; questions: Record<string, ReturnType<typeof noul>> } {
  const degree = new Map<string, number>();
  for (const c of crossings) {
    degree.set(c.fromZone, (degree.get(c.fromZone) ?? 0) + 1);
    degree.set(c.toZone, (degree.get(c.toZone) ?? 0) + 1);
  }
  const sorted = [...zones].sort((a, b) => b.files.length - a.files.length || (a.id < b.id ? -1 : 1));
  const zState: Record<string, JsonValue> = {};
  sorted.slice(0, MAP_ZONE_LIMIT).forEach((zone, i) => {
    zState[`z${i}`] = {
      fileCount: zone.files.length,
      files: zone.files.slice(0, MAP_FILE_SAMPLE),
      cohesion: zone.cohesion,
      coupling: zone.coupling,
      crossings: degree.get(zone.id) ?? 0,
    };
  });
  return {
    state: { zoneCount: zones.length, zones: zState },
    questions: {
      map: noul(
        "The zones in `zones` partition one codebase's files into architectural modules. " +
          "Would a maintainer of this codebase recognise this partition as a sensible map of its architecture — " +
          "each zone a unit they would name and reason about — rather than a scatter of fragments or arbitrary groupings?",
        {
          yes: "Most zones are coherent units: a feature, a layer, a package, a subsystem. A few small zones are fine when they are genuinely standalone.",
          no: "Many zones are one or two files that belong with a neighbour, or files from one feature are split across several zones, or zones mix unrelated features.",
        },
      ),
    },
  };
}

/** Probability that the map is sensible, or undefined when Jev is unavailable. */
export async function judgePartitionMap(
  zones: Zone[],
  crossings: ZoneCrossing[],
): Promise<number | undefined> {
  if (zones.length === 0 || getJudgmentRoute("zone.judge") !== "typesafe") return undefined;
  const request = buildPartitionMapRequest(zones, crossings);
  try {
    const response = await askJev(request, { taskClass: "zone.judge" });
    const answer = response.answers.map;
    return answer?.type === "noul" ? round2(answer.noul) : undefined;
  } catch (err) {
    if (err instanceof ClaudeClientError) {
      console.warn(`  [partition] map judgment failed (${err.reason}) — deterministic signals only`);
      return undefined;
    }
    throw err;
  }
}

// ── Decision ─────────────────────────────────────────────────────────────────

export interface PartitionDecision {
  /** False when the previous partition must not be reused or used as a Louvain seed. */
  trustPrevious: boolean;
  review: PartitionReview;
  /** False when the review was carried from an earlier run for this fingerprint. */
  fresh: boolean;
}

/**
 * Decide whether the previous partition may be reused (inputs unchanged) or
 * used as the stability seed (inputs changed). A partition already rejected
 * for this `inputFingerprint` is trusted as-is: the fresh one it was replaced
 * with is what this run holds, and re-partitioning again would loop.
 */
export async function reviewPreviousPartition(
  previous: { zones: Zone[]; crossings?: ZoneCrossing[]; partitionReview?: PartitionReview },
  inputFingerprint: string,
  opts: { judge?: typeof judgePartitionMap; maxZonePercent?: number } = {},
): Promise<PartitionDecision> {
  const prior = previous.partitionReview;
  if (prior?.rejected && prior.fingerprint === inputFingerprint) {
    return { trustPrevious: true, review: prior, fresh: false };
  }
  const health = assessPartitionHealth(previous.zones, opts.maxZonePercent);

  let mapProbability: number | undefined;
  let rejected = health.verdict === "fragmented";
  if (health.verdict === "borderline") {
    mapProbability = await (opts.judge ?? judgePartitionMap)(previous.zones, previous.crossings ?? []);
    rejected = mapProbability !== undefined && mapProbability <= MAP_REJECT_MAX_PROBABILITY;
  }

  return {
    trustPrevious: !rejected,
    fresh: true,
    review: {
      fingerprint: inputFingerprint,
      health,
      rejected,
      ...(mapProbability !== undefined ? { mapProbability } : {}),
    },
  };
}

/** The one `[partition]` CLI line, or undefined when there is nothing to say. */
export function formatPartitionLine(review: PartitionReview): string | undefined {
  const h = review.health;
  if (!review.rejected && h.verdict === "healthy") return undefined;
  const judged = review.mapProbability !== undefined ? `, map judged ${review.mapProbability}` : "";
  if (!review.rejected) {
    return `  [partition] kept previous partition (${(h.reasons ?? []).join("; ")}${judged})`;
  }
  const after = review.after
    ? ` → ${review.after.zones} zones, ${review.after.smallZones} small`
    : "";
  return `  [partition] previous partition rejected (${(h.reasons ?? []).join("; ")}${judged}) — re-partitioned without stability bias${after}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
