/**
 * Structure health score: evaluates the overall quality and organization
 * of a PRD tree across multiple dimensions.
 *
 * Each dimension produces a 0-100 score. The overall score is a weighted
 * average. Suggestions are generated for the lowest-scoring dimensions.
 *
 * @module core/health
 */

import type { PRDItem, StructureHealthThresholds } from "../schema/index.js";
import {
  isContainerLevel,
  isWorkItem,
  isRootLevel,
  getLevelLabel,
  getLevelPlural,
} from "../schema/index.js";
import { walkTree } from "./tree.js";
import { isFullyCompleted, countSubtree } from "./prune.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HealthDimensions {
  /** Are items placed at appropriate depths? (0-100) */
  depth: number;
  /** Are containers roughly equal size? (0-100) */
  balance: number;
  /** Are leaf items similar scope (have descriptions/criteria)? (0-100) */
  granularity: number;
  /** What % of items have descriptions/criteria? (0-100) */
  completeness: number;
  /** Are there stale or stuck items? (0-100) */
  staleness: number;
}

export interface StructureHealthScore {
  /** Composite score 0-100. */
  overall: number;
  dimensions: HealthDimensions;
  /** Top improvement suggestions, most impactful first. */
  suggestions: string[];
}

// ── Configuration ────────────────────────────────────────────────────────────

export interface HealthOptions {
  /** Override "now" for testing. Default: Date.now(). */
  now?: number;
  /** Threshold in ms before an in_progress task is considered stale. Default: 48 hours. */
  staleThresholdMs?: number;
}

const DEFAULT_STALE_MS = 48 * 60 * 60 * 1000; // 48 hours
/** Weights for each dimension in the overall score. */
const WEIGHTS: Record<keyof HealthDimensions, number> = {
  depth: 0.15,
  balance: 0.20,
  granularity: 0.20,
  completeness: 0.25,
  staleness: 0.20,
};

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Compute the structure health score for a PRD tree.
 */
export function computeHealthScore(
  items: PRDItem[],
  options?: HealthOptions,
): StructureHealthScore {
  const now = options?.now ?? Date.now();
  const staleMs = options?.staleThresholdMs ?? DEFAULT_STALE_MS;
  // Collect live items
  const liveItems: PRDItem[] = [];
  for (const { item } of walkTree(items)) {
    if (item.status !== "deleted") liveItems.push(item);
  }

  if (liveItems.length === 0) {
    return {
      overall: 100,
      dimensions: { depth: 100, balance: 100, granularity: 100, completeness: 100, staleness: 100 },
      suggestions: [],
    };
  }

  const dimensions: HealthDimensions = {
    depth: scoreDepth(items),
    balance: scoreBalance(items),
    granularity: scoreGranularity(liveItems),
    completeness: scoreCompleteness(liveItems),
    staleness: scoreStaleness(liveItems, now, staleMs),
  };

  // Weighted overall
  let overall = 0;
  for (const [dim, weight] of Object.entries(WEIGHTS)) {
    overall += dimensions[dim as keyof HealthDimensions] * weight;
  }
  overall = Math.round(overall);

  // Generate suggestions for weak dimensions
  const suggestions = generateSuggestions(dimensions, items, liveItems, now, staleMs);

  return { overall, dimensions, suggestions };
}

// ── Dimension scorers ────────────────────────────────────────────────────────

/**
 * Score depth placement: are items at valid depths per the hierarchy?
 * Penalizes root-level features, deep nesting anomalies, etc.
 */
function scoreDepth(items: PRDItem[]): number {
  let total = 0;
  let violations = 0;

  for (const { item, parents } of walkTree(items)) {
    if (item.status === "deleted") continue;
    total++;

    const depth = parents.length;

    // Root items should be root-level (epics)
    if (depth === 0 && !isRootLevel(item.level)) {
      violations++;
    }

    // Work items at root level is bad
    if (depth === 0 && isWorkItem(item.level)) {
      violations += 2; // Double penalty
    }
  }

  if (total === 0) return 100;
  // Each violation reduces score proportionally
  const ratio = violations / total;
  return Math.round(Math.max(0, 100 - ratio * 200));
}

/**
 * Score balance: are sibling containers roughly equal in size?
 * Uses coefficient of variation (CV) of child counts.
 */
function scoreBalance(items: PRDItem[]): number {
  const cvValues: number[] = [];

  // Check root-level balance
  const rootContainers = items.filter(
    (i) => isContainerLevel(i.level) && i.status !== "deleted",
  );
  if (rootContainers.length >= 2) {
    const sizes = rootContainers.map((c) => countLiveChildren(c));
    const cv = coefficientOfVariation(sizes);
    if (cv !== null) cvValues.push(cv);
  }

  // Check balance within each container
  for (const { item } of walkTree(items)) {
    if (!isContainerLevel(item.level)) continue;
    if (item.status === "deleted") continue;

    const childContainers = (item.children ?? []).filter(
      (c) => isContainerLevel(c.level) && c.status !== "deleted",
    );
    if (childContainers.length < 2) continue;

    const sizes = childContainers.map((c) => countLiveChildren(c));
    const cv = coefficientOfVariation(sizes);
    if (cv !== null) cvValues.push(cv);
  }

  if (cvValues.length === 0) return 100;

  // Average CV across all container groups
  const avgCv = cvValues.reduce((a, b) => a + b, 0) / cvValues.length;

  // CV of 0 = perfect balance (score 100)
  // CV of 1 = moderate imbalance (score ~50)
  // CV of 2+ = severe imbalance (score ~0)
  return Math.round(Math.max(0, 100 - avgCv * 50));
}

/**
 * Score granularity: do work items have appropriate detail?
 * Checks descriptions, acceptance criteria, and consistent sizing.
 */
function scoreGranularity(liveItems: PRDItem[]): number {
  const workItems = liveItems.filter((i) => isWorkItem(i.level));
  if (workItems.length === 0) return 100;

  let score = 100;

  // Penalize work items without descriptions
  const noDesc = workItems.filter((i) => !i.description?.trim()).length;
  score -= (noDesc / workItems.length) * 30;

  // Penalize work items without acceptance criteria
  const noCriteria = workItems.filter(
    (i) => !i.acceptanceCriteria?.length,
  ).length;
  score -= (noCriteria / workItems.length) * 20;

  // Penalize very short titles (< 10 chars)
  const shortTitles = workItems.filter((i) => i.title.length < 10).length;
  score -= (shortTitles / workItems.length) * 15;

  // Penalize containers with single-task features
  const containers = liveItems.filter((i) => isContainerLevel(i.level));
  const singleChild = containers.filter((i) => {
    const live = (i.children ?? []).filter((c) => c.status !== "deleted");
    return live.length === 1;
  }).length;
  if (containers.length > 0) {
    score -= (singleChild / containers.length) * 15;
  }

  return Math.round(Math.max(0, score));
}

/**
 * Score completeness: what fraction of items have substantive metadata?
 */
function scoreCompleteness(liveItems: PRDItem[]): number {
  if (liveItems.length === 0) return 100;

  let totalPoints = 0;
  let earnedPoints = 0;

  for (const item of liveItems) {
    if (isWorkItem(item.level)) {
      // Work items should have: description, acceptance criteria, priority
      totalPoints += 3;
      if (item.description?.trim()) earnedPoints++;
      if (item.acceptanceCriteria?.length) earnedPoints++;
      if (item.priority) earnedPoints++;
    } else if (isContainerLevel(item.level)) {
      // Containers should have: description, children
      totalPoints += 2;
      if (item.description?.trim()) earnedPoints++;
      const liveChildren = (item.children ?? []).filter((c) => c.status !== "deleted");
      if (liveChildren.length > 0) earnedPoints++;
    }
  }

  if (totalPoints === 0) return 100;
  return Math.round((earnedPoints / totalPoints) * 100);
}

/**
 * Score staleness: are there items that haven't progressed?
 */
function scoreStaleness(
  liveItems: PRDItem[],
  now: number,
  staleMs: number,
): number {
  const activeItems = liveItems.filter(
    (i) => i.status !== "completed" && i.status !== "deferred",
  );
  if (activeItems.length === 0) return 100;

  let staleCount = 0;

  for (const item of activeItems) {
    if (item.status === "in_progress" && item.startedAt) {
      const elapsed = now - new Date(item.startedAt).getTime();
      if (elapsed > staleMs) staleCount++;
    }

    // Pending items don't have a createdAt timestamp, so we can't measure
    // staleness by age. Instead, we rely on the structural validator for
    // "blocked without blockedBy" checks. Pending items are not penalized here.

    // Blocked items whose blockers are all completed
    if (item.status === "blocked" && item.blockedBy?.length) {
      // We can't check blocker status without the full tree, so skip this check
      // It's handled by the structural validator instead
    }
  }

  const ratio = staleCount / activeItems.length;
  return Math.round(Math.max(0, 100 - ratio * 150));
}

// ── Suggestion generator ─────────────────────────────────────────────────────

interface SuggestionCandidate {
  dimension: keyof HealthDimensions;
  score: number;
  message: string;
}

function generateSuggestions(
  dimensions: HealthDimensions,
  items: PRDItem[],
  liveItems: PRDItem[],
  now: number,
  staleMs: number,
): string[] {
  const candidates: SuggestionCandidate[] = [];

  // Depth suggestions
  if (dimensions.depth < 80) {
    const rootNonRoot = items.filter(
      (i) => !isRootLevel(i.level) && i.status !== "deleted",
    );
    if (rootNonRoot.length > 0) {
      candidates.push({
        dimension: "depth",
        score: dimensions.depth,
        message: `${rootNonRoot.length} item${rootNonRoot.length === 1 ? "" : "s"} at root level should be moved under a parent ${getLevelLabel("epic").toLowerCase()}.`,
      });
    }
  }

  // Balance suggestions
  if (dimensions.balance < 70) {
    candidates.push({
      dimension: "balance",
      score: dimensions.balance,
      message: "Container sizes are uneven. Consider splitting oversized containers or merging undersized ones.",
    });
  }

  // Granularity suggestions
  if (dimensions.granularity < 70) {
    const workItems = liveItems.filter((i) => isWorkItem(i.level));
    const noDesc = workItems.filter((i) => !i.description?.trim()).length;
    if (noDesc > 0) {
      candidates.push({
        dimension: "granularity",
        score: dimensions.granularity,
        message: `${noDesc} work item${noDesc === 1 ? "" : "s"} missing descriptions. Add context to help implementers understand the intent.`,
      });
    }
  }

  // Completeness suggestions
  if (dimensions.completeness < 70) {
    const workItems = liveItems.filter((i) => isWorkItem(i.level));
    const noCriteria = workItems.filter((i) => !i.acceptanceCriteria?.length).length;
    if (noCriteria > 0) {
      candidates.push({
        dimension: "completeness",
        score: dimensions.completeness,
        message: `${noCriteria} work item${noCriteria === 1 ? "" : "s"} without acceptance criteria. Add verifiable criteria to ensure quality.`,
      });
    }
  }

  // Staleness suggestions
  if (dimensions.staleness < 80) {
    const staleInProgress = liveItems.filter((i) => {
      if (i.status !== "in_progress" || !i.startedAt) return false;
      return (now - new Date(i.startedAt).getTime()) > staleMs;
    });
    if (staleInProgress.length > 0) {
      candidates.push({
        dimension: "staleness",
        score: dimensions.staleness,
        message: `${staleInProgress.length} item${staleInProgress.length === 1 ? "" : "s"} in progress for over 48 hours. Review and update or re-prioritize.`,
      });
    }
  }

  // Sort by score (worst first), take top 3
  candidates.sort((a, b) => a.score - b.score);
  return candidates.slice(0, 3).map((c) => c.message);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function countLiveChildren(item: PRDItem): number {
  return (item.children ?? []).filter((c) => c.status !== "deleted").length;
}

function coefficientOfVariation(values: number[]): number | null {
  if (values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  if (mean === 0) return null;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance) / mean;
}

// ── Formatting ───────────────────────────────────────────────────────────────

const DIM_LABELS: Record<keyof HealthDimensions, string> = {
  depth: "Depth",
  balance: "Balance",
  granularity: "Granularity",
  completeness: "Completeness",
  staleness: "Freshness",
};

function scoreBar(score: number): string {
  const filled = Math.round(score / 5);
  const empty = 20 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function scoreIcon(score: number): string {
  if (score >= 80) return "🟢";
  if (score >= 60) return "🟡";
  return "🔴";
}

/**
 * Format a health score for human-readable display.
 */
export function formatHealthScore(health: StructureHealthScore): string {
  const lines: string[] = [];

  lines.push("Structure Health Score");
  lines.push("─".repeat(50));
  lines.push("");
  lines.push(`  Overall: ${scoreIcon(health.overall)} ${health.overall}/100`);
  lines.push("");

  for (const [key, label] of Object.entries(DIM_LABELS)) {
    const score = health.dimensions[key as keyof HealthDimensions];
    lines.push(`  ${label.padEnd(14)} ${scoreBar(score)} ${score}`);
  }

  if (health.suggestions.length > 0) {
    lines.push("");
    lines.push("Suggestions:");
    for (const s of health.suggestions) {
      lines.push(`  → ${s}`);
    }
  }

  return lines.join("\n");
}

// ── Threshold-based structure checks ────────────────────────────────────────
//
// Proactive PRD structure health checks.
//
// Evaluates the PRD tree against configurable thresholds and returns
// warnings when the structure degrades. Used by CLI write commands
// (add, analyze, plan) and the CI gate.

const STRUCTURE_DEFAULTS: Required<StructureHealthThresholds> = {
  maxTopLevelEpics: 15,
  maxTreeDepth: 5,
  maxChildrenPerContainer: 20,
  minChildrenPerContainer: 2,
};

export interface StructureWarning {
  /** Which threshold was crossed. */
  type: "too-many-epics" | "too-deep" | "oversized-container" | "undersized-container";
  /** Human-readable warning message. */
  message: string;
  /** The actual value that crossed the threshold. */
  actual: number;
  /** The configured threshold. */
  threshold: number;
  /** Item ID for container-specific warnings. */
  itemId?: string;
  /** Item title for container-specific warnings. */
  itemTitle?: string;
}

export interface StructureHealthResult {
  /** True when no thresholds are crossed. */
  healthy: boolean;
  /** Warnings for each crossed threshold. */
  warnings: StructureWarning[];
}

function resolveStructureThresholds(
  overrides?: StructureHealthThresholds,
): Required<StructureHealthThresholds> {
  return { ...STRUCTURE_DEFAULTS, ...overrides };
}

function computeMaxDepth(items: PRDItem[], depth: number = 1): number {
  let max = depth;
  for (const item of items) {
    if (item.children && item.children.length > 0) {
      const childDepth = computeMaxDepth(item.children, depth + 1);
      if (childDepth > max) max = childDepth;
    }
  }
  return max;
}

/**
 * Check the PRD tree against structure health thresholds.
 *
 * @param items - Top-level PRD items
 * @param overrides - Optional threshold overrides from config
 * @returns Health result with warnings for each crossed threshold
 */
export function checkStructureHealth(
  items: PRDItem[],
  overrides?: StructureHealthThresholds,
): StructureHealthResult {
  const thresholds = resolveStructureThresholds(overrides);
  const warnings: StructureWarning[] = [];

  // 1. Top-level epic count
  const epicCount = items.filter((i) => i.status !== "deleted").length;
  if (epicCount > thresholds.maxTopLevelEpics) {
    warnings.push({
      type: "too-many-epics",
      message: `PRD has ${epicCount} top-level epics (threshold: ${thresholds.maxTopLevelEpics}). Consider grouping related epics with /ndx-reshape.`,
      actual: epicCount,
      threshold: thresholds.maxTopLevelEpics,
    });
  }

  // 2. Max tree depth
  const maxDepth = computeMaxDepth(items);
  if (maxDepth > thresholds.maxTreeDepth) {
    warnings.push({
      type: "too-deep",
      message: `PRD tree is ${maxDepth} levels deep (threshold: ${thresholds.maxTreeDepth}). Consider flattening with rex reorganize.`,
      actual: maxDepth,
      threshold: thresholds.maxTreeDepth,
    });
  }

  // 3. Oversized and undersized containers
  function walkContainers(containerItems: PRDItem[]): void {
    for (const item of containerItems) {
      if (item.status === "deleted") continue;
      if (!item.children || item.children.length === 0) continue;

      const activeChildren = item.children.filter((c) => c.status !== "deleted");
      const count = activeChildren.length;

      if (count > thresholds.maxChildrenPerContainer) {
        warnings.push({
          type: "oversized-container",
          message: `"${item.title}" has ${count} children (threshold: ${thresholds.maxChildrenPerContainer}). Consider splitting.`,
          actual: count,
          threshold: thresholds.maxChildrenPerContainer,
          itemId: item.id,
          itemTitle: item.title,
        });
      }

      if (count < thresholds.minChildrenPerContainer) {
        warnings.push({
          type: "undersized-container",
          message: `"${item.title}" has only ${count} child (threshold: ${thresholds.minChildrenPerContainer}). Consider merging with a sibling.`,
          actual: count,
          threshold: thresholds.minChildrenPerContainer,
          itemId: item.id,
          itemTitle: item.title,
        });
      }

      walkContainers(activeChildren);
    }
  }

  walkContainers(items);

  return { healthy: warnings.length === 0, warnings };
}
