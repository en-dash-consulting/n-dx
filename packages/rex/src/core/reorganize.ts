/**
 * Reorganization detector: analyzes PRD tree structure and proposes
 * improvements such as merges, moves, and splits.
 *
 * Philosophy: The PRD is a living document. Reorganize strengthens and
 * clarifies structure — it never deletes or prunes items. Completed work
 * stays as a record of what was built. Use `rex prune` for explicit cleanup.
 *
 * Detection pipeline (ordered by confidence):
 * 1. Structural checks — orphaned features
 * 2. Similarity checks — near-duplicate items
 * 3. Balance checks — oversized/undersized/single-child containers
 *
 * Each detector returns typed proposals that can be previewed, accepted
 * individually, or batch-applied by the executor.
 *
 * @module core/reorganize
 */

import type { PRDItem, ItemLevel } from "../schema/index.js";
import {
  isRootLevel,
  isContainerLevel,
  isWorkItem,
  getLevelLabel,
  getLevelPlural,
} from "../schema/index.js";
import { walkTree, findItem } from "./tree.js";
import { findEpiclessFeatures } from "./structural.js";

import { similarity } from "../analyze/dedupe.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type ProposalType =
  | "merge"
  | "move"
  | "split"
  | "delete"
  | "prune"
  | "collapse";

export type RiskLevel = "low" | "medium" | "high";

export interface ReorganizationProposal {
  /** Unique ID for this proposal (sequential, 1-based). */
  id: number;
  type: ProposalType;
  /** Human-readable description of what this proposal does. */
  description: string;
  /** Why this proposal is being suggested. */
  reason: string;
  /** Confidence score, 0-1. Higher = more certain it's a good change. */
  confidence: number;
  risk: RiskLevel;
  /** IDs of items affected by this proposal. */
  items: string[];
  /** Detail payload (type-specific). */
  detail: ProposalDetail;
}

export type ProposalDetail =
  | MergeDetail
  | MoveDetail
  | SplitDetail
  | DeleteDetail
  | PruneDetail
  | CollapseDetail;

export interface MergeDetail {
  kind: "merge";
  /** IDs of items to merge (all must be siblings). */
  sourceIds: string[];
  /** ID of the surviving item. */
  targetId: string;
}

export interface MoveDetail {
  kind: "move";
  itemId: string;
  /** Current parent (null = root). */
  fromParentId: string | null;
  /** Proposed new parent (null = root). */
  toParentId: string | null;
}

export interface SplitDetail {
  kind: "split";
  /** Container to split. */
  containerId: string;
  /** Proposed groups of child IDs to form new containers. */
  groups: string[][];
  /** Suggested titles for the new containers. */
  suggestedTitles: string[];
}

export interface DeleteDetail {
  kind: "delete";
  itemId: string;
  subtreeCount: number;
}

export interface PruneDetail {
  kind: "prune";
  /** Root items of completed subtrees. */
  itemIds: string[];
  totalCount: number;
}

export interface CollapseDetail {
  kind: "collapse";
  /** Parent with a single child. */
  parentId: string;
  /** The single child that would absorb the parent's role. */
  childId: string;
}

export interface ReorganizationPlan {
  proposals: ReorganizationProposal[];
  /** Summary stats. */
  stats: {
    totalProposals: number;
    byType: Record<ProposalType, number>;
    byRisk: Record<RiskLevel, number>;
    affectedItems: number;
  };
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface DetectorOptions {
  /** Similarity threshold for near-duplicate detection. Default: 0.75 */
  similarityThreshold?: number;
  /** Max children before a container is considered oversized. Default: 15 */
  maxContainerSize?: number;
  /** Min children below which a container is undersized. Default: 2 */
  minContainerSize?: number;
  /** Include completed items in similarity checks. Default: false */
  includeCompleted?: boolean;
}

const DEFAULT_OPTIONS: Required<DetectorOptions> = {
  similarityThreshold: 0.75,
  maxContainerSize: 15,
  minContainerSize: 2,
  includeCompleted: false,
};

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Analyze the PRD tree and produce reorganization proposals.
 * Runs all detection stages and returns a combined, deduplicated plan.
 */
export function detectReorganizations(
  items: PRDItem[],
  options?: DetectorOptions,
): ReorganizationPlan {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const proposals: ReorganizationProposal[] = [];
  let nextId = 1;

  // Stage 1: Structural checks (high confidence)
  for (const p of detectOrphanedFeatures(items)) {
    proposals.push({ ...p, id: nextId++ });
  }
  // Note: Empty container deletion and completed subtree pruning are intentionally
  // excluded from reorganize. The PRD is a living document — completed items stay
  // as a record of what was built. Use `rex prune` for explicit cleanup.

  // Stage 2: Similarity checks (medium confidence)
  for (const p of detectNearDuplicates(items, opts)) {
    proposals.push({ ...p, id: nextId++ });
  }

  // Stage 3: Balance checks (medium confidence)
  for (const p of detectOversizedContainers(items, opts)) {
    proposals.push({ ...p, id: nextId++ });
  }
  for (const p of detectUndersizedContainers(items, opts)) {
    proposals.push({ ...p, id: nextId++ });
  }
  for (const p of detectSingleChildContainers(items)) {
    proposals.push({ ...p, id: nextId++ });
  }

  // Compute stats
  const byType: Record<ProposalType, number> = {
    merge: 0, move: 0, split: 0, delete: 0, prune: 0, collapse: 0,
  };
  const byRisk: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0 };
  const affectedIds = new Set<string>();

  for (const p of proposals) {
    byType[p.type]++;
    byRisk[p.risk]++;
    for (const id of p.items) affectedIds.add(id);
  }

  return {
    proposals,
    stats: {
      totalProposals: proposals.length,
      byType,
      byRisk,
      affectedItems: affectedIds.size,
    },
  };
}

// ── Stage 1: Structural checks ──────────────────────────────────────────────

type PartialProposal = Omit<ReorganizationProposal, "id">;

/**
 * Detect features at root level that should be under an epic.
 * Uses the existing `findEpiclessFeatures()` structural check.
 */
function detectOrphanedFeatures(items: PRDItem[]): PartialProposal[] {
  const orphans = findEpiclessFeatures(items);
  if (orphans.length === 0) return [];

  // Find potential target epics
  const epics = items.filter((i) => isRootLevel(i.level) && i.status !== "deleted");

  return orphans.map((orphan) => {
    // Try to find the best matching epic by title similarity
    let bestEpic: PRDItem | null = null;
    let bestScore = 0;

    for (const epic of epics) {
      const score = similarity(orphan.title, epic.title);
      if (score > bestScore && score > 0.3) {
        bestScore = score;
        bestEpic = epic;
      }
    }

    const toParentId = bestEpic?.id ?? null;
    const suggestion = bestEpic
      ? `Move under "${bestEpic.title}"`
      : "Create a new parent or move under an existing one";

    return {
      type: "move" as const,
      description: `Move orphaned feature "${orphan.title}" under an ${getLevelLabel("epic").toLowerCase()}`,
      reason: `Feature is at root level without a parent ${getLevelLabel("epic").toLowerCase()}. ${suggestion}.`,
      confidence: bestEpic ? 0.7 : 0.5,
      risk: "low" as const,
      items: [orphan.itemId, ...(toParentId ? [toParentId] : [])],
      detail: {
        kind: "move" as const,
        itemId: orphan.itemId,
        fromParentId: null,
        toParentId,
      },
    };
  });
}

// ── Stage 2: Similarity checks ──────────────────────────────────────────────

interface SiblingGroup {
  parentId: string | null;
  parentTitle: string | null;
  level: ItemLevel;
  items: PRDItem[];
}

/**
 * Collect groups of siblings at each level in the tree.
 */
function collectSiblingGroups(items: PRDItem[]): SiblingGroup[] {
  const groups: SiblingGroup[] = [];

  // Root-level items
  const rootItems = items.filter((i) => i.status !== "deleted");
  if (rootItems.length > 1) {
    // Group by level
    const byLevel = new Map<ItemLevel, PRDItem[]>();
    for (const item of rootItems) {
      const arr = byLevel.get(item.level) ?? [];
      arr.push(item);
      byLevel.set(item.level, arr);
    }
    for (const [level, levelItems] of byLevel) {
      if (levelItems.length > 1) {
        groups.push({
          parentId: null,
          parentTitle: null,
          level,
          items: levelItems,
        });
      }
    }
  }

  // Children at each container
  for (const { item } of walkTree(items)) {
    if (!isContainerLevel(item.level)) continue;
    const children = (item.children ?? []).filter((c) => c.status !== "deleted");
    if (children.length < 2) continue;

    // Group children by level
    const byLevel = new Map<ItemLevel, PRDItem[]>();
    for (const child of children) {
      const arr = byLevel.get(child.level) ?? [];
      arr.push(child);
      byLevel.set(child.level, arr);
    }
    for (const [level, levelItems] of byLevel) {
      if (levelItems.length > 1) {
        groups.push({
          parentId: item.id,
          parentTitle: item.title,
          level,
          items: levelItems,
        });
      }
    }
  }

  return groups;
}

/**
 * Detect near-duplicate items that could be merged.
 * Only compares siblings at the same level.
 */
function detectNearDuplicates(
  items: PRDItem[],
  opts: Required<DetectorOptions>,
): PartialProposal[] {
  const proposals: PartialProposal[] = [];
  const groups = collectSiblingGroups(items);

  for (const group of groups) {
    // Filter out completed items unless includeCompleted is set
    const candidates = opts.includeCompleted
      ? group.items
      : group.items.filter((i) => i.status !== "completed");

    if (candidates.length < 2) continue;

    // Compare all pairs
    const merged = new Set<string>();
    for (let i = 0; i < candidates.length; i++) {
      if (merged.has(candidates[i].id)) continue;

      for (let j = i + 1; j < candidates.length; j++) {
        if (merged.has(candidates[j].id)) continue;

        const a = candidates[i];
        const b = candidates[j];

        // Title similarity
        let score = similarity(a.title, b.title);

        // Boost with description similarity if both have descriptions
        if (a.description && b.description) {
          const descScore = similarity(a.description, b.description);
          score = Math.max(score, score * 0.6 + descScore * 0.4);
        }

        if (score >= opts.similarityThreshold) {
          // Pick the richer item as the target
          const targetId = pickRicher(a, b);
          const otherId = targetId === a.id ? b.id : a.id;
          const target = targetId === a.id ? a : b;
          const other = targetId === a.id ? b : a;

          merged.add(otherId);

          const label = getLevelLabel(group.level);
          proposals.push({
            type: "merge",
            description: `Merge similar ${label.toLowerCase()}s: "${other.title}" into "${target.title}"`,
            reason: `These ${label.toLowerCase()}s have ${Math.round(score * 100)}% title/description similarity and appear to cover the same work.`,
            confidence: Math.min(score, 0.85),
            risk: "medium",
            items: [targetId, otherId],
            detail: {
              kind: "merge",
              sourceIds: [targetId, otherId],
              targetId,
            },
          });
        }
      }
    }
  }

  return proposals;
}

/**
 * Pick the "richer" item between two candidates for merge targeting.
 * Prefers items with more children, descriptions, acceptance criteria.
 */
function pickRicher(a: PRDItem, b: PRDItem): string {
  let scoreA = 0;
  let scoreB = 0;

  // More children = richer
  scoreA += (a.children?.length ?? 0) * 10;
  scoreB += (b.children?.length ?? 0) * 10;

  // Has description
  if (a.description) scoreA += 5;
  if (b.description) scoreB += 5;

  // Has acceptance criteria
  if (a.acceptanceCriteria?.length) scoreA += 3;
  if (b.acceptanceCriteria?.length) scoreB += 3;

  // Longer title (more descriptive)
  scoreA += a.title.length;
  scoreB += b.title.length;

  return scoreA >= scoreB ? a.id : b.id;
}

// ── Stage 3: Balance checks ─────────────────────────────────────────────────

/**
 * Detect containers with too many direct children.
 */
function detectOversizedContainers(
  items: PRDItem[],
  opts: Required<DetectorOptions>,
): PartialProposal[] {
  const proposals: PartialProposal[] = [];

  for (const { item } of walkTree(items)) {
    if (!isContainerLevel(item.level)) continue;
    if (item.status === "deleted") continue;

    const liveChildren = (item.children ?? []).filter((c) => c.status !== "deleted");
    if (liveChildren.length <= opts.maxContainerSize) continue;

    const label = getLevelLabel(item.level);
    const childLabel = getLevelPlural(liveChildren[0]?.level ?? item.level);

    proposals.push({
      type: "split",
      description: `Split oversized ${label.toLowerCase()} "${item.title}" (${liveChildren.length} ${childLabel.toLowerCase()})`,
      reason: `This ${label.toLowerCase()} has ${liveChildren.length} direct children, exceeding the recommended maximum of ${opts.maxContainerSize}. Splitting improves navigability.`,
      confidence: 0.6,
      risk: "medium",
      items: [item.id, ...liveChildren.map((c) => c.id)],
      detail: {
        kind: "split",
        containerId: item.id,
        groups: [], // Populated by executor or LLM
        suggestedTitles: [],
      },
    });
  }

  return proposals;
}

/**
 * Detect containers with very few children (below minimum threshold).
 * These might be better merged with a sibling container.
 */
function detectUndersizedContainers(
  items: PRDItem[],
  opts: Required<DetectorOptions>,
): PartialProposal[] {
  const proposals: PartialProposal[] = [];
  const seen = new Set<string>();

  // Check root-level containers
  checkSiblingContainers(items, null, opts, proposals, seen);

  // Check nested containers
  for (const { item } of walkTree(items)) {
    if (!isContainerLevel(item.level)) continue;
    if (item.status === "deleted") continue;
    if (!item.children?.length) continue;
    checkSiblingContainers(item.children, item.id, opts, proposals, seen);
  }

  return proposals;
}

function checkSiblingContainers(
  siblings: PRDItem[],
  parentId: string | null,
  opts: Required<DetectorOptions>,
  proposals: PartialProposal[],
  seen: Set<string>,
): void {
  const containers = siblings.filter(
    (s) => isContainerLevel(s.level) && s.status !== "deleted",
  );
  if (containers.length < 2) return;

  for (const container of containers) {
    if (seen.has(container.id)) continue;

    const liveChildren = (container.children ?? []).filter((c) => c.status !== "deleted");
    if (liveChildren.length >= opts.minContainerSize) continue;
    if (liveChildren.length === 0) continue; // Empty containers handled separately

    // Find a sibling to merge into
    const bestSibling = findBestMergeSibling(container, containers);
    if (!bestSibling) continue;

    seen.add(container.id);

    const label = getLevelLabel(container.level);
    proposals.push({
      type: "merge",
      description: `Merge undersized ${label.toLowerCase()} "${container.title}" (${liveChildren.length} child${liveChildren.length === 1 ? "" : "ren"}) into "${bestSibling.title}"`,
      reason: `This ${label.toLowerCase()} has only ${liveChildren.length} child item${liveChildren.length === 1 ? "" : "s"}, below the recommended minimum of ${opts.minContainerSize}. Consider merging with a related sibling.`,
      confidence: 0.5,
      risk: "medium",
      items: [bestSibling.id, container.id],
      detail: {
        kind: "merge",
        sourceIds: [bestSibling.id, container.id],
        targetId: bestSibling.id,
      },
    });
  }
}

/**
 * Find the best sibling to merge into based on title similarity.
 */
function findBestMergeSibling(
  item: PRDItem,
  siblings: PRDItem[],
): PRDItem | null {
  let best: PRDItem | null = null;
  let bestScore = -1;

  for (const sibling of siblings) {
    if (sibling.id === item.id) continue;
    if (sibling.status === "deleted") continue;

    const score = similarity(item.title, sibling.title);
    if (score > bestScore) {
      bestScore = score;
      best = sibling;
    }
  }

  return best;
}

/**
 * Detect containers with exactly one child — the container can be collapsed
 * by promoting the child or merging into the child.
 */
function detectSingleChildContainers(items: PRDItem[]): PartialProposal[] {
  const proposals: PartialProposal[] = [];

  for (const { item } of walkTree(items)) {
    if (!isContainerLevel(item.level)) continue;
    if (item.status === "deleted" || item.status === "completed") continue;

    const liveChildren = (item.children ?? []).filter((c) => c.status !== "deleted");
    if (liveChildren.length !== 1) continue;

    const child = liveChildren[0];
    // Only propose collapse if the child is also a container
    if (!isContainerLevel(child.level)) continue;

    const parentLabel = getLevelLabel(item.level);
    const childLabel = getLevelLabel(child.level);

    proposals.push({
      type: "collapse",
      description: `Collapse single-child ${parentLabel.toLowerCase()} "${item.title}" → ${childLabel.toLowerCase()} "${child.title}"`,
      reason: `This ${parentLabel.toLowerCase()} has only one child ${childLabel.toLowerCase()}. The intermediate level adds hierarchy without adding organization value.`,
      confidence: 0.65,
      risk: "low",
      items: [item.id, child.id],
      detail: {
        kind: "collapse",
        parentId: item.id,
        childId: child.id,
      },
    });
  }

  return proposals;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<ProposalType, string> = {
  merge: "🔀",
  move: "📦",
  split: "✂️",
  delete: "🗑️",
  prune: "🌿",
  collapse: "📎",
};

const RISK_ICONS: Record<RiskLevel, string> = {
  low: "🟢",
  medium: "🟡",
  high: "🔴",
};

/**
 * Format a reorganization plan for human-readable display.
 */
export function formatReorganizationPlan(plan: ReorganizationPlan): string {
  if (plan.proposals.length === 0) {
    return "No reorganization proposals. The PRD structure looks good.";
  }

  const lines: string[] = [];
  lines.push("Reorganization Proposals");
  lines.push("─".repeat(50));
  lines.push("");

  // Group by type
  const grouped = new Map<ProposalType, ReorganizationProposal[]>();
  for (const p of plan.proposals) {
    const arr = grouped.get(p.type) ?? [];
    arr.push(p);
    grouped.set(p.type, arr);
  }

  for (const [type, proposals] of grouped) {
    const icon = TYPE_ICONS[type];
    lines.push(`${icon} ${capitalize(type)} (${proposals.length})`);
    lines.push("");

    for (const p of proposals) {
      const riskIcon = RISK_ICONS[p.risk];
      lines.push(`  #${p.id} ${riskIcon} ${p.description}`);
      lines.push(`     ${p.reason}`);
      lines.push(`     Confidence: ${Math.round(p.confidence * 100)}% | Risk: ${p.risk}`);
      lines.push("");
    }
  }

  lines.push("─".repeat(50));
  lines.push(
    `${plan.stats.totalProposals} proposal${plan.stats.totalProposals === 1 ? "" : "s"} | ` +
    `${plan.stats.affectedItems} affected item${plan.stats.affectedItems === 1 ? "" : "s"} | ` +
    `Low risk: ${plan.stats.byRisk.low} | Medium: ${plan.stats.byRisk.medium} | High: ${plan.stats.byRisk.high}`,
  );

  return lines.join("\n");
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
