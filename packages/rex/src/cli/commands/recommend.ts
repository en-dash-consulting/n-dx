import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { PROJECT_DIRS } from "@n-dx/llm-client";
import { resolveStore } from "../../store/index.js";
import { REX_DIR } from "./constants.js";
import { syncFolderTree } from "./folder-tree-sync.js";
import { info, result } from "../output.js";
import type { ItemLevel } from "../../schema/index.js";
import {
  computeFindingHash,
  loadAcknowledged,
  saveAcknowledged,
  acknowledgeFinding,
  unacknowledgeFinding,
  resolveAckHash,
  isAcknowledged,
  isAcknowledgedFuzzy,
  ACK_REASON_CATEGORIES,
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
import type {
  RecommendationConflict,
  IntraBatchDuplicate,
} from "../../recommend/conflict-detection.js";

interface Finding {
  type: string;
  severity: string;
  category: string;
  message: string;
  file?: string;
  scope?: string;
  hash: string;
}

interface Recommendation {
  id?: string;
  parentId?: string;
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

/**
 * Detect and parse `--accept=hashes:h1,h2,h3` partial-accept mode. Returns
 * the hash-prefix tokens when the flag uses the hashes selector, or `null`
 * when it doesn't (so the caller falls back to the index-based selector).
 *
 * Accepts both `=hashes:…` and bare `hashes:…` so users don't have to think
 * about the leading `=` they would otherwise need for numeric selectors.
 */
export function parseHashAcceptSelector(flag: string): string[] | null {
  let body = flag.trim();
  if (body.startsWith("=")) body = body.slice(1);
  const PREFIX = "hashes:";
  if (!body.toLowerCase().startsWith(PREFIX)) return null;
  const rest = body.slice(PREFIX.length);
  const tokens = rest
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (tokens.length === 0) {
    throw selectorFormatError(
      "Invalid --accept hashes selector. Expected '=hashes:<hash>[,<hash>,...]'.",
    );
  }
  for (const t of tokens) {
    if (!/^[0-9a-f]{4,}$/i.test(t)) {
      throw selectorFormatError(
        `Invalid finding hash "${t}" in --accept. Hashes are 4+ hex chars (see [xxxxxx] in 'rex recommend' output).`,
      );
    }
  }
  return tokens;
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
      type: f.type ?? "general",
      severity: f.severity!,
      category: f.category ?? f.type ?? "general",
      message: f.message ?? f.text ?? "",
      file: f.file,
      scope: f.scope ?? "global",
      hash: computeFindingHash({
        type: f.type ?? "general",
        scope: f.scope ?? "global",
        text: f.message ?? f.text ?? "",
      }),
    }));
}

/**
 * Derive the zone from a finding. Falls back to "global" when the finding
 * has no file or scope information.
 */
function findingZone(f: Finding): string {
  return f.scope ?? "global";
}

function mapFindingsToRecommendations(
  findings: Finding[],
  maxFindingsPerTask = 3,
): Recommendation[] {
  // Group by zone + category for granular, actionable recommendations
  const grouped = new Map<string, Finding[]>();
  for (const f of findings) {
    const key = `${findingZone(f)}::${f.category}`;
    const group = grouped.get(key) ?? [];
    group.push(f);
    grouped.set(key, group);
  }

  // Collect unique zones for epic description
  const zones = new Set<string>();
  for (const f of findings) zones.add(findingZone(f));

  // Epic: one per recommend run
  const epicId = randomUUID();
  const epicRec: Recommendation = {
    id: epicId,
    title: `Code Health: ${findings.length} findings across ${zones.size} zone${zones.size === 1 ? "" : "s"}`,
    level: "epic",
    description: `Automated recommendations from SourceVision analysis. ${grouped.size} zone+category groups covering ${findings.length} total findings.`,
    priority: findings.some((f) => f.severity === "critical") ? "critical" : "high",
    source: "sourcevision",
    meta: { findingCount: findings.length },
  };

  const recommendations: Recommendation[] = [epicRec];

  for (const [key, items] of grouped) {
    const [zone, category] = key.split("::");
    const hasCritical = items.some((f) => f.severity === "critical");

    // Feature: one per zone+category group
    const featureId = randomUUID();
    const featureHashes = items.map((f) => f.hash);
    const featureSeverity: Record<string, number> = {};
    for (const f of items) {
      featureSeverity[f.severity] = (featureSeverity[f.severity] ?? 0) + 1;
    }

    recommendations.push({
      id: featureId,
      parentId: epicId,
      title: `Fix ${category} in ${zone} (${items.length} finding${items.length === 1 ? "" : "s"})`,
      level: "feature",
      description: items.map((f) => `- ${f.message}`).join("\n"),
      priority: hasCritical ? "critical" : "high",
      source: "sourcevision",
      meta: {
        findingHashes: featureHashes,
        category,
        severityDistribution: featureSeverity,
        findingCount: items.length,
      },
    });

    // Tasks: chunked under the feature
    for (let offset = 0; offset < items.length; offset += maxFindingsPerTask) {
      const chunk = items.slice(offset, offset + maxFindingsPerTask);

      const severityDistribution: Record<string, number> = {};
      for (const f of chunk) {
        severityDistribution[f.severity] = (severityDistribution[f.severity] ?? 0) + 1;
      }

      const firstSummary = chunk[0].message.slice(0, 80);
      const title = chunk.length === 1
        ? `Fix ${category} in ${zone}: ${firstSummary}`
        : `Fix ${category} in ${zone}: ${firstSummary} (+${chunk.length - 1} more)`;

      recommendations.push({
        parentId: featureId,
        title,
        level: "task",
        description: chunk.map((f) => `- ${f.message}`).join("\n"),
        priority: hasCritical ? "critical" : "high",
        source: "sourcevision",
        meta: {
          findingHashes: chunk.map((f) => f.hash),
          category,
          severityDistribution,
          findingCount: chunk.length,
        },
      });
    }
  }

  return recommendations;
}

/**
 * Map local Recommendation type to EnrichedRecommendation for the creation pipeline.
 */
function toEnrichedRecommendation(rec: Recommendation): EnrichedRecommendation {
  return {
    id: rec.id,
    parentId: rec.parentId,
    title: rec.title,
    level: rec.level,
    description: rec.description,
    priority: rec.priority,
    source: rec.source,
    meta: rec.meta,
  };
}

// ── Acknowledge handling ────────────────────────────────────────────────

interface AcknowledgeContext {
  rexDir: string;
  ackStore: Awaited<ReturnType<typeof loadAcknowledged>>;
  findings: Finding[];
}

/**
 * Resolve one ack/unack token to a target Finding (or null when no match).
 * Accepts either a 1-based numeric index into the currently-visible findings
 * list OR a stable finding-hash prefix (4+ hex chars). The hash form is
 * preferred because indices renumber after each acknowledgement.
 */
function resolveFindingToken(
  token: string,
  findings: Finding[],
): Finding | { error: string } | null {
  const t = token.trim();
  if (/^\d+$/.test(t)) {
    const idx = parseInt(t, 10);
    if (idx < 1 || idx > findings.length) {
      return { error: `Index ${idx} out of range (1-${findings.length}).` };
    }
    return findings[idx - 1];
  }
  if (!/^[0-9a-f]{4,}$/i.test(t)) {
    return { error: `"${token}" is neither a 1-based index nor a hash prefix (4+ hex chars).` };
  }
  const lc = t.toLowerCase();
  const matches = findings.filter((f) => f.hash.startsWith(lc));
  if (matches.length === 0) {
    return { error: `No finding matches hash prefix "${token}". Hashes are shown as [xxxxxx] next to each finding.` };
  }
  if (matches.length > 1) {
    return { error: `Hash prefix "${token}" is ambiguous (${matches.length} matches). Provide more characters.` };
  }
  return matches[0];
}

/**
 * Validate a --reason value. Free-form is permitted (so users aren't gated by
 * the canonical list) but unknown reasons get a one-line hint so people
 * discover the canonical vocabulary the analyzer will mine later.
 */
function normalizeReason(input: string | undefined, fallback: string): string {
  const v = (input ?? "").trim();
  if (!v) return fallback;
  const known = ACK_REASON_CATEGORIES as readonly string[];
  if (!known.includes(v)) {
    info(`  (--reason "${v}" is free-form; canonical reasons: ${known.join(", ")})`);
  }
  return v;
}

async function handleAcknowledge(
  flag: string,
  ctx: AcknowledgeContext,
  reasonFlag?: string,
): Promise<void> {
  const { rexDir, ackStore, findings } = ctx;
  const reason = normalizeReason(reasonFlag, "acknowledged");

  if (flag === "all") {
    let updated = ackStore;
    for (const f of findings) {
      updated = acknowledgeFinding(updated, f.hash, f.message, reason, "user", f.type, f.scope);
    }
    await saveAcknowledged(rexDir, updated);
    result(`Acknowledged all ${findings.length} findings (reason: ${reason}).`);
    return;
  }

  const tokens = flag.split(",").map((s) => s.trim()).filter(Boolean);
  let updated = ackStore;
  const acked: string[] = [];
  for (const token of tokens) {
    const resolved = resolveFindingToken(token, findings);
    if (!resolved) continue;
    if ("error" in resolved) {
      console.error(resolved.error);
      continue;
    }
    const f = resolved;
    updated = acknowledgeFinding(updated, f.hash, f.message, reason, "user", f.type, f.scope);
    acked.push(`[${f.hash.slice(0, 6)}] ${f.message.slice(0, 60)}`);
  }
  await saveAcknowledged(rexDir, updated);
  for (const a of acked) result(`Acknowledged: ${a}`);
  if (acked.length > 0) result(`(reason: ${reason})`);
}

/**
 * Remove acknowledgements. Tokens may be either a hash prefix that matches a
 * record in the ack store, or a 1-based index into the currently-visible
 * findings (which the user would typically only see with --show-all).
 */
async function handleUnacknowledge(
  flag: string,
  ctx: AcknowledgeContext,
): Promise<void> {
  const { rexDir, ackStore, findings } = ctx;
  const tokens = flag.split(",").map((s) => s.trim()).filter(Boolean);
  let updated = ackStore;
  const removed: string[] = [];
  for (const token of tokens) {
    // Index path — resolve via current findings list (works with --show-all).
    if (/^\d+$/.test(token)) {
      const resolved = resolveFindingToken(token, findings);
      if (resolved && !("error" in resolved)) {
        if (isAcknowledged(updated, resolved.hash)) {
          updated = unacknowledgeFinding(updated, resolved.hash);
          removed.push(`[${resolved.hash.slice(0, 6)}] ${resolved.message.slice(0, 60)}`);
        } else {
          console.error(`Finding [${resolved.hash.slice(0, 6)}] is not currently acknowledged.`);
        }
      } else if (resolved && "error" in resolved) {
        console.error(resolved.error);
      }
      continue;
    }
    // Hash path — resolve against the ack store directly, so users can undo
    // acks even when the underlying finding no longer surfaces.
    try {
      const fullHash = resolveAckHash(updated, token);
      if (!fullHash) {
        console.error(`No acknowledgement matches hash prefix "${token}".`);
        continue;
      }
      const acked = updated.findings.find((f) => f.hash === fullHash);
      updated = unacknowledgeFinding(updated, fullHash);
      removed.push(`[${fullHash.slice(0, 6)}] ${(acked?.text ?? "").slice(0, 60)}`);
    } catch (err) {
      console.error((err as Error).message);
    }
  }
  await saveAcknowledged(rexDir, updated);
  for (const r of removed) result(`Unacknowledged: ${r}`);
  if (removed.length === 0) {
    result("No acknowledgements removed.");
  }
}

// ── Display recommendations ─────────────────────────────────────────────

function displayRecommendations(
  recommendations: Recommendation[],
  findings: Finding[],
  ackStore: Awaited<ReturnType<typeof loadAcknowledged>>,
  showAll: boolean,
  acknowledgedCount: number,
): void {
  // Display hierarchically: epic → features → tasks
  const tasks = recommendations.filter((r) => r.level === "task");
  const features = recommendations.filter((r) => r.level === "feature");
  const epic = recommendations.find((r) => r.level === "epic");

  if (epic) {
    result(`\n${epic.title}\n`);
  }

  let taskIdx = 0;
  for (const feature of features) {
    result(`  [${feature.priority}] ${feature.title}`);
    const featureTasks = tasks.filter((t) => t.parentId === feature.id);
    for (const task of featureTasks) {
      taskIdx++;
      result(`    ${taskIdx}. ${task.title}`);
      for (const line of task.description.split("\n")) {
        const finding = findings.find((f) => line.includes(f.message));
        const ackMarker = showAll && finding && isAcknowledged(ackStore, finding.hash) ? " (acknowledged)" : "";
        // Show the stable 6-char hash so users can ack/unack by ID without
        // having to count positional indices (which renumber after each ack).
        const hashPrefix = finding ? `[${finding.hash.slice(0, 6)}] ` : "";
        info(`       ${hashPrefix}${line.replace(/^- /, "")}${ackMarker}`);
      }
    }
    info("");
  }

  if (acknowledgedCount > 0) {
    info(`(${acknowledgedCount} finding${acknowledgedCount === 1 ? "" : "s"} acknowledged, use --show-all to include)`);
  }
}

// ── Resolve accepted recommendations from --accept flag ─────────────────

/**
 * Resolve which recommendations to accept based on the --accept flag.
 *
 * Selection indices apply only to tasks (the actionable items). The epic
 * and any features that contain selected tasks are included automatically
 * to maintain hierarchy.
 */
function resolveAcceptedRecommendations(
  acceptFlag: string,
  recommendations: Recommendation[],
): Recommendation[] | null {
  const trimmed = acceptFlag.trim();
  const usesSelectorMode = trimmed !== "true";
  if (usesSelectorMode && !trimmed.startsWith("=")) {
    const hint = suggestSelectorFix(trimmed);
    throw selectorFormatError(
      `Invalid --accept selector format. Expected '=N[,M,...]' when passing a selector.${hint}`,
    );
  }

  const tasks = recommendations.filter((r) => r.level === "task");
  const lowerFlag = trimmed.toLowerCase();
  const isWildcard = lowerFlag === "=all" || trimmed === "=.";
  const selectedIndices = usesSelectorMode
    ? (isWildcard ? null : parseSelectionIndices(trimmed, tasks.length))
    : null;
  const selectedTasks = selectedIndices === null
    ? tasks
    : selectedIndices.map((i) => tasks[i]).filter(Boolean);

  if (selectedTasks.length === 0) {
    info(selectedIndices !== null
      ? "No recommendations matched the selected indices."
      : "No recommendations available to accept.");
    return null;
  }

  // Include structural parents (epic + features) for selected tasks
  const neededParentIds = new Set(selectedTasks.map((t) => t.parentId).filter(Boolean));
  const neededFeatures = recommendations.filter(
    (r) => r.level === "feature" && r.id && neededParentIds.has(r.id),
  );
  const epicParentIds = new Set(neededFeatures.map((f) => f.parentId).filter(Boolean));
  const epic = recommendations.find(
    (r) => r.level === "epic" && r.id && epicParentIds.has(r.id),
  );

  // Return in creation order: epic → features → tasks
  const accepted: Recommendation[] = [];
  if (epic) accepted.push(epic);
  accepted.push(...neededFeatures);
  accepted.push(...selectedTasks);

  return accepted;
}

// ── Report creation results ─────────────────────────────────────────────

interface CreationResult {
  created: Array<{ title: string; level: string; id: string; parentId?: string }>;
  skipped?: Array<{ title: string }>;
  updated?: Array<{ title: string; existingItemId: string }>;
  reparented?: Array<{ title: string; newLevel: string; parentTitle: string }>;
  conflictReport?: { hasConflicts: boolean; conflicts: RecommendationConflict[]; intraBatchDuplicates: IntraBatchDuplicate[] } | null;
}

function reportCreationResults(
  creationResult: CreationResult,
  totalAccepted: number,
  conflictStrategy: ConflictStrategy,
): void {
  const { created, skipped, updated, reparented, conflictReport } = creationResult;

  // Conflict summary (when items were skipped)
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

  // Updated items (pending-item conflicts refreshed in-place)
  if (updated && updated.length > 0) {
    info("");
    for (const u of updated) {
      info(`  ↻ "${u.title}" updated existing pending item ${u.existingItemId}`);
    }
  }

  // Reparented items (completed-item conflicts created as children)
  if (reparented && reparented.length > 0) {
    info("");
    for (const r of reparented) {
      info(`  ↳ "${r.title}" created as ${r.newLevel} under completed "${r.parentTitle}"`);
    }
  }

  // Post-creation item listing
  result("");
  for (const item of created) {
    const placement = item.parentId ? `under ${item.parentId}` : "root";
    result(`  ✓ ${item.title} → ${item.level} ${item.id} (${placement})`);
  }

  // Summary counts — only count tasks (not structural epic/features)
  const createdTasks = created.filter((c) => c.level === "task").length;
  const createdCount = createdTasks > 0 ? createdTasks : created.length;
  const updatedCount = updated?.length ?? 0;
  const skippedCount = skipped?.length ?? 0;
  const reparentedCount = reparented?.length ?? 0;
  const countSuffix = totalAccepted === 1 ? "" : "s";
  const parts: string[] = [`${createdCount}/${totalAccepted} selected recommendation${countSuffix} created`];
  if (updatedCount > 0) parts.push(`${updatedCount} updated`);
  if (reparentedCount > 0) parts.push(`${reparentedCount} reparented`);
  if (skippedCount > 0) parts.push(`${skippedCount} skipped (conflicts)`);
  result(`\n  ${parts.join(", ")}.`);
}

// ── Accept recommendations into the PRD ─────────────────────────────────

async function acceptRecommendations(
  rexDir: string,
  acceptFlag: string,
  recommendations: Recommendation[],
  flags: Record<string, string>,
): Promise<void> {
  const acceptedRecommendations = resolveAcceptedRecommendations(acceptFlag, recommendations);
  if (!acceptedRecommendations) return;

  const totalTasks = recommendations.filter((r) => r.level === "task").length;
  const selectedTasks = acceptedRecommendations.filter((r) => r.level === "task").length;

  // Pre-creation summary
  const isSubset = selectedTasks < totalTasks;
  info(
    isSubset
      ? `\nCreating ${selectedTasks} of ${totalTasks} tasks (plus structural items):\n`
      : `\nCreating ${selectedTasks} task${selectedTasks === 1 ? "" : "s"} (plus structural items):\n`,
  );
  for (let i = 0; i < acceptedRecommendations.length; i++) {
    const rec = acceptedRecommendations[i];
    const indent = rec.level === "epic" ? "" : rec.level === "feature" ? "  " : "    ";
    info(`  ${indent}[${rec.priority}] ${rec.title} (${rec.level})`);
  }
  info("");

  // Hierarchical recommendations (epic → features → tasks) use "force" strategy:
  // each run creates a fresh hierarchy with unique IDs, and the acknowledgment
  // system handles finding dedup between runs. The conflict detection was designed
  // for flat recommendations and would false-positive on parent↔child title similarity.
  const isHierarchical = acceptedRecommendations.some((r) => r.level === "epic");
  const conflictStrategy: ConflictStrategy =
    isHierarchical ? "force" : (flags.force !== undefined ? "force" : "skip");
  const enriched = acceptedRecommendations.map(toEnrichedRecommendation);
  const store = await resolveStore(rexDir);

  let creationResult: Awaited<ReturnType<typeof createItemsFromRecommendations>>;
  try {
    creationResult = await createItemsFromRecommendations(
      store,
      enriched,
      { conflictStrategy },
    );
  } catch (err) {
    result(`\n✗ Creation failed: ${(err as Error).message}`);
    result(`\n  0/${selectedTasks} selected recommendation${selectedTasks === 1 ? "" : "s"} created.`);
    throw err;
  }

  reportCreationResults(creationResult, selectedTasks, conflictStrategy);
  await syncFolderTree(rexDir, store);
}

// ── Main command entry point ────────────────────────────────────────────

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
      : allFindings.filter((f) => !isAcknowledgedFuzzy(ackStore, { hash: f.hash, type: f.type, scope: f.scope ?? "global", text: f.message }));
    await handleAcknowledge(flags.acknowledge, { rexDir, ackStore, findings }, flags.reason);
    return;
  }

  // Handle --unacknowledge flag — undo prior acknowledgements by hash or index.
  if (flags.unacknowledge) {
    // For unack we always want every finding visible so index/hash resolution
    // matches what the user sees with --show-all.
    await handleUnacknowledge(flags.unacknowledge, { rexDir, ackStore, findings: allFindings });
    return;
  }

  // Handle --acknowledge-completed: acknowledge findings from completed tasks
  if (flags["acknowledge-completed"] !== undefined) {
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    let updated = ackStore;
    let count = 0;
    // Build a hash→finding map for type+scope lookup
    const findingsByHash = new Map(allFindings.map((f) => [f.hash, f]));
    const walk = (items: typeof doc.items): void => {
      for (const item of items) {
        if (item.status === "completed" && item.source === "sourcevision") {
          const meta = item.recommendationMeta as RecommendationMeta | undefined;
          if (meta?.findingHashes) {
            for (const hash of meta.findingHashes) {
              if (!isAcknowledged(updated, hash)) {
                const finding = findingsByHash.get(hash);
                updated = acknowledgeFinding(
                  updated, hash, item.title, "completed", "self-heal",
                  finding?.type, finding?.scope,
                );
                count++;
              }
            }
          }
        }
        if (item.children) walk(item.children);
      }
    };
    walk(doc.items);
    if (count > 0) {
      await saveAcknowledged(rexDir, updated);
      result(`Acknowledged ${count} findings from completed tasks.`);
    } else {
      result("No new findings to acknowledge from completed tasks.");
    }
    return;
  }

  // Filter acknowledged findings unless --show-all
  const showAll = flags["show-all"] !== undefined;
  const isFuzzyAcked = (f: Finding) => isAcknowledgedFuzzy(ackStore, { hash: f.hash, type: f.type, scope: f.scope ?? "global", text: f.message });
  const findings = showAll
    ? allFindings
    : allFindings.filter((f) => !isFuzzyAcked(f));
  const acknowledgedCount = allFindings.length - allFindings.filter((f) => !isFuzzyAcked(f)).length;

  // --actionable-only: keep only concretely actionable finding types
  const ACTIONABLE_TYPES = new Set(["anti-pattern", "suggestion", "move-file"]);
  const actionableOnly = flags["actionable-only"] !== undefined;
  const excludeStructural = flags["exclude-structural"] !== undefined;
  let filteredFindings = actionableOnly
    ? findings.filter((f) => ACTIONABLE_TYPES.has(f.type))
    : findings;

  // --exclude-structural: skip findings categorized as structural (zone boundary opinions)
  let structuralSkipped = 0;
  if (excludeStructural) {
    const before = filteredFindings.length;
    filteredFindings = filteredFindings.filter((f) => f.category !== "structural");
    structuralSkipped = before - filteredFindings.length;
  }

  // --accept=hashes:h1,h2 partial-accept mode: filter the finding list down to
  // just the selected hashes BEFORE grouping into recommendations, then
  // implicitly switch the selector to =all so every regenerated recommendation
  // is created. Lets the user cherry-pick a subset of findings inside what
  // would otherwise be an all-or-nothing recommendation group.
  if (flags.accept) {
    const hashTokens = parseHashAcceptSelector(flags.accept);
    if (hashTokens) {
      const normalized = hashTokens.map((t) => t.toLowerCase());
      const matched = filteredFindings.filter((f) =>
        normalized.some((h) => f.hash.startsWith(h)),
      );
      const unmatched = normalized.filter(
        (h) => !filteredFindings.some((f) => f.hash.startsWith(h)),
      );
      for (const h of unmatched) {
        console.error(`No finding matches hash prefix "${h}".`);
      }
      filteredFindings = matched;
      flags = { ...flags, accept: "=all" };
    }
  }

  if (filteredFindings.length === 0) {
    result("No findings to recommend.");
    if (acknowledgedCount > 0) {
      info(`(${acknowledgedCount} finding${acknowledgedCount === 1 ? "" : "s"} acknowledged, use --show-all to include)`);
    }
    if (actionableOnly && findings.length > 0) {
      info(`(${findings.length} non-actionable finding${findings.length === 1 ? "" : "s"} filtered out by --actionable-only)`);
    }
    if (structuralSkipped > 0) {
      info(`(${structuralSkipped} structural finding${structuralSkipped === 1 ? "" : "s"} excluded, use without --exclude-structural to include)`);
    }
    return;
  }

  const maxPerTask = flags["max-findings-per-task"]
    ? parseInt(flags["max-findings-per-task"], 10)
    : 10;
  const recommendations = mapFindingsToRecommendations(filteredFindings, maxPerTask);

  if (flags.format === "json") {
    result(JSON.stringify(recommendations, null, 2));
    return;
  }

  displayRecommendations(recommendations, filteredFindings, ackStore, showAll, acknowledgedCount);

  if (structuralSkipped > 0) {
    info(`(${structuralSkipped} structural finding${structuralSkipped === 1 ? "" : "s"} excluded by --exclude-structural)`);
  }

  // Hint about zone pins when structural findings are present
  const hasStructural = filteredFindings.some((f) => f.category === "structural");
  if (hasStructural) {
    info("");
    info("Tip: Structural findings reflect zone boundary opinions. If assignments look wrong,");
    info("  override them with zone pins: ndx config sourcevision.zones.pins '{\"file.ts\": \"zone-id\"}'");
  }

  if (flags.accept) {
    await acceptRecommendations(rexDir, flags.accept, recommendations, flags);
  } else {
    info("Run with --accept to add all recommendations to the PRD.");
    info("Cherry-pick by finding hash (partial accept within a group):");
    info("  rex recommend --accept=hashes:a3f5d8,b91c42");
    info("Acknowledge findings by stable hash (survives renumbering):");
    info("  rex recommend --acknowledge=a3f5d8,b91c42 --reason=over-engineered");
    info("Indices still work but renumber after each ack: --acknowledge=1,2");
    info("Undo with --unacknowledge=<hash|index>.");
  }
}
