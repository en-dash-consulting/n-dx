import { join } from "node:path";
import { access, readFile } from "node:fs/promises";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { info, result } from "../output.js";
import type { ItemLevel } from "../../schema/index.js";
import {
  computeFindingHash,
  loadAcknowledged,
  saveAcknowledged,
  acknowledgeFinding,
  isAcknowledged,
} from "../../analyze/acknowledge.js";
import {
  createItemsFromRecommendations,
} from "../../recommend/create-from-recommendations.js";
import type {
  EnrichedRecommendation,
  RecommendationMeta,
  ConflictStrategy,
} from "../../recommend/create-from-recommendations.js";
import {
  formatConflict,
  formatIntraBatchDuplicate,
} from "../../recommend/conflict-detection.js";

interface Finding {
  severity: string;
  category: string;
  message: string;
  file?: string;
  hash: string;
}

interface Recommendation {
  title: string;
  level: ItemLevel;
  description: string;
  priority: "critical" | "high" | "medium" | "low";
  source: string;
  /** Metadata from the underlying findings for traceability. */
  meta: RecommendationMeta;
}

function selectorFormatError(detail: string): Error {
  return new Error(`${detail}\nExample: rex recommend --accept='=1,4,5' .`);
}

/**
 * Suggest a correction for a selector missing the '=' prefix.
 * Returns empty string if no suggestion can be inferred.
 */
function suggestSelectorFix(raw: string): string {
  if (/^\d[\d,\s]*$/.test(raw)) {
    const cleaned = raw.replace(/\s+/g, ",").replace(/,+/g, ",").replace(/(^,|,$)/g, "");
    return `\nDid you mean '--accept==${cleaned}'?`;
  }
  return "";
}

/**
 * Detect range syntax like "1-3" in a token and throw with an expansion hint.
 * Returns without throwing if the token is not a range.
 */
function checkRangeSyntax(token: string, context: "full" | "token"): void {
  if (!/^\d+-\d+$/.test(token)) return;

  const [s, e] = token.split("-").map(Number);
  if (s > e) {
    throw selectorFormatError(
      `Invalid range '${token}' (start must be ≤ end). Use comma-separated indices like '=1,4,5'.`,
    );
  }
  const count = e - s + 1;
  if (count <= 20) {
    const expanded = Array.from({ length: count }, (_, i) => s + i).join(",");
    const hint = context === "full"
      ? `Did you mean '=${expanded}'?`
      : `Replace '${token}' with '${expanded}'.`;
    throw selectorFormatError(
      `Range syntax '${token}' is not supported. Use comma-separated indices instead.\n${hint}`,
    );
  }
  throw selectorFormatError(
    `Range syntax '${token}' is not supported. Use comma-separated indices like '=1,2,3' or '=all' for all.`,
  );
}

export function parseSelectionIndices(input: string, total: number): number[] {
  const raw = input.trim();
  if (!raw.startsWith("=")) {
    const hint = suggestSelectorFix(raw);
    throw selectorFormatError(
      `Invalid --accept selector format. Expected '=N[,M,...]'.${hint}`,
    );
  }

  const normalized = raw.slice(1).trim();
  if (!normalized) {
    throw selectorFormatError("Invalid --accept selector format. Expected one or more indices after '='.");
  }

  // Wildcard patterns (case-insensitive for "all")
  if (normalized.toLowerCase() === "all" || normalized === ".") return [];

  // Detect near-misspellings of "all" (e.g., "al", "alll", "aall")
  if (/^a{1,2}l{1,3}$/i.test(normalized)) {
    throw selectorFormatError(
      `Unknown selector keyword '${normalized}'. Did you mean '=all'?`,
    );
  }

  // No recommendations to select from
  if (total === 0) {
    throw new Error(
      "No recommendations available to select from. " +
      "Run 'rex recommend' without --accept to see current recommendations.",
    );
  }

  // Detect range syntax (e.g., "1-3") before splitting
  checkRangeSyntax(normalized, "full");

  const values = normalized
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (values.length === 0) {
    throw selectorFormatError("Invalid --accept selector format. Expected one or more indices after '='.");
  }

  const selected = new Set<number>();
  for (const value of values) {
    // Detect range within a multi-token context (e.g., "1,2-4,5")
    checkRangeSyntax(value, "token");

    if (!/^\d+$/.test(value)) {
      throw selectorFormatError(
        `Invalid --accept selector token '${value}'. Expected numeric indices like '=1,4,5'.`,
      );
    }
    const parsed = Number.parseInt(value, 10);
    if (parsed < 1 || parsed > total) {
      const hint = total === 1
        ? " Only 1 recommendation is available (use '=1')."
        : ` Available indices: 1–${total}.`;
      throw new Error(
        `Invalid --accept selector index ${parsed}. Index must be between 1 and ${total}.${hint}`,
      );
    }
    selected.add(parsed - 1);
  }

  return [...selected].sort((a, b) => a - b);
}

async function detectSourceVision(dir: string): Promise<boolean> {
  try {
    await access(join(dir, PROJECT_DIRS.SOURCEVISION));
    return true;
  } catch {
    return false;
  }
}

interface RawFinding {
  type?: string;
  severity?: string;
  text?: string;
  message?: string;
  scope?: string;
  category?: string;
  file?: string;
}

async function readFindings(
  dir: string,
  severities: string[],
): Promise<Finding[]> {
  const zonesPath = join(dir, PROJECT_DIRS.SOURCEVISION, "zones.json");
  const raw = await readFile(zonesPath, "utf-8");
  const data = JSON.parse(raw);

  const rawFindings: RawFinding[] = data.findings ?? [];
  const sevSet = new Set(severities);

  return rawFindings
    .filter((f) => f.severity && sevSet.has(f.severity))
    .map((f) => ({
      severity: f.severity!,
      category: f.category ?? f.type ?? "general",
      message: f.message ?? f.text ?? "",
      file: f.file,
      hash: computeFindingHash({
        type: f.type ?? "general",
        scope: f.scope ?? "global",
        text: f.message ?? f.text ?? "",
      }),
    }));
}

function mapFindingsToRecommendations(findings: Finding[]): Recommendation[] {
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const group = grouped.get(f.category) ?? [];
    group.push(f);
    grouped.set(f.category, group);
  }

  const recommendations: Recommendation[] = [];
  for (const [category, items] of grouped) {
    const hasCritical = items.some((f) => f.severity === "critical");

    // Compute severity distribution for quality scoring
    const severityDistribution: Record<string, number> = {};
    for (const f of items) {
      severityDistribution[f.severity] = (severityDistribution[f.severity] ?? 0) + 1;
    }

    recommendations.push({
      title: `Address ${category} issues (${items.length} findings)`,
      level: "feature",
      description: items.map((f) => `- ${f.message}`).join("\n"),
      priority: hasCritical ? "critical" : "high",
      source: "sourcevision",
      meta: {
        findingHashes: items.map((f) => f.hash),
        category,
        severityDistribution,
        findingCount: items.length,
      },
    });
  }

  return recommendations;
}

/**
 * Map local Recommendation type to EnrichedRecommendation for the creation pipeline.
 */
function toEnrichedRecommendation(rec: Recommendation): EnrichedRecommendation {
  return {
    title: rec.title,
    level: rec.level,
    description: rec.description,
    priority: rec.priority,
    source: rec.source,
    meta: rec.meta,
  };
}

export async function cmdRecommend(
  dir: string,
  flags: Record<string, string>,
): Promise<void> {
  const hasSourceVision = await detectSourceVision(dir);
  if (!hasSourceVision) {
    result("SourceVision not detected.");
    info("Run 'sourcevision analyze' first, or pass a project with .sourcevision/");
    return;
  }

  let allFindings: Finding[];
  try {
    allFindings = await readFindings(dir, ["warning", "critical"]);
  } catch (err) {
    console.error("Failed to read SourceVision findings:", (err as Error).message);
    return;
  }

  const rexDir = join(dir, REX_DIR);
  const ackStore = await loadAcknowledged(rexDir);

  // Handle --acknowledge flag
  if (flags.acknowledge) {
    const showAll = flags["show-all"] !== undefined;
    const findings = showAll
      ? allFindings
      : allFindings.filter((f) => !isAcknowledged(ackStore, f.hash));

    if (flags.acknowledge === "all") {
      let updated = ackStore;
      for (const f of findings) {
        updated = acknowledgeFinding(updated, f.hash, f.message, "acknowledged", "user");
      }
      await saveAcknowledged(rexDir, updated);
      result(`Acknowledged all ${findings.length} findings.`);
      return;
    }

    const indices = flags.acknowledge.split(",").map((s) => parseInt(s.trim(), 10));
    let updated = ackStore;
    const acked: string[] = [];
    for (const idx of indices) {
      const f = findings[idx - 1]; // 1-based index
      if (!f) {
        console.error(`Finding index ${idx} out of range (1-${findings.length}).`);
        continue;
      }
      updated = acknowledgeFinding(updated, f.hash, f.message, "acknowledged", "user");
      acked.push(`${idx}. ${f.message.slice(0, 60)}`);
    }
    await saveAcknowledged(rexDir, updated);
    for (const a of acked) result(`Acknowledged: ${a}`);
    return;
  }

  // Filter acknowledged findings unless --show-all
  const showAll = flags["show-all"] !== undefined;
  const findings = showAll
    ? allFindings
    : allFindings.filter((f) => !isAcknowledged(ackStore, f.hash));
  const acknowledgedCount = allFindings.length - allFindings.filter((f) => !isAcknowledged(ackStore, f.hash)).length;

  if (findings.length === 0) {
    result("No findings to recommend.");
    if (acknowledgedCount > 0) {
      info(`(${acknowledgedCount} finding${acknowledgedCount === 1 ? "" : "s"} acknowledged, use --show-all to include)`);
    }
    return;
  }

  const recommendations = mapFindingsToRecommendations(findings);

  if (flags.format === "json") {
    result(JSON.stringify(recommendations, null, 2));
    return;
  }

  result(`\n${recommendations.length} recommended items:\n`);
  let displayIdx = 0;
  for (const rec of recommendations) {
    result(`  [${rec.priority}] ${rec.title}`);
    for (const line of rec.description.split("\n")) {
      displayIdx++;
      const finding = findings.find((f) => line.includes(f.message));
      const ackMarker = showAll && finding && isAcknowledged(ackStore, finding.hash) ? " (acknowledged)" : "";
      info(`    ${displayIdx}. ${line.replace(/^- /, "")}${ackMarker}`);
    }
    info("");
  }

  if (acknowledgedCount > 0) {
    info(`(${acknowledgedCount} finding${acknowledgedCount === 1 ? "" : "s"} acknowledged, use --show-all to include)`);
  }

  if (flags.accept) {
    const store = await resolveStore(rexDir);
    const acceptFlag = flags.accept.trim();
    const usesSelectorMode = acceptFlag !== "true";
    if (usesSelectorMode && !acceptFlag.startsWith("=")) {
      const hint = suggestSelectorFix(acceptFlag);
      throw selectorFormatError(
        `Invalid --accept selector format. Expected '=N[,M,...]' when passing a selector.${hint}`,
      );
    }

    const lowerFlag = acceptFlag.toLowerCase();
    const isWildcard = lowerFlag === "=all" || acceptFlag === "=.";
    const selectedIndices = usesSelectorMode
      ? (isWildcard ? null : parseSelectionIndices(acceptFlag, recommendations.length))
      : null;
    const acceptedRecommendations = selectedIndices === null
      ? recommendations
      : selectedIndices.map((i) => recommendations[i]).filter(Boolean);

    if (acceptedRecommendations.length === 0) {
      info(selectedIndices !== null
        ? "No recommendations matched the selected indices."
        : "No recommendations available to accept.");
      return;
    }

    // ── Pre-creation summary ────────────────────────────────────────
    const isSubset = acceptedRecommendations.length < recommendations.length;
    info(
      isSubset
        ? `\nCreating ${acceptedRecommendations.length} of ${recommendations.length} recommendations:\n`
        : `\nCreating ${acceptedRecommendations.length} recommendation${acceptedRecommendations.length === 1 ? "" : "s"}:\n`,
    );
    for (let i = 0; i < acceptedRecommendations.length; i++) {
      const rec = acceptedRecommendations[i];
      info(`  ${i + 1}. [${rec.priority}] ${rec.title} (${rec.level})`);
    }
    info("");

    // ── Determine conflict strategy ──────────────────────────────────
    const conflictStrategy: ConflictStrategy =
      flags.force !== undefined ? "force" : "skip";

    // ── Create items with conflict detection ────────────────────────
    const enriched = acceptedRecommendations.map(toEnrichedRecommendation);
    let creationResult: Awaited<ReturnType<typeof createItemsFromRecommendations>>;
    try {
      creationResult = await createItemsFromRecommendations(
        store,
        enriched,
        { conflictStrategy },
      );
    } catch (err) {
      result(`\n✗ Creation failed: ${(err as Error).message}`);
      result(`\n  0/${acceptedRecommendations.length} selected recommendation${acceptedRecommendations.length === 1 ? "" : "s"} created.`);
      throw err;
    }

    const { created, skipped, reparented, conflictReport } = creationResult;

    // ── Conflict summary (when items were skipped) ──────────────────
    if (conflictReport?.hasConflicts && skipped && skipped.length > 0) {
      info("");
      info(`⚠ ${skipped.length} conflicting recommendation${skipped.length === 1 ? "" : "s"} skipped:`);
      for (const conflict of conflictReport.conflicts) {
        info(`  ⊘ ${formatConflict(conflict)}`);
      }
      for (const dup of conflictReport.intraBatchDuplicates) {
        info(`  ⊘ ${formatIntraBatchDuplicate(dup)}`);
      }
      if (conflictStrategy !== "force") {
        info(`  Use --force to create items regardless of conflicts.`);
      }
    }

    // ── Reparented items (completed-item conflicts created as children) ──
    if (reparented && reparented.length > 0) {
      info("");
      for (const r of reparented) {
        info(`  ↳ "${r.title}" created as ${r.newLevel} under completed "${r.parentTitle}"`);
      }
    }

    // ── Post-creation results ───────────────────────────────────────
    result("");
    for (const item of created) {
      const placement = item.parentId ? `under ${item.parentId}` : "root";
      result(`  ✓ ${item.title} → ${item.level} ${item.id} (${placement})`);
    }

    const total = acceptedRecommendations.length;
    const createdCount = created.length;
    const skippedCount = skipped?.length ?? 0;
    const reparentedCount = reparented?.length ?? 0;
    const countSuffix = total === 1 ? "" : "s";
    const parts: string[] = [`${createdCount}/${total} selected recommendation${countSuffix} created`];
    if (reparentedCount > 0) parts.push(`${reparentedCount} reparented`);
    if (skippedCount > 0) parts.push(`${skippedCount} skipped (conflicts)`);
    result(`\n  ${parts.join(", ")}.`);
  } else {
    info("Run with --accept to add all recommendations to the PRD.");
    info("Run with --acknowledge=1,2 to acknowledge specific findings.");
  }
}
