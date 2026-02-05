/**
 * Configuration constants and helpers for AI enrichment passes.
 */

import type {
  Zone,
  ZoneCrossing,
  Finding,
  FindingType,
} from "../schema/index.js";

// ── Constants ────────────────────────────────────────────────────────────────

// ── Batch mode constants ─────────────────────────────────────────────────────

export const ZONES_PER_BATCH = 5;
export const MAX_CONCURRENT_BATCHES = 1;

// ── Per-zone mode constants ──────────────────────────────────────────────────

/** Max concurrent zone enrichments in per-zone mode */
export const MAX_CONCURRENT_ZONES = 3;
/** Max files to include in single-zone prompt (higher than batch since context is smaller) */
export const PER_ZONE_MAX_FILES = 15;
/** Max boundary crossings to include in single-zone prompt */
export const PER_ZONE_MAX_CROSSINGS = 20;

// ── Shared constants ─────────────────────────────────────────────────────────

export const IDLE_TIMEOUT_MS = 120_000;   // 2 min with no output = stuck
export const OVERALL_TIMEOUT_MS = 1_200_000; // 20 min hard cap

// ── Pass configuration ───────────────────────────────────────────────────────

/** Configuration for each enrichment pass — maps to expected finding types */
export interface PassConfig {
  focus: string;
  expectedTypes: FindingType[];
}

export const PASS_CONFIGS: PassConfig[] = [
  { focus: "", expectedTypes: ["observation"] }, // pass 0 = algorithmic only
  {
    focus: "For each zone, provide a meaningful name, description, and 2-3 actionable observations about its role and quality. Assign severity to each finding: most observations are \"info\", flag anything concerning as \"warning\".",
    expectedTypes: ["observation"],
  },
  {
    focus: "Focus on relationships BETWEEN zones. What architectural patterns exist? Where are the clean boundaries vs leaky abstractions? Assign severity: relationships are \"info\", leaky abstractions are \"warning\".",
    expectedTypes: ["pattern", "relationship"],
  },
  {
    focus: "Identify concrete problems: tight coupling that should be broken, missing abstraction layers, files that belong in a different zone, zones that should be split or merged. Most anti-patterns should be \"warning\" or \"critical\" severity.",
    expectedTypes: ["anti-pattern"],
  },
  {
    focus: "Look for subtle patterns: naming inconsistencies, risk areas (high coupling + low cohesion), implicit conventions, and specific refactoring opportunities. Suggestions are \"info\", urgent refactors are \"warning\".",
    expectedTypes: ["suggestion"],
  },
];

export function getPassConfig(pass: number, existingFindingsCount?: number): PassConfig {
  if (pass < PASS_CONFIGS.length) return PASS_CONFIGS[pass];
  // Pass 5+ = meta-evaluation
  return {
    focus: `You are reviewing all ${existingFindingsCount ?? 0} findings from previous analysis passes. Your tasks:
1. SEVERITY REASSESSMENT: Review each finding and assign or update severity (info/warning/critical) based on impact
2. META-PATTERNS: Look across all findings for higher-order patterns not captured by any individual finding
3. ACTIONABLE SUGGESTIONS: Convert vague observations into specific, actionable refactoring steps
4. CONTRADICTIONS: Flag any findings that contradict each other
Return updated severity assignments, new meta-findings, and improved suggestions.`,
    expectedTypes: ["suggestion", "anti-pattern", "pattern"],
  };
}

// ── Prompt builders ──────────────────────────────────────────────────────────

/**
 * Build a meta-evaluation prompt that sends accumulated findings
 * instead of zone structure, for pass 5+.
 */
export function buildMetaPrompt(
  zones: Zone[],
  findings: Finding[],
  crossings: ZoneCrossing[],
): string {
  // Group findings by zone
  const findingsByZone = new Map<string, Finding[]>();
  const globalFindings: Finding[] = [];
  for (const f of findings) {
    if (f.scope === "global") {
      globalFindings.push(f);
    } else {
      let list = findingsByZone.get(f.scope);
      if (!list) { list = []; findingsByZone.set(f.scope, list); }
      list.push(f);
    }
  }

  const zonesSummary = zones.map((z) => {
    const zf = findingsByZone.get(z.id) ?? [];
    const findingsStr = zf.map((f, i) =>
      `  ${i}: [${f.severity ?? "unset"}] (${f.type}) ${f.text}`
    ).join("\n");
    return `Zone "${z.id}" (${z.name}, ${z.files.length} files, cohesion: ${z.cohesion}, coupling: ${z.coupling})\n${findingsStr || "  (no findings)"}`;
  }).join("\n\n");

  const globalStr = globalFindings.map((f, i) =>
    `  ${i}: [${f.severity ?? "unset"}] (${f.type}) ${f.text}`
  ).join("\n");

  return `META-EVALUATION: Review all ${findings.length} findings from previous analysis passes.

Zone Summaries with Findings:
${zonesSummary}

Global Findings:
${globalStr || "  (none)"}

Cross-zone crossings: ${crossings.length} total across ${new Set(crossings.map(c => c.fromZone + "\u2192" + c.toZone)).size} zone pairs.

Your tasks:
1. SEVERITY REASSESSMENT: For any findings where severity should change, include severityUpdates.
2. META-PATTERNS: Look across ALL findings for higher-order patterns.
3. ACTIONABLE SUGGESTIONS: Convert vague observations into specific refactoring steps.
4. CONTRADICTIONS: Flag findings that contradict each other.

Each finding MUST include a "severity" field: "info" (informational), "warning" (should fix), or "critical" (must fix).

Respond with ONLY a JSON object:
{"severityUpdates":[{"findingIndex":0,"newSeverity":"warning"}],"zones":[{"id":"zone-id","newInsights":[],"findings":[{"type":"suggestion","scope":"zone-id","text":"...","severity":"warning"}]}],"insights":["meta-observation"],"findings":[{"type":"pattern","scope":"global","text":"...","severity":"info"}]}

Empty arrays are fine. Do NOT repeat existing findings.`;
}

// ── Attempt configuration ────────────────────────────────────────────────────

/** Compute attempt configs with timeouts that scale with file/zone count and pass complexity.
 *  When batching, pass the batch's file/zone counts (not totals).
 *  Pass 1 (naming + initial insights) is the heaviest — needs 1.5x the base.
 *  Minimum 5 minutes to avoid burning tokens on premature timeouts. */
export function computeAttemptConfigs(totalFiles: number, zoneCount: number, passNumber: number = 1) {
  const sizeBase = totalFiles * 400 + zoneCount * 5_000;
  const passMultiplier = passNumber === 1 ? 1.5 : 1;
  const base = Math.min(600_000, Math.max(480_000, Math.round(sizeBase * passMultiplier)));
  return [
    { maxFiles: 8, maxCrossings: 15, timeout: Math.min(base, 600_000) },
    { maxFiles: 3, maxCrossings: 8,  timeout: Math.min(Math.round(base * 1.3), 600_000) },
    { maxFiles: 0, maxCrossings: 5,  timeout: Math.min(Math.round(base * 1.6), 600_000) },
  ];
}

/** Compute attempt configs for per-zone enrichment (single zone at a time).
 *  Since we're only sending one zone, we can include more files and crossings.
 *  Shorter base timeout since context is smaller. */
export function computePerZoneAttemptConfigs(zoneFileCount: number, passNumber: number = 1) {
  const sizeBase = zoneFileCount * 600 + 10_000;
  const passMultiplier = passNumber === 1 ? 1.3 : 1;
  const base = Math.min(300_000, Math.max(120_000, Math.round(sizeBase * passMultiplier)));
  return [
    { maxFiles: PER_ZONE_MAX_FILES, maxCrossings: PER_ZONE_MAX_CROSSINGS, timeout: Math.min(base, 300_000) },
    { maxFiles: 8,  maxCrossings: 12, timeout: Math.min(Math.round(base * 1.3), 300_000) },
    { maxFiles: 3,  maxCrossings: 6,  timeout: Math.min(Math.round(base * 1.6), 300_000) },
  ];
}
