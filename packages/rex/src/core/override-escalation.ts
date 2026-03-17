/**
 * Override escalation detection.
 *
 * Identifies zones where tasks are repeatedly resolved via configuration
 * overrides (zone pins, risk justifications, archetype overrides) rather
 * than actual code changes. When 3+ tasks on the same zone are resolved
 * via config-override, an escalation is emitted recommending structural
 * refactoring.
 */

import type { PRDItem } from "../schema/index.js";

/** A single escalation for a zone with accumulated overrides. */
export interface OverrideEscalation {
  zone: string;
  overrideCount: number;
  message: string;
}

/** Result of override accumulation detection. */
export interface OverrideEscalationResult {
  escalations: OverrideEscalation[];
}

/** Minimum consecutive config-override resolutions before escalating. */
const ESCALATION_THRESHOLD = 3;

/**
 * Collect all completed items from a PRD item tree (recursive).
 */
function collectCompletedItems(items: PRDItem[]): PRDItem[] {
  const result: PRDItem[] = [];
  for (const item of items) {
    if (item.status === "completed") {
      result.push(item);
    }
    if (item.children) {
      result.push(...collectCompletedItems(item.children));
    }
  }
  return result;
}

/**
 * Extract zone tags from an item, filtering out finding: and structural-debt tags.
 */
function extractZoneTags(item: PRDItem): string[] {
  if (!item.tags) return [];
  return item.tags.filter(
    (t) => !t.startsWith("finding:") && t !== "structural-debt"
  );
}

/**
 * Scan a PRD item tree for zones with accumulated config-override resolutions.
 *
 * Groups all completed tasks by their zone tag, counts how many have
 * `resolutionType: "config-override"`, and escalates any zone that
 * meets or exceeds the threshold.
 */
export function detectOverrideAccumulation(
  items: PRDItem[]
): OverrideEscalationResult {
  const completed = collectCompletedItems(items);

  // Group override-resolved items by zone tag
  const overridesByZone = new Map<string, number>();
  for (const item of completed) {
    if (item.resolutionType !== "config-override") continue;
    const zoneTags = extractZoneTags(item);
    for (const zone of zoneTags) {
      overridesByZone.set(zone, (overridesByZone.get(zone) ?? 0) + 1);
    }
  }

  const escalations: OverrideEscalation[] = [];
  for (const [zone, count] of overridesByZone) {
    if (count >= ESCALATION_THRESHOLD) {
      escalations.push({
        zone,
        overrideCount: count,
        message:
          `Zone "${zone}" has ${count} tasks resolved via config override — ` +
          `structural refactoring recommended instead of further overrides`,
      });
    }
  }

  // Sort by count descending for consistent output
  escalations.sort((a, b) => b.overrideCount - a.overrideCount);

  return { escalations };
}
