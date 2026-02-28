/**
 * Priority-based scheduling for hench task execution.
 *
 * Resolves the effective scheduling priority for a task by combining
 * multiple priority signals with a clear precedence hierarchy:
 *
 *   CLI override  >  task explicit priority  >  tag-derived priority  >  default (medium)
 *
 * This module bridges the gap between PRD task metadata (where priority
 * lives on the item itself or in tags) and the {@link ExecutionQueue}
 * (which accepts a priority string for queue insertion ordering).
 *
 * @module hench/queue/priority-scheduler
 */

import { normalizePriority } from "./execution-queue.js";
import type { TaskPriority } from "./execution-queue.js";

// ---------------------------------------------------------------------------
// Priority tag patterns
// ---------------------------------------------------------------------------

/**
 * Recognized tag prefixes/keywords that imply a scheduling priority.
 *
 * Two formats are supported:
 * - Explicit: `priority:<level>` (e.g. `priority:high`)
 * - Keyword: `urgent` → critical, `important` → high
 */
const TAG_PREFIX = "priority:";

const KEYWORD_PRIORITY_MAP: Record<string, TaskPriority> = {
  urgent: "critical",
  important: "high",
};

const VALID_PRIORITIES = new Set<string>(["critical", "high", "medium", "low"]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Metadata used to resolve a task's scheduling priority.
 *
 * All fields are optional — absent fields are simply skipped
 * in the resolution chain.
 */
export interface TaskPriorityMetadata {
  /** The task's explicit priority field from the PRD item. */
  taskPriority?: string;
  /** The task's tags (may contain priority hints). */
  tags?: string[];
  /** CLI override (e.g. `--priority=critical`). Highest precedence. */
  cliOverride?: string;
}

// ---------------------------------------------------------------------------
// Tag extraction
// ---------------------------------------------------------------------------

/**
 * Extract a scheduling priority from task tags.
 *
 * Checks tags in order for:
 * 1. `priority:<level>` prefix tags (e.g. `priority:high`)
 * 2. Keyword tags (`urgent` → critical, `important` → high)
 *
 * Returns undefined if no priority signal is found in the tags.
 */
export function extractPriorityFromTags(tags?: string[]): TaskPriority | undefined {
  if (!tags || tags.length === 0) return undefined;

  // First pass: look for explicit `priority:<level>` tags
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower.startsWith(TAG_PREFIX)) {
      const level = lower.slice(TAG_PREFIX.length);
      if (VALID_PRIORITIES.has(level)) {
        return level as TaskPriority;
      }
    }
  }

  // Second pass: look for keyword tags
  for (const tag of tags) {
    const lower = tag.toLowerCase();
    if (lower in KEYWORD_PRIORITY_MAP) {
      return KEYWORD_PRIORITY_MAP[lower];
    }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Priority resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective scheduling priority for a task.
 *
 * Precedence (highest to lowest):
 * 1. CLI override (`--priority` flag) — for urgent manual intervention
 * 2. Task explicit priority (PRD item `priority` field)
 * 3. Tag-derived priority (`priority:high`, `urgent`, `important` tags)
 * 4. Default: `"medium"`
 *
 * Invalid or unrecognized values at any level are normalized to `"medium"`
 * via {@link normalizePriority}.
 *
 * @example
 * ```ts
 * // CLI override wins
 * resolveSchedulingPriority({
 *   cliOverride: "critical",
 *   taskPriority: "low",
 *   tags: ["important"],
 * }); // → "critical"
 *
 * // Task priority without override
 * resolveSchedulingPriority({
 *   taskPriority: "high",
 *   tags: ["urgent"],
 * }); // → "high"
 *
 * // Tag-derived priority as fallback
 * resolveSchedulingPriority({
 *   tags: ["urgent"],
 * }); // → "critical"
 * ```
 */
export function resolveSchedulingPriority(metadata: TaskPriorityMetadata): TaskPriority {
  // 1. CLI override (highest precedence)
  if (metadata.cliOverride != null) {
    return normalizePriority(metadata.cliOverride);
  }

  // 2. Task explicit priority
  if (metadata.taskPriority != null) {
    return normalizePriority(metadata.taskPriority);
  }

  // 3. Tag-derived priority
  const tagPriority = extractPriorityFromTags(metadata.tags);
  if (tagPriority != null) {
    return tagPriority;
  }

  // 4. Default
  return "medium";
}
