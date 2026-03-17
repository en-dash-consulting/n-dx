/**
 * Scope creep detection for container items (epics, features).
 *
 * Detects when a container's child count has grown significantly beyond
 * its initial count (stored as item metadata `initialChildCount`).
 *
 * @module rex/core/scope-creep
 */

import type { PRDItem } from "../schema/index.js";
import { isContainerLevel } from "../schema/index.js";
import { walkTree } from "./tree.js";

/** Result of scope creep detection for a single container. */
export interface ScopeCreepResult {
  id: string;
  title: string;
  level: string;
  initialChildCount: number;
  currentChildCount: number;
  growthPercent: number;
}

/** Default growth threshold: 50% increase triggers a warning. */
const DEFAULT_THRESHOLD = 0.5;

/**
 * Detect containers whose child count has grown beyond the initial count.
 *
 * @param items - PRD item tree
 * @param threshold - growth ratio threshold (default 0.5 = 50% increase)
 * @returns containers that have grown beyond the threshold
 */
export function detectScopeCreep(
  items: PRDItem[],
  threshold: number = DEFAULT_THRESHOLD,
): ScopeCreepResult[] {
  const results: ScopeCreepResult[] = [];

  for (const { item } of walkTree(items)) {
    if (!isContainerLevel(item.level)) continue;
    if (!item.children || item.children.length === 0) continue;

    const initial = (item as Record<string, unknown>).initialChildCount;
    if (typeof initial !== "number" || initial <= 0) continue;

    const current = item.children.filter((c: PRDItem) => c.status !== "deleted").length;
    const growth = (current - initial) / initial;

    if (growth > threshold) {
      results.push({
        id: item.id,
        title: item.title,
        level: item.level,
        initialChildCount: initial,
        currentChildCount: current,
        growthPercent: Math.round(growth * 100),
      });
    }
  }

  return results;
}

/**
 * Set the initial child count on a container item.
 * Call this when a container is first created or when resetting the baseline.
 */
export function setInitialChildCount(item: PRDItem): void {
  const count = item.children?.filter((c) => c.status !== "deleted").length ?? 0;
  (item as Record<string, unknown>).initialChildCount = count;
}
