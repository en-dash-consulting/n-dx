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

// ── Pass configuration ───────────────────────────────────────────────────────

/** Configuration for each enrichment pass — maps to expected finding types */
export interface PassConfig {
  focus: string;
  expectedTypes: FindingType[];
}

export const PASS_CONFIGS: PassConfig[] = [
  { focus: "", expectedTypes: ["observation"] }, // pass 0 = algorithmic only
  {
    focus: `Name each zone by its domain role (avoid "utilities", "misc", numeric suffixes). Provide:
1. A descriptive name
2. A one-sentence architectural purpose
3. 2-3 actionable observations

'-tests' suffix: reserved for zones with ONLY test files; mixed zones use their production name.
Severity: most are "info"; cohesion <0.4 or coupling >0.6 → "warning"; positive architecture → always "info".`,
    expectedTypes: ["observation"],
  },
  {
    focus: `Focus on inter-zone relationships:
- Architectural patterns (layered, hub-and-spoke, circular)
- Clean boundaries and well-defined interfaces → "info"
- Leaky abstractions or missing interfaces → "warning"
- Circular dependencies → "critical"`,
    expectedTypes: ["pattern", "relationship"],
  },
  {
    focus: `Identify concrete problems:
- Tight coupling (zones depending on each other's internals) → "warning"/"critical" by blast radius
- Missing abstraction layers → "warning"
- Misplaced files (wrong zone) → "warning"
- Zones to split (too many concerns) or merge (too few files)
Test-to-implementation coupling is expected; do not flag it.`,
    expectedTypes: ["anti-pattern"],
  },
  {
    focus: `Find subtle improvements:
- Naming inconsistencies → "info"
- Zones with high coupling AND low cohesion (fragile) → "warning"
- Implicit conventions to document/enforce
- Specific refactors with concrete before/after`,
    expectedTypes: ["suggestion"],
  },
];

export function getPassConfig(pass: number, existingFindingsCount?: number): PassConfig {
  if (pass < PASS_CONFIGS.length) return PASS_CONFIGS[pass];
  // Pass 5+ = meta-evaluation (focus is unused in meta prompt path; only expectedTypes is used)
  return {
    focus: `Meta-evaluation pass over ${existingFindingsCount ?? 0} findings.`,
    expectedTypes: ["suggestion", "anti-pattern", "pattern"],
  };
}

// ── Prompt builders ──────────────────────────────────────────────────────────

/** Pass descriptions for meta-evaluation annotations. */
const PASS_LABELS: Record<number, string> = {
  0: "pass 0: automated heuristic",
  1: "pass 1: LLM zone naming + initial observations",
  2: "pass 2: LLM cross-zone relationships",
  3: "pass 3: LLM anti-pattern detection",
  4: "pass 4: LLM suggestions + risk areas",
};

/** Detection method labels for pass 0 findings, inferred from finding text. */
function detectMethod(f: Finding): string {
  if (f.pass !== 0) return "LLM analysis";
  const t = f.text.toLowerCase();
  if (t.startsWith("god function:")) return "call-graph: outgoing-call count";
  if (t.startsWith("tightly coupled modules:")) return "call-graph: cross-file edge count";
  if (t.includes("unused export")) return "call-graph: dead-export scan";
  if (t.startsWith("hub function:")) return "call-graph: fan-in (caller file count)";
  if (t.startsWith("fan-in hotspot:")) return "call-graph: fan-in (caller file count)";
  if (t.includes("cohesion") || t.includes("coupling")) return "zone metrics: cohesion/coupling";
  if (t.includes("entry point")) return "zone metrics: entry-point analysis";
  return "automated heuristic";
}

/** Format a finding line with source pass and detection method annotations. */
function formatAnnotatedFinding(f: Finding, index: number): string {
  const passLabel = PASS_LABELS[f.pass] ?? `pass ${f.pass}: LLM analysis`;
  const method = detectMethod(f);
  return `  ${index}: [${f.severity ?? "unset"}] (${f.type}) [source: ${passLabel}; method: ${method}] ${f.text}`;
}

/**
 * Build a meta-evaluation prompt that sends accumulated findings
 * instead of zone structure, for pass 5+.
 */
export function buildMetaPrompt(
  zones: Zone[],
  findings: Finding[],
  crossings: ZoneCrossing[],
  hints?: string,
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
      formatAnnotatedFinding(f, i)
    ).join("\n");
    return `Zone "${z.id}" (${z.name}, ${z.files.length} files, cohesion: ${z.cohesion}, coupling: ${z.coupling})\n${findingsStr || "  (no findings)"}`;
  }).join("\n\n");

  const globalStr = globalFindings.map((f, i) =>
    formatAnnotatedFinding(f, i)
  ).join("\n");

  return `META-EVALUATION: Review all ${findings.length} findings from previous analysis passes.

Zone Summaries with Findings:
${zonesSummary}

Global Findings:
${globalStr || "  (none)"}

Cross-zone crossings: ${crossings.length} total across ${new Set(crossings.map(c => c.fromZone + "\u2192" + c.toZone)).size} zone pairs.
${hints ? `\nProject context from the developer:\n${hints}\n` : ""}
Constraints:
- Never escalate "pass 0: automated heuristic" findings to "critical" without multiple corroborating findings.
- No decomposition suggestions unless metric exceeds 2× threshold.
- Preserve exact metric values from existing findings; do not round or modify.
- Good architecture → "info". Problems/risks → "warning"/"critical".
- Test-to-implementation coupling is expected; do not flag it.

Tasks:
1. Reassess severities from cumulative evidence; upgrade to "critical" only with multiple corroborating findings.
2. Find meta-patterns across all findings (systemic issues, architectural concerns).
3. Make suggestions concrete — name files/zones; decomposition only if metric exceeds 2× threshold.
4. Flag contradictory findings.

Findings: severity ("info"|"warning"|"critical"), category ("structural"|"code"|"documentation").

Respond with ONLY a JSON object (no markdown, no explanation):
{"severityUpdates":[{"findingIndex":0,"newSeverity":"warning"}],"zones":[{"id":"zone-id","newInsights":[],"findings":[{"type":"suggestion","scope":"zone-id","text":"...","severity":"warning","category":"code"}]}],"insights":["meta-observation"],"findings":[{"type":"pattern","scope":"global","text":"...","severity":"info","category":"code"}]}

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
