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
 * Supports two mechanisms for adjusting zone assessment:
 *
 * 1. **Zone types** (preferred): Annotate a zone with its architectural role
 *    (domain, test, integration, etc.) and appropriate thresholds are applied
 *    automatically. No paragraph-length justifications needed.
 *
 * 2. **Risk justifications** (legacy): Zones with a documented justification
 *    in .n-dx.json are still assessed but findings are downgraded to
 *    informational severity. Zone types take precedence when both are present.
 *
 * All findings are deterministic — no AI invocation required.
 */

import type { Zone, Zones, Finding } from "../schema/index.js";
import type { ZoneRiskMetrics, RiskJustificationEntry } from "../schema/v1.js";

export type { ZoneRiskMetrics };

// ── Zone types ──────────────────────────────────────────────────────────────

/**
 * Architectural role of a zone, determining which risk thresholds apply.
 */
export type ZoneType =
  | "domain"         // Standard domain logic: strict thresholds
  | "integration"    // CLI, API routes: naturally high coupling
  | "test"           // Test zones: coupling to subjects is expected
  | "infrastructure" // Build/config files: no cohesion expected
  | "gateway"        // Gateway modules: high coupling by design
  | "orchestration"; // Entry points wiring modules together

/**
 * Per-zone-type threshold overrides. Zones whose metrics fall within
 * their type's thresholds are considered healthy regardless of the
 * global governance thresholds.
 */
export const ZONE_TYPE_THRESHOLDS: Record<ZoneType, { cohesionFloor: number; couplingCeiling: number }> = {
  domain:         { cohesionFloor: 0.4, couplingCeiling: 0.6 },
  integration:    { cohesionFloor: 0.2, couplingCeiling: 0.8 },
  test:           { cohesionFloor: 0.1, couplingCeiling: 0.9 },
  infrastructure: { cohesionFloor: 0.0, couplingCeiling: 1.0 },
  gateway:        { cohesionFloor: 0.1, couplingCeiling: 0.9 },
  orchestration:  { cohesionFloor: 0.2, couplingCeiling: 0.8 },
};

// ── Default thresholds ──────────────────────────────────────────────────────

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
  /**
   * Minimum number of files for reliable health metrics.
   * Zones below this threshold have high-variance cohesion/coupling readings
   * that change dramatically with single-file additions. Findings for these
   * zones are annotated as unreliable.
   */
  minZoneSize: 5,
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
 * When a zone type is provided, uses type-specific thresholds.
 *
 * - **healthy**: both metrics within acceptable range
 * - **at-risk**: one metric outside thresholds (but not both)
 * - **critical**: both metrics outside thresholds
 * - **catastrophic**: both metrics severely outside thresholds
 */
export function classifyRiskLevel(
  cohesion: number,
  coupling: number,
  zoneType?: ZoneType,
): ZoneRiskMetrics["riskLevel"] {
  const thresholds = zoneType ? ZONE_TYPE_THRESHOLDS[zoneType] : undefined;

  const floor = thresholds?.cohesionFloor ?? RISK_THRESHOLDS.cohesionFloor;
  const ceiling = thresholds?.couplingCeiling ?? RISK_THRESHOLDS.couplingCeiling;

  const lowCohesion = cohesion < floor;
  const highCoupling = coupling > ceiling;

  if (lowCohesion && highCoupling) {
    // Both thresholds breached — check severity using proportional distance
    // For typed zones, catastrophic is defined as exceeding the type threshold
    // by the same margin that default catastrophic exceeds default thresholds
    const catastrophicCohesion = zoneType
      ? Math.max(0, floor - (RISK_THRESHOLDS.cohesionFloor - RISK_THRESHOLDS.catastrophicCohesion))
      : RISK_THRESHOLDS.catastrophicCohesion;
    const catastrophicCoupling = zoneType
      ? Math.min(1, ceiling + (RISK_THRESHOLDS.catastrophicCoupling - RISK_THRESHOLDS.couplingCeiling))
      : RISK_THRESHOLDS.catastrophicCoupling;

    if (cohesion < catastrophicCohesion && coupling > catastrophicCoupling) {
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
 * Optionally accepts a zone type for type-specific thresholds.
 */
export function assessZoneRisk(zone: Zone, justification?: string, zoneType?: ZoneType): ZoneRiskMetrics {
  const riskScore = computeRiskScore(zone.cohesion, zone.coupling);
  const riskLevel = classifyRiskLevel(zone.cohesion, zone.coupling, zoneType);

  const thresholds = zoneType ? ZONE_TYPE_THRESHOLDS[zoneType] : undefined;
  const floor = thresholds?.cohesionFloor ?? RISK_THRESHOLDS.cohesionFloor;
  const ceiling = thresholds?.couplingCeiling ?? RISK_THRESHOLDS.couplingCeiling;

  const failsThreshold = zone.cohesion < floor && zone.coupling > ceiling;

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
  /**
   * Zone type annotations from .n-dx.json config.
   * Maps zone ID → zone type. When present, type-specific thresholds
   * are used instead of global defaults. Takes precedence over justifications.
   */
  zoneTypes?: Record<string, ZoneType>;
}

/**
 * Assess architectural risk for all zones and emit findings.
 *
 * Findings are deterministic (pass 0) — they use only structural zone metrics,
 * no AI invocation.
 *
 * Assessment priority:
 * 1. Zone type (if present) → use type-specific thresholds
 * 2. Risk justification (if present) → downgrade findings to info
 * 3. Default thresholds
 */
export function assessAllZoneRisks(
  zones: Zones,
  opts?: RiskAssessmentOptions,
): RiskAssessmentResult {
  const metrics: Record<string, ZoneRiskMetrics> = {};
  const findings: Finding[] = [];

  // Build lookups
  const justificationMap = new Map<string, string>();
  if (opts?.justifications) {
    for (const j of opts.justifications) {
      justificationMap.set(j.zone, j.reason);
    }
  }
  const zoneTypeMap = opts?.zoneTypes ?? {};

  // Compute metrics for all zones
  const assessed: Array<{ zone: Zone; risk: ZoneRiskMetrics; justified: boolean; typed: boolean; smallZone: boolean }> = [];
  for (const zone of zones.zones) {
    const zoneType = zoneTypeMap[zone.id] as ZoneType | undefined;
    const justification = justificationMap.get(zone.id);

    // Zone type takes precedence: if typed, use type thresholds
    const risk = assessZoneRisk(zone, zoneType ? undefined : justification, zoneType);
    metrics[zone.id] = risk;

    if (risk.riskLevel !== "healthy") {
      assessed.push({
        zone,
        risk,
        justified: !zoneType && !!justification,
        typed: !!zoneType,
        smallZone: zone.files.length < RISK_THRESHOLDS.minZoneSize,
      });
    }
  }

  // Sort by risk score descending (worst first)
  assessed.sort((a, b) => b.risk.riskScore - a.risk.riskScore);

  // Emit per-zone findings
  for (const { zone, risk, justified, typed, smallZone } of assessed) {
    if (smallZone) {
      // Small zones have unreliable metrics — downgrade to info
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zone.id,
        text: formatSmallZoneFinding(zone, risk),
        severity: "info",
      });
    } else if (typed) {
      // Zone has a type — it exceeded even the relaxed thresholds
      findings.push({
        type: "suggestion",
        pass: 0,
        scope: zone.id,
        text: formatZoneFinding(zone, risk),
        severity: riskLevelToSeverity(risk.riskLevel),
      });
    } else if (justified) {
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

  // Emit global summary if multiple unjustified/untyped zones fail governance threshold
  const failingZones = assessed.filter(({ risk, justified, typed, smallZone }) =>
    risk.failsThreshold && !justified && !typed && !smallZone
  );
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

function formatSmallZoneFinding(zone: Zone, risk: ZoneRiskMetrics): string {
  return (
    `Zone "${zone.name}" (${zone.id}) has ${risk.riskLevel} risk ` +
    `(score: ${risk.riskScore.toFixed(2)}, cohesion: ${risk.cohesion.toFixed(2)}, ` +
    `coupling: ${risk.coupling.toFixed(2)}) — unreliable: zone has only ` +
    `${zone.files.length} file${zone.files.length === 1 ? "" : "s"} (minimum ${RISK_THRESHOLDS.minZoneSize} for reliable metrics)`
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
