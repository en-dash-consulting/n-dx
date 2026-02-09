/**
 * Derive prioritized, agent-ready next steps from analysis findings.
 */

import type { Zones, Zone, Finding, NextStep } from "../schema/index.js";

export type { NextStep };

/**
 * Derive actionable next steps from zone analysis findings.
 * Groups related findings, assigns priorities, and sorts by importance.
 */
export function deriveNextSteps(zones: Zones): NextStep[] {
  const findings = zones.findings ?? [];
  if (findings.length === 0) return [];

  const zoneList = zones.zones;
  const steps: NextStep[] = [];
  const usedFindings = new Set<number>();

  // 1. Critical findings → high priority "fix" steps
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (f.severity !== "critical" || usedFindings.has(i)) continue;

    // Group with related critical findings in the same scope
    const related = [i];
    usedFindings.add(i);
    for (let j = i + 1; j < findings.length; j++) {
      if (usedFindings.has(j)) continue;
      if (findings[j].severity === "critical" && findings[j].scope === f.scope) {
        related.push(j);
        usedFindings.add(j);
      }
    }

    const zone = zoneList.find((z) => z.id === f.scope);
    const files = zone ? zone.files.slice(0, 3) : [];
    const filesStr = files.length > 0 ? ` Files: ${files.join(", ")}` : "";

    steps.push({
      priority: "high",
      title: summarizeFindings(findings, related),
      description: `${f.text}${filesStr}`,
      category: "fix",
      relatedFindings: related,
      scope: f.scope,
    });
  }

  // 2. Anti-patterns with warning severity → medium priority "refactor" steps
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (usedFindings.has(i)) continue;
    if (f.type !== "anti-pattern" || f.severity !== "warning") continue;

    const related = [i];
    usedFindings.add(i);
    // Group related anti-patterns in the same scope (must also be warning severity)
    for (let j = i + 1; j < findings.length; j++) {
      if (usedFindings.has(j)) continue;
      if (findings[j].type === "anti-pattern" && findings[j].severity === "warning" && findings[j].scope === f.scope) {
        related.push(j);
        usedFindings.add(j);
      }
    }

    const zone = zoneList.find((z) => z.id === f.scope);
    const files = zone ? zone.files.slice(0, 3) : [];
    const filesStr = files.length > 0 ? ` Files: ${files.join(", ")}` : "";

    // Promote to high when any grouped finding has broad impact or zone health is poor
    const apImpact = related.some((idx) => isHighImpact(findings[idx], zoneList));

    steps.push({
      priority: apImpact ? "high" : "medium",
      title: summarizeFindings(findings, related),
      description: `${f.text}${filesStr}`,
      category: "refactor",
      relatedFindings: related,
      scope: f.scope,
    });
  }

  // 3. Warning-level coupling/relationship findings → medium "extract" steps
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (usedFindings.has(i)) continue;
    if (f.severity !== "warning") continue;
    if (f.type !== "relationship" && f.type !== "pattern") continue;

    const related = [i];
    usedFindings.add(i);
    for (let j = i + 1; j < findings.length; j++) {
      if (usedFindings.has(j)) continue;
      if (findings[j].severity === "warning" && findings[j].scope === f.scope &&
          (findings[j].type === "relationship" || findings[j].type === "pattern")) {
        related.push(j);
        usedFindings.add(j);
      }
    }

    const zone = zoneList.find((z) => z.id === f.scope);
    const files = zone ? zone.files.slice(0, 3) : [];
    const filesStr = files.length > 0 ? ` Files: ${files.join(", ")}` : "";

    const relImpact = related.some((idx) => isHighImpact(findings[idx], zoneList));

    steps.push({
      priority: relImpact ? "high" : "medium",
      title: summarizeFindings(findings, related),
      description: `${f.text}${filesStr}`,
      category: "extract",
      relatedFindings: related,
      scope: f.scope,
    });
  }

  // 4. Suggestions → priority based on severity
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (usedFindings.has(i)) continue;
    if (f.type !== "suggestion") continue;

    const related = [i];
    usedFindings.add(i);

    let sugPriority: NextStep["priority"];
    if (f.severity === "warning") {
      sugPriority = isHighImpact(f, zoneList) ? "high" : "medium";
    } else {
      sugPriority = "low";
    }

    steps.push({
      priority: sugPriority,
      title: truncateText(f.text, 80),
      description: f.text,
      category: "refactor",
      relatedFindings: related,
      scope: f.scope,
    });
  }

  // 5. Remaining warning-level findings
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i];
    if (usedFindings.has(i)) continue;
    if (f.severity !== "warning") continue;

    usedFindings.add(i);

    const zone = zoneList.find((z) => z.id === f.scope);
    const files = zone ? zone.files.slice(0, 3) : [];
    const filesStr = files.length > 0 ? ` Files: ${files.join(", ")}` : "";

    steps.push({
      priority: isHighImpact(f, zoneList) ? "high" : "medium",
      title: truncateText(f.text, 80),
      description: `${f.text}${filesStr}`,
      category: categorizeFromType(f.type),
      relatedFindings: [i],
      scope: f.scope,
    });
  }

  // Sort: high > medium > low, then by impact score (related count + zone metrics), then by grouped findings count
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  steps.sort((a, b) => {
    const po = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (po !== 0) return po;
    const impactA = groupImpactScore(findings, a.relatedFindings, zoneList);
    const impactB = groupImpactScore(findings, b.relatedFindings, zoneList);
    if (impactA !== impactB) return impactB - impactA;
    return b.relatedFindings.length - a.relatedFindings.length;
  });

  return steps;
}

function summarizeFindings(findings: Finding[], indices: number[]): string {
  if (indices.length === 1) {
    return truncateText(findings[indices[0]].text, 80);
  }
  const f = findings[indices[0]];
  return truncateText(f.text, 60) + ` (+${indices.length - 1} related)`;
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "\u2026";
}

/** Threshold of related items at which a warning finding is considered high-impact. */
const HIGH_IMPACT_RELATED_THRESHOLD = 4;

/** Zone health penalty threshold for priority promotion (0–2 scale). */
const ZONE_HEALTH_THRESHOLD = 1.2;

/**
 * Compute a zone health penalty from cohesion and coupling metrics.
 * Returns 0–2 range: 0 = perfectly healthy, 2 = worst possible health.
 * Low cohesion (loosely related files) and high coupling (many cross-zone deps)
 * both increase the penalty.
 */
function zoneHealthPenalty(zone: Zone): number {
  return (1 - zone.cohesion) + zone.coupling;
}

/**
 * Determine whether a finding's impact warrants priority promotion.
 * Considers both the breadth of related items and the health of the
 * zone the finding is scoped to (low cohesion + high coupling = higher impact).
 */
function isHighImpact(finding: Finding, zoneList: Zone[]): boolean {
  if ((finding.related?.length ?? 0) >= HIGH_IMPACT_RELATED_THRESHOLD) return true;

  const zone = zoneList.find((z) => z.id === finding.scope);
  if (zone && zoneHealthPenalty(zone) >= ZONE_HEALTH_THRESHOLD) return true;

  return false;
}

/**
 * Compute an impact score for a group of findings, combining related counts
 * with zone health penalties. Higher score = higher impact.
 */
function groupImpactScore(findings: Finding[], indices: number[], zoneList: Zone[]): number {
  let score = 0;
  for (const i of indices) {
    score += findings[i].related?.length ?? 0;
    const zone = zoneList.find((z) => z.id === findings[i].scope);
    if (zone) score += zoneHealthPenalty(zone);
  }
  return score;
}

function categorizeFromType(type: string): NextStep["category"] {
  switch (type) {
    case "anti-pattern": return "fix";
    case "suggestion": return "refactor";
    case "relationship": return "extract";
    case "pattern": return "refactor";
    default: return "refactor";
  }
}
