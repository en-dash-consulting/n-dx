/**
 * JSON parsing and finding extraction for AI enrichment responses.
 */

import type {
  Zone,
  Finding,
  FindingType,
  AnalyzeTokenUsage,
} from "../schema/index.js";

// ── JSON parsing ─────────────────────────────────────────────────────────────

export function tryParseJSON(response: string): any | null {
  // Direct parse
  try {
    const parsed = JSON.parse(response);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}

  // Extract from markdown fences
  const fenceMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  // Find largest JSON object in response
  const objectMatch = response.match(/\{[\s\S]*\}/);
  if (objectMatch) {
    try {
      const parsed = JSON.parse(objectMatch[0]);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {}
  }

  // Find JSON array → wrap as {zones: [...]}
  const arrayMatch = response.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) return { zones: parsed, insights: [] };
    } catch {}
  }

  return null;
}

// ── Finding extraction ───────────────────────────────────────────────────────

/**
 * Extract findings from AI response. Handles both new `findings` format
 * and legacy `insights` strings. Falls back to converting insights to findings.
 */
export function extractFindings(
  parsed: any,
  passNumber: number,
  expectedTypes: FindingType[]
): Finding[] {
  const findings: Finding[] = [];
  const defaultType = expectedTypes[0] ?? "observation";
  const validTypes: FindingType[] = ["observation", "pattern", "relationship", "anti-pattern", "suggestion"];
  const validSeverities = ["info", "warning", "critical"];

  const parseFinding = (f: any, fallbackScope: string) => {
    if (f && typeof f === "object" && typeof f.text === "string") {
      const type: FindingType = validTypes.includes(f.type) ? f.type : defaultType;
      findings.push({
        type,
        pass: passNumber,
        scope: typeof f.scope === "string" ? f.scope : fallbackScope,
        text: f.text,
        ...(validSeverities.includes(f.severity) ? { severity: f.severity } : {}),
        ...(Array.isArray(f.related) ? { related: f.related.filter((r: any) => typeof r === "string") } : {}),
      });
    }
  };

  // New format: parsed has a top-level "findings" array
  if (Array.isArray(parsed.findings)) {
    for (const f of parsed.findings) parseFinding(f, "global");
  }

  // Also extract from per-zone findings in zones array
  if (Array.isArray(parsed.zones)) {
    for (const z of parsed.zones) {
      if (!z || typeof z !== "object") continue;
      const zoneId = z.id ?? z.algorithmicId ?? "unknown";
      if (Array.isArray(z.findings)) {
        for (const f of z.findings) parseFinding(f, zoneId);
      }
    }
  }

  // Legacy fallback: convert insights strings to findings
  if (findings.length === 0) {
    // Global insights
    if (Array.isArray(parsed.insights)) {
      for (const s of parsed.insights) {
        if (typeof s === "string") {
          findings.push({
            type: defaultType,
            pass: passNumber,
            scope: "global",
            text: s,
          });
        }
      }
    }
    // Per-zone insights
    if (Array.isArray(parsed.zones)) {
      for (const z of parsed.zones) {
        if (!z || typeof z !== "object") continue;
        const zoneId = z.id ?? z.algorithmicId ?? "unknown";
        const insightsArr = z.insights ?? z.newInsights;
        if (Array.isArray(insightsArr)) {
          for (const s of insightsArr) {
            if (typeof s === "string") {
              findings.push({
                type: defaultType,
                pass: passNumber,
                scope: zoneId,
                text: s,
              });
            }
          }
        }
      }
    }
  }

  return findings;
}

// ── Zone merging ─────────────────────────────────────────────────────────────

/**
 * Merge zones that share the same LLM-assigned name.
 * When the LLM recognizes zones across batches as semantically identical,
 * it assigns the same name — this function combines their file lists,
 * entry points, and insights into a single zone.
 *
 * Returns the deduplicated zone array (mutates nothing).
 */
export function mergeZonesByName(zones: Zone[]): Zone[] {
  const byName = new Map<string, Zone[]>();

  for (const zone of zones) {
    const key = zone.name.toLowerCase().trim();
    const group = byName.get(key);
    if (group) {
      group.push(zone);
    } else {
      byName.set(key, [zone]);
    }
  }

  const merged: Zone[] = [];
  for (const group of byName.values()) {
    if (group.length === 1) {
      merged.push(group[0]);
      continue;
    }

    // Merge all zones in this group into one
    const primary = group[0];
    const allFiles = new Set(primary.files);
    const allEntryPoints = new Set(primary.entryPoints);
    const allInsights: string[] = [...(primary.insights ?? [])];
    const seenInsights = new Set(allInsights);

    for (let i = 1; i < group.length; i++) {
      for (const f of group[i].files) allFiles.add(f);
      for (const ep of group[i].entryPoints) allEntryPoints.add(ep);
      for (const ins of group[i].insights ?? []) {
        if (!seenInsights.has(ins)) {
          allInsights.push(ins);
          seenInsights.add(ins);
        }
      }
    }

    // Average cohesion/coupling weighted by file count
    let totalFiles = 0;
    let weightedCohesion = 0;
    let weightedCoupling = 0;
    for (const z of group) {
      totalFiles += z.files.length;
      weightedCohesion += z.cohesion * z.files.length;
      weightedCoupling += z.coupling * z.files.length;
    }

    merged.push({
      ...primary,
      files: [...allFiles],
      entryPoints: [...allEntryPoints],
      cohesion: totalFiles > 0 ? Math.round((weightedCohesion / totalFiles) * 100) / 100 : primary.cohesion,
      coupling: totalFiles > 0 ? Math.round((weightedCoupling / totalFiles) * 100) / 100 : primary.coupling,
      insights: allInsights.length > 0 ? allInsights : undefined,
    });
  }

  return merged;
}

// ── Zone ID deduplication ────────────────────────────────────────────────────

/** Ensure no two zones share the same ID (appends -2, -3, etc.) */
export function deduplicateZoneIds(zones: Zone[]): void {
  const usedIds = new Set<string>();
  for (const zone of zones) {
    if (usedIds.has(zone.id)) {
      let suffix = 2;
      while (usedIds.has(`${zone.id}-${suffix}`)) suffix++;
      zone.id = `${zone.id}-${suffix}`;
    }
    usedIds.add(zone.id);
  }
}

// ── Result type ──────────────────────────────────────────────────────────────

export interface EnrichResult {
  /** Zones with AI-assigned IDs/names/descriptions */
  zones: Zone[];
  /** Only the NEW per-zone AI insights from this pass */
  newZoneInsights: Map<string, string[]>;
  /** Only the NEW global AI insights from this pass */
  newGlobalInsights: string[];
  /** Structured findings from this pass */
  newFindings: Finding[];
  /** Pass number (1-based) */
  pass: number;
  /** Updated findings with reassessed severities from meta-evaluation */
  _updatedFindings?: Finding[];
  /** Aggregated token usage across all LLM calls in this enrichment */
  tokenUsage?: AnalyzeTokenUsage;
}
