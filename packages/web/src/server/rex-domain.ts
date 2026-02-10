/**
 * Rex domain types and constants — intentionally duplicated from
 * packages/rex/src/schema/v1.ts.
 *
 * The web package does not depend on Rex as a package to keep the two
 * independent at both compile-time and runtime. This is a deliberate
 * architectural choice: the web server must be deployable without Rex
 * installed, and the viewer bundle must work as standalone browser code.
 *
 * Trade-off: duplication creates drift risk, but it's mitigated by:
 *   1. @see annotations pointing back to the canonical source
 *   2. Compile-time consistency tests in tests/unit/server/type-consistency.test.ts
 *   3. The values are stable domain constants that rarely change
 *
 * If the canonical definitions in Rex change, update these to match.
 * @see packages/rex/src/schema/v1.ts — canonical source of truth
 *
 * @module web/server/rex-domain
 */

// ── Types ──────────────────────────────────────────────────────────

/** @see packages/rex/src/schema/v1.ts — Priority */
export type Priority = "critical" | "high" | "medium" | "low";

/** @see packages/rex/src/schema/v1.ts — ItemLevel */
export type ItemLevel = "epic" | "feature" | "task" | "subtask";

/** @see packages/rex/src/schema/v1.ts — ItemStatus */
export type ItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "deferred"
  | "blocked"
  | "deleted";

// ── Constants ──────────────────────────────────────────────────────

/**
 * Canonical priority ordering — lower number = higher priority.
 * @see packages/rex/src/schema/v1.ts — PRIORITY_ORDER
 */
export const PRIORITY_ORDER: Record<Priority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Valid parent levels for each item level. null = root allowed.
 * @see packages/rex/src/schema/v1.ts — LEVEL_HIERARCHY
 */
export const LEVEL_HIERARCHY: Record<ItemLevel, Array<ItemLevel | null>> = {
  epic: [null],
  feature: ["epic"],
  task: ["feature", "epic"],
  subtask: ["task"],
};

// ── Validation sets ────────────────────────────────────────────────

export const VALID_LEVELS = new Set<ItemLevel>(["epic", "feature", "task", "subtask"]);

/** Excludes "deleted" — deleted items shouldn't be settable via API. */
export const VALID_STATUSES = new Set<string>([
  "pending",
  "in_progress",
  "completed",
  "deferred",
  "blocked",
]);

export const VALID_PRIORITIES = new Set<Priority>(["critical", "high", "medium", "low"]);

// ── Type guards ────────────────────────────────────────────────────

/** Type guard: narrows a string to Priority if it's a valid priority value. */
export function isPriority(value: string | undefined): value is Priority {
  return value !== undefined && VALID_PRIORITIES.has(value as Priority);
}

/** Type guard: narrows a string to ItemLevel if it's a valid level value. */
export function isItemLevel(value: string | undefined): value is ItemLevel {
  return value !== undefined && VALID_LEVELS.has(value as ItemLevel);
}
