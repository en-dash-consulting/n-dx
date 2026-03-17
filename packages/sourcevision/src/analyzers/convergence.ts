/**
 * Convergence tracking for zone metrics across analysis runs.
 *
 * After each analysis, a snapshot of zone metrics is created and optionally
 * persisted. On subsequent runs, the current snapshot is compared against
 * the previous one to produce a delta report showing which zones improved,
 * regressed, or remained stable.
 *
 * This enables the improvement loop to detect whether overrides are actually
 * fixing problems or just suppressing warnings.
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Zone } from "../schema/index.js";

/** Snapshot of a single zone's metrics at a point in time. */
export interface ZoneMetricSnapshot {
  zoneId: string;
  zoneName: string;
  cohesion: number;
  coupling: number;
  riskScore: number;
  fileCount: number;
  timestamp: string;
  gitSha?: string;
}

/** Full convergence report persisted after each analysis run. */
export interface ConvergenceReport {
  schemaVersion: string;
  snapshots: ZoneMetricSnapshot[];
  analyzedAt: string;
  gitSha?: string;
}

/** Direction of metric change for a single zone. */
export type MetricDirection = "improved" | "regressed" | "stable";

/** Delta for a single zone between two snapshots. */
export interface ZoneDelta {
  zoneId: string;
  cohesionDelta: number;
  couplingDelta: number;
  riskDelta: number;
  direction: MetricDirection;
}

/** Summary of deltas across all zones. */
export interface DeltaSummary {
  improved: number;
  regressed: number;
  stable: number;
  overallRiskDelta: number;
}

/** Full delta report comparing current vs previous snapshots. */
export interface DeltaReport {
  zoneDeltas: ZoneDelta[];
  newZones: string[];
  removedZones: string[];
  summary: DeltaSummary;
}

/** Minimum risk delta to consider a zone as changed (not stable). */
const STABILITY_THRESHOLD = 0.02;

/** Maximum number of history files to retain. */
const MAX_HISTORY_FILES = 30;

/**
 * Create a snapshot of current zone metrics.
 */
export function createSnapshot(
  zones: Zone[],
  gitSha?: string,
): ZoneMetricSnapshot[] {
  const timestamp = new Date().toISOString();
  return zones.map((zone) => ({
    zoneId: zone.id,
    zoneName: zone.name,
    cohesion: zone.cohesion,
    coupling: zone.coupling,
    riskScore: zone.riskMetrics?.riskScore ?? ((1 - zone.cohesion) + zone.coupling) / 2,
    fileCount: zone.files.length,
    timestamp,
    ...(gitSha ? { gitSha } : {}),
  }));
}

/**
 * Compute deltas between current and previous snapshots.
 */
export function computeDeltas(
  current: ZoneMetricSnapshot[],
  previous: ZoneMetricSnapshot[],
): DeltaReport {
  const prevMap = new Map(previous.map((s) => [s.zoneId, s]));
  const currMap = new Map(current.map((s) => [s.zoneId, s]));

  const zoneDeltas: ZoneDelta[] = [];
  const newZones: string[] = [];
  const removedZones: string[] = [];

  for (const curr of current) {
    const prev = prevMap.get(curr.zoneId);
    if (!prev) {
      newZones.push(curr.zoneId);
      continue;
    }

    const cohesionDelta = +(curr.cohesion - prev.cohesion).toFixed(4);
    const couplingDelta = +(curr.coupling - prev.coupling).toFixed(4);
    const riskDelta = +(curr.riskScore - prev.riskScore).toFixed(4);

    let direction: MetricDirection;
    if (Math.abs(riskDelta) <= STABILITY_THRESHOLD) {
      direction = "stable";
    } else if (riskDelta < 0) {
      direction = "improved";
    } else {
      direction = "regressed";
    }

    zoneDeltas.push({ zoneId: curr.zoneId, cohesionDelta, couplingDelta, riskDelta, direction });
  }

  for (const prev of previous) {
    if (!currMap.has(prev.zoneId)) {
      removedZones.push(prev.zoneId);
    }
  }

  const improved = zoneDeltas.filter((d) => d.direction === "improved").length;
  const regressed = zoneDeltas.filter((d) => d.direction === "regressed").length;
  const stable = zoneDeltas.filter((d) => d.direction === "stable").length;
  const overallRiskDelta = zoneDeltas.length > 0
    ? +(zoneDeltas.reduce((sum, d) => sum + d.riskDelta, 0) / zoneDeltas.length).toFixed(4)
    : 0;

  return {
    zoneDeltas,
    newZones,
    removedZones,
    summary: { improved, regressed, stable, overallRiskDelta },
  };
}

/**
 * Load the most recent convergence report from the history directory.
 */
export async function loadLatestReport(svDir: string): Promise<ConvergenceReport | null> {
  const historyDir = join(svDir, "history");
  try {
    const files = await readdir(historyDir);
    const jsonFiles = files.filter((f) => f.endsWith(".json")).sort();
    if (jsonFiles.length === 0) return null;

    const latest = jsonFiles[jsonFiles.length - 1];
    const raw = await readFile(join(historyDir, latest), "utf-8");
    return JSON.parse(raw) as ConvergenceReport;
  } catch {
    return null;
  }
}

/**
 * Save a convergence report to the history directory and prune old entries.
 */
export async function saveReport(svDir: string, report: ConvergenceReport): Promise<void> {
  const historyDir = join(svDir, "history");
  await mkdir(historyDir, { recursive: true });

  const filename = `${report.analyzedAt.replace(/[:.]/g, "-")}.json`;
  await writeFile(
    join(historyDir, filename),
    JSON.stringify(report, null, 2),
    "utf-8",
  );

  // Prune old files
  const files = (await readdir(historyDir)).filter((f) => f.endsWith(".json")).sort();
  if (files.length > MAX_HISTORY_FILES) {
    const { unlink } = await import("node:fs/promises");
    const toRemove = files.slice(0, files.length - MAX_HISTORY_FILES);
    for (const f of toRemove) {
      await unlink(join(historyDir, f));
    }
  }
}

/**
 * Format a delta report as human-readable text lines.
 */
export function formatDeltaReport(delta: DeltaReport): string[] {
  const lines: string[] = [];

  if (delta.zoneDeltas.length === 0 && delta.newZones.length === 0) {
    lines.push("No previous analysis to compare against.");
    return lines;
  }

  const { summary } = delta;
  lines.push(
    `Convergence: ${summary.improved} improved, ${summary.regressed} regressed, ${summary.stable} stable` +
    ` (overall risk Δ: ${summary.overallRiskDelta >= 0 ? "+" : ""}${summary.overallRiskDelta.toFixed(3)})`
  );

  for (const d of delta.zoneDeltas.filter((d) => d.direction !== "stable")) {
    const arrow = d.direction === "improved" ? "↓" : "↑";
    lines.push(
      `  ${arrow} ${d.zoneId}: risk ${d.riskDelta >= 0 ? "+" : ""}${d.riskDelta.toFixed(3)}` +
      ` (cohesion ${d.cohesionDelta >= 0 ? "+" : ""}${d.cohesionDelta.toFixed(3)},` +
      ` coupling ${d.couplingDelta >= 0 ? "+" : ""}${d.couplingDelta.toFixed(3)})`
    );
  }

  if (delta.newZones.length > 0) {
    lines.push(`  New zones: ${delta.newZones.join(", ")}`);
  }
  if (delta.removedZones.length > 0) {
    lines.push(`  Removed zones: ${delta.removedZones.join(", ")}`);
  }

  return lines;
}
