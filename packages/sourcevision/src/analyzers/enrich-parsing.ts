/**
 * JSON parsing and finding extraction for AI enrichment responses.
 */

import type {
  Zone,
  Finding,
  FindingType,
  FindingCategory,
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

// ── Finding classification ───────────────────────────────────────────────────

const STRUCTURAL_PATTERNS = [
  /\bzone\b.*\b(?:boundar|split|merg|sprawl|span|assignment|misassign|placement|belongs?\s+in)/i,
  /\b(?:directory|dir)\b.*\b(?:sprawl|consolidat|scatter|spread)/i,
  /\b(?:belongs?\s+in\b.*\bzone|should\s+(?:be\s+in|move\s+to)\b.*\bzone|misplaced|wrong\s+zone)/i,
  /\bzone[\s-]?level\b.*\bcoupling\b/i,
  /\b(?:should\s+be\s+(?:split|merged)|should\s+(?:split|merg))\b/i,
  /\b(?:split|merg\w*)\b.*\bzone\b/i,
  /\btoo\s+(?:many|few)\s+(?:files|zones|directories)\b/i,
  /\bzone\b.*\b(?:too\s+large|too\s+small)\b/i,
];

const CODE_PATTERNS = [
  /\bduplicat(?:ed|ion|e)\b/i,
  /\b(?:dead\s+code|unused\s+export|unused\s+import|god\s+function|god\s+class)\b/i,
  /\b(?:circular\s+(?:dep\w*|import)|cycle)\b/i,
  /\b(?:anti-?pattern|code\s+smell|tight(?:ly)?\s+coupl)/i,
  /\b(?:fan-?in\s+hotspot|hub\s+function|tightly\s+coupled\s+modules)\b/i,
  /\b(?:missing\s+(?:abstraction|interface|error\s+handling))\b/i,
  /\b(?:leaky\s+abstraction|internal\s+detail|implementation\s+detail)\b/i,
];

const DOCUMENTATION_PATTERNS = [
  /\bnaming\s+(?:inconsisten|convention)/i,
  /\bshould\s+be\s+(?:renamed|documented)\b/i,
  /\b(?:implicit\s+convention|undocumented)\b/i,
  /\b(?:jsdoc|readme|comment)\b.*\b(?:missing|needed|should)\b/i,
];

/**
 * Classify a finding as structural, code, or documentation based on text patterns.
 * Returns undefined if no pattern matches (callers should treat as unclassified).
 */
export function classifyFinding(text: string): FindingCategory | undefined {
  // Code patterns take priority — a finding about "circular dependency in zone X"
  // is a code issue, not a structural one
  if (CODE_PATTERNS.some(p => p.test(text))) return "code";
  if (STRUCTURAL_PATTERNS.some(p => p.test(text))) return "structural";
  if (DOCUMENTATION_PATTERNS.some(p => p.test(text))) return "documentation";
  return undefined;
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
  const validCategories: FindingCategory[] = ["structural", "code", "documentation"];

  const parseFinding = (f: any, fallbackScope: string) => {
    if (f && typeof f === "object" && typeof f.text === "string") {
      const type: FindingType = validTypes.includes(f.type) ? f.type : defaultType;
      const explicitCategory: FindingCategory | undefined = validCategories.includes(f.category) ? f.category : undefined;
      const category = explicitCategory ?? classifyFinding(f.text);
      findings.push({
        type,
        pass: passNumber,
        scope: typeof f.scope === "string" ? f.scope : fallbackScope,
        text: f.text,
        ...(validSeverities.includes(f.severity) ? { severity: f.severity } : {}),
        ...(Array.isArray(f.related) ? { related: f.related.filter((r: any) => typeof r === "string") } : {}),
        ...(category ? { category } : {}),
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
          const category = classifyFinding(s);
          findings.push({
            type: defaultType,
            pass: passNumber,
            scope: "global",
            text: s,
            ...(category ? { category } : {}),
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
              const category = classifyFinding(s);
              findings.push({
                type: defaultType,
                pass: passNumber,
                scope: zoneId,
                text: s,
                ...(category ? { category } : {}),
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

// ── Programmatic severity enforcement ────────────────────────────────────────

const POSITIVE_INDICATORS = [
  "successfully", "exemplary", "masterful", "clean separation",
  "well-defined", "well-isolated", "clean design", "good architecture",
  "perfectly maintained", "exceptional", "zero-circular",
  "clean.*hierarchy", "correctly implements", "proper implementation",
];

const TEST_COUPLING_INDICATORS = [
  "test coupling to implementation",
  "test.*suite.*direct calls.*internals",
  "unit test.*coupling",
  "test-to-implementation coupling",
];

/**
 * LLM findings about "missing" zones are false positives when the packages are
 * analyzed as sub-projects (they have their own `.sourcevision/` directories).
 * The LLM doesn't receive sub-analysis context, so it incorrectly interprets
 * partial zone coverage as missing packages.
 */
const ZONE_DETECTION_ARTIFACT_INDICATORS = [
  "missing from zone detection",
  "not.*(?:appear|present|detected).*(?:zone|cluster)",
];

/**
 * Enforce deterministic severity rules that the LLM can't override.
 * Runs after findings are parsed to correct misclassified severities:
 *
 * - Positive/praise findings from LLM passes → downgrade to "info"
 * - Test-coupling anti-patterns → downgrade to "info" (expected by design)
 * - Pass 0 (deterministic heuristic) findings are never modified
 */
export function enforceSeverityRules(findings: Finding[]): Finding[] {
  return findings.map(f => {
    // Rule 1: LLM findings with positive language → info
    if (f.pass >= 1 && f.severity !== "info") {
      const lower = f.text.toLowerCase();
      if (POSITIVE_INDICATORS.some(p => new RegExp(p, "i").test(lower))) {
        return { ...f, severity: "info" };
      }
    }

    // Rule 2: Test-coupling anti-patterns → info
    if (f.pass >= 1 && f.type === "anti-pattern") {
      const lower = f.text.toLowerCase();
      if (TEST_COUPLING_INDICATORS.some(p => new RegExp(p, "i").test(lower))) {
        return { ...f, severity: "info" };
      }
    }

    // Rule 3: Zone detection artifacts (sub-analyzed packages appear "missing") → info
    if (f.pass >= 1 && f.severity !== "info") {
      const lower = f.text.toLowerCase();
      if (ZONE_DETECTION_ARTIFACT_INDICATORS.some(p => new RegExp(p, "i").test(lower))) {
        return { ...f, severity: "info" };
      }
    }

    return f;
  });
}

// ── Finding deduplication ────────────────────────────────────────────────────

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** Normalize finding text for comparison: lowercase, collapse whitespace. */
function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Compute bigram Dice similarity between two normalized strings.
 * Returns 0.0–1.0 where 1.0 is identical.
 */
function bigramSimilarity(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length < 2 || b.length < 2) return a === b ? 1.0 : 0;

  const bigramsA = new Set<string>();
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2));

  const bigramsB = new Set<string>();
  for (let i = 0; i < b.length - 1; i++) bigramsB.add(b.slice(i, i + 2));

  let intersection = 0;
  for (const gram of bigramsA) {
    if (bigramsB.has(gram)) intersection++;
  }

  return (2 * intersection) / (bigramsA.size + bigramsB.size);
}

/** Similarity threshold above which two findings are considered near-duplicates. */
const FINDING_SIMILARITY_THRESHOLD = 0.8;

/**
 * Pick the "best" finding from a cluster of near-duplicates.
 * Prefers: pass 0 findings (calibrated heuristics) → highest severity →
 * most related items → lowest pass number.
 *
 * Pass 0 findings have severity calibrated by code thresholds, so LLM
 * duplicates should never override them. This prevents the meta-evaluation
 * pass from escalating a heuristic "info" to "critical".
 */
function pickBest(cluster: Finding[]): Finding {
  if (cluster.length === 1) return cluster[0];

  return cluster.reduce((best, f) => {
    // Pass 0 findings are authoritative — prefer them over LLM duplicates
    if (best.pass === 0 && f.pass !== 0) return best;
    if (f.pass === 0 && best.pass !== 0) return f;

    const bestSev = SEVERITY_RANK[best.severity ?? ""] ?? 3;
    const fSev = SEVERITY_RANK[f.severity ?? ""] ?? 3;
    if (fSev < bestSev) return f;
    if (fSev > bestSev) return best;

    // Same severity: prefer more related items
    const bestRelated = best.related?.length ?? 0;
    const fRelated = f.related?.length ?? 0;
    if (fRelated > bestRelated) return f;
    if (fRelated < bestRelated) return best;

    // Same related count: prefer lower pass number (earlier discovery)
    return f.pass < best.pass ? f : best;
  });
}

/**
 * Deduplicate findings by detecting near-identical text within the same
 * scope and type. When duplicates are found across different passes,
 * the highest-severity version is kept.
 *
 * Matching is scoped to `(scope, type)` pairs — findings in different
 * scopes or with different types are never merged.
 *
 * Uses bigram Dice similarity (threshold 0.8) for fuzzy text matching,
 * with case-insensitive and whitespace-normalized comparison.
 */
export function deduplicateFindings(findings: Finding[]): Finding[] {
  if (findings.length === 0) return [];

  // Group findings by (scope, type) — only merge within same group
  const groups = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${f.scope}\0${f.type}`;
    const group = groups.get(key);
    if (group) {
      group.push(f);
    } else {
      groups.set(key, [f]);
    }
  }

  const result: Finding[] = [];

  for (const group of groups.values()) {
    if (group.length === 1) {
      result.push(group[0]);
      continue;
    }

    // Union-find clustering for near-duplicate detection
    const n = group.length;
    const parent = Array.from({ length: n }, (_, i) => i);

    function find(i: number): number {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]]; // path compression
        i = parent[i];
      }
      return i;
    }

    function union(a: number, b: number): void {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    }

    // Pre-normalize texts once
    const normalized = group.map((f) => normalizeText(f.text));

    // Compare all pairs within this group
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (bigramSimilarity(normalized[i], normalized[j]) >= FINDING_SIMILARITY_THRESHOLD) {
          union(i, j);
        }
      }
    }

    // Collect clusters and pick best from each
    const clusters = new Map<number, Finding[]>();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      const cluster = clusters.get(root);
      if (cluster) {
        cluster.push(group[i]);
      } else {
        clusters.set(root, [group[i]]);
      }
    }

    for (const cluster of clusters.values()) {
      result.push(pickBest(cluster));
    }
  }

  return result;
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
