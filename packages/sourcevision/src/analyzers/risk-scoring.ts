/**
 * Architectural risk scoring for zones.
 *
 * Computes risk metrics from cohesion/coupling measurements, classifies zones
 * into risk levels, and emits deterministic findings (pass 0) for zones
 * exceeding governance thresholds.
 *
 * Consolidates five overlapping suggestions about architectural risk thresholds
 * into a single, consistent framework:
 *
 * - Governance threshold: cohesion < 0.4 AND coupling > 0.6
 * - Risk levels: healthy → at-risk → critical → catastrophic
 * - Catastrophic: cohesion < 0.3 AND coupling > 0.7
 *
 * Supports risk justifications: zones with a documented justification in
 * .n-dx.json are still assessed but their findings are downgraded to
 * informational severity and annotated with the justification text.
 *
 * All findings are deterministic — no AI invocation required.
 */

import type { Zone, Zones, Finding } from "../schema/index.js";
import type { ZoneRiskMetrics, RiskJustificationEntry } from "../schema/v1.js";

export type { ZoneRiskMetrics };

// ── Thresholds ──────────────────────────────────────────────────────────────

/**
 * Governance thresholds for architectural risk.
 * Zones with cohesion below the floor AND coupling above the ceiling
 * require mandatory refactoring before new feature development.
 */
export const RISK_THRESHOLDS = {
  /** Zones with cohesion below this are at risk. */
  cohesionFloor: 0.4,
  /** Zones with coupling above this are at risk. */
  couplingCeiling: 0.6,
  /** Cohesion below this with coupling above couplingCeiling = catastrophic. */
  catastrophicCohesion: 0.3,
  /** Coupling above this with cohesion below cohesionFloor = catastrophic. */
  catastrophicCoupling: 0.7,
} as const;

// ── Risk computation ────────────────────────────────────────────────────────

/**
 * Compute a normalized risk score from cohesion and coupling.
 * Returns 0–1 where 0 = perfectly healthy, 1 = worst possible.
 *
 * Formula: (1 - cohesion + coupling) / 2
 * Low cohesion and high coupling both contribute equally.
 */
export function computeRiskScore(cohesion: number, coupling: number): number {
  const c = Math.max(0, Math.min(1, cohesion));
  const k = Math.max(0, Math.min(1, coupling));
  return ((1 - c) + k) / 2;
}

/**
 * Classify a zone into a risk level based on cohesion and coupling.
 *
 * - **healthy**: both metrics within acceptable range
 * - **at-risk**: one metric outside thresholds (but not both)
 * - **critical**: both cohesion < 0.4 AND coupling > 0.6
 * - **catastrophic**: cohesion < 0.3 AND coupling > 0.7
 */
export function classifyRiskLevel(
  cohesion: number,
  coupling: number
): ZoneRiskMetrics["riskLevel"] {
  const lowCohesion = cohesion < RISK_THRESHOLDS.cohesionFloor;
  const highCoupling = coupling > RISK_THRESHOLDS.couplingCeiling;

  if (lowCohesion && highCoupling) {
    // Both thresholds breached — check severity
    if (
      cohesion < RISK_THRESHOLDS.catastrophicCohesion &&
      coupling > RISK_THRESHOLDS.catastrophicCoupling
    ) {
      return "catastrophic";
    }
    return "critical";
  }

  if (lowCohesion || highCoupling) {
    return "at-risk";
  }

  return "healthy";
}

/**
 * Compute full risk metrics for a single zone.
 */
export function assessZoneRisk(zone: Zone, justification?: string): ZoneRiskMetrics {
  const riskScore = computeRiskScore(zone.cohesion, zone.coupling);
  const riskLevel = classifyRiskLevel(zone.cohesion, zone.coupling);
  const failsThreshold =
    zone.cohesion < RISK_THRESHOLDS.cohesionFloor &&
    zone.coupling > RISK_THRESHOLDS.couplingCeiling;

  return {
    cohesion: zone.cohesion,
    coupling: zone.coupling,
    riskScore,
    riskLevel,
    failsThreshold,
    ...(justification ? { riskJustification: justification } : {}),
  };
}

// ── Batch assessment ────────────────────────────────────────────────────────

export interface RiskAssessmentResult {
  /** Per-zone risk metrics keyed by zone ID. */
  metrics: Record<string, ZoneRiskMetrics>;
  /** Deterministic findings (pass 0) for zones exceeding thresholds. */
  findings: Finding[];
}

/** Options for batch risk assessment. */
export interface RiskAssessmentOptions {
  /**
   * Risk justifications from .n-dx.json config.
   * Justified zones are still assessed but their findings are downgraded
   * to informational severity.
   */
  justifications?: RiskJustificationEntry[];
}

/**
 * Assess architectural risk for all zones and emit findings.
 *
 * Findings are deterministic (pass 0) — they use only structural zone metrics,
 * no AI invocation.
 *
 * When justifications are provided, justified zones have their findings
 * downgraded to "info" severity and annotated with the justification text.
 */
export function assessAllZoneRisks(
  zones: Zones,
  opts?: RiskAssessmentOptions,
): RiskAssessmentResult {
  const metrics: Record<string, ZoneRiskMetrics> = {};
  const findings: Finding[] = [];

  // Build justification lookup
  const justificationMap = new Map<string, string>();
  if (opts?.justifications) {
    for (const j of opts.justifications) {
      justificationMap.set(j.zone, j.reason);
    }
  }

  // Compute metrics for all zones
  const assessed: Array<{ zone: Zone; risk: ZoneRiskMetrics; justified: boolean }> = [];
  for (const zone of zones.zones) {
    const justification = justificationMap.get(zone.id);
    const risk = assessZoneRisk(zone, justification);
    metrics[zone.id] = risk;
    if (risk.riskLevel !== "healthy") {
      assessed.push({ zone, risk, justified: !!justification });
    }
  }

  // Sort by risk score descending (worst first)
  assessed.sort((a, b) => b.risk.riskScore - a.risk.riskScore);

  // Emit per-zone findings
  for (const { zone, risk, justified } of assessed) {
    if (justified) {
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zone.id,
        text: formatJustifiedFinding(zone, risk),
        severity: "info",
      });
    } else {
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zone.id,
        text: formatZoneFinding(zone, risk),
        severity: riskLevelToSeverity(risk.riskLevel),
      });
    }
  }

  // Emit global summary if multiple unjustified zones fail the governance threshold
  const failingZones = assessed.filter(({ risk, justified }) => risk.failsThreshold && !justified);
  if (failingZones.length >= 2) {
    findings.push({
      type: "suggestion",
      pass: 0,
      scope: "global",
      text:
        `${failingZones.length} zones exceed architectural risk thresholds ` +
        `(cohesion < ${RISK_THRESHOLDS.cohesionFloor}, coupling > ${RISK_THRESHOLDS.couplingCeiling}): ` +
        `${failingZones.map(({ zone }) => zone.id).join(", ")} — ` +
        `mandatory refactoring recommended before further development`,
      severity: "warning",
      related: failingZones.map(({ zone }) => zone.id),
    });
  }

  return { metrics, findings };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatZoneFinding(zone: Zone, risk: ZoneRiskMetrics): string {
  const level = risk.riskLevel;
  const action =
    level === "catastrophic"
      ? "requires immediate architectural intervention"
      : level === "critical"
        ? "requires refactoring before new feature development"
        : "approaching architectural risk thresholds";

  return (
    `Zone "${zone.name}" (${zone.id}) has ${level} risk ` +
    `(score: ${risk.riskScore.toFixed(2)}, cohesion: ${risk.cohesion.toFixed(2)}, ` +
    `coupling: ${risk.coupling.toFixed(2)}) — ${action}`
  );
}

function formatJustifiedFinding(zone: Zone, risk: ZoneRiskMetrics): string {
  return (
    `Zone "${zone.name}" (${zone.id}) has ${risk.riskLevel} risk ` +
    `(score: ${risk.riskScore.toFixed(2)}, cohesion: ${risk.cohesion.toFixed(2)}, ` +
    `coupling: ${risk.coupling.toFixed(2)}) — justified: ${risk.riskJustification}`
  );
}

function riskLevelToSeverity(
  level: ZoneRiskMetrics["riskLevel"]
): Finding["severity"] {
  switch (level) {
    case "catastrophic":
      return "critical";
    case "critical":
      return "warning";
    case "at-risk":
      return "info";
    default:
      return "info";
  }
}
