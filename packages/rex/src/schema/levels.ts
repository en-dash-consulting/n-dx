/**
 * Level system — semantic helpers and configurable display.
 *
 * This module provides two things:
 *
 * 1. **Semantic helpers** that replace scattered `level === "epic"` /
 *    `level === "task" || "subtask"` checks with meaningful functions
 *    (`isRootLevel`, `isWorkItem`, etc.). These derive their answers
 *    from `LEVEL_HIERARCHY` and `CHILD_LEVEL`, not from string matching.
 *
 * 2. **Display configuration** — labels, plurals, and emoji for each level,
 *    consolidated into a single `LevelConfig`. The default config matches
 *    current behavior (Epic/Feature/Task/Subtask); users can override
 *    via `.n-dx.json` → `rex.levels`.
 *
 * @module rex/schema/levels
 */

import type { ItemLevel } from "./v1.js";
import { LEVEL_HIERARCHY, CHILD_LEVEL } from "./v1.js";

// ── Display configuration ───────────────────────────────────────────

export interface LevelDisplay {
  /** Display label, e.g. "Epic" */
  label: string;
  /** Plural form, e.g. "Epics" */
  labelPlural: string;
  /** CLI/UI emoji */
  emoji: string;
}

/**
 * Default display config — matches current behavior.
 *
 * Users can override via `.n-dx.json` → `rex.levels` to relabel
 * the hierarchy (e.g. "Theme"/"Story"/"Task"/"Step").
 */
const DEFAULT_DISPLAY: Record<ItemLevel, LevelDisplay> = {
  epic:    { label: "Epic",    labelPlural: "Epics",    emoji: "\u{1F4E6}" }, // 📦
  feature: { label: "Feature", labelPlural: "Features", emoji: "\u{2728}" },  // ✨
  task:    { label: "Task",    labelPlural: "Tasks",    emoji: "\u{1F4CB}" }, // 📋
  subtask: { label: "Subtask", labelPlural: "Subtasks", emoji: "\u{1F539}" }, // 🔹
};

/** Active display config. Replaced at startup when user overrides exist. */
let activeDisplay: Record<string, LevelDisplay> = { ...DEFAULT_DISPLAY };

/** Replace the active display config (called on startup with user overrides). */
export function setLevelDisplay(config: Record<string, LevelDisplay>): void {
  activeDisplay = config;
}

/** Reset to defaults (useful for tests). */
export function resetLevelDisplay(): void {
  activeDisplay = { ...DEFAULT_DISPLAY };
}

// ── Semantic helpers ────────────────────────────────────────────────

/**
 * Can this level exist at the tree root (no parent)?
 *
 * Replaces: `level === "epic"`
 */
export function isRootLevel(level: string): boolean {
  const parents = LEVEL_HIERARCHY[level as ItemLevel];
  return parents !== undefined && parents.includes(null);
}

/**
 * Is this a work item (actionable leaf-level item)?
 * Work items are levels that don't have container semantics — they
 * represent actual units of work, not groupings.
 *
 * Replaces: `level === "task" || level === "subtask"`
 */
export function isWorkItem(level: string): boolean {
  return !isContainerLevel(level) && isValidLevel(level);
}

/**
 * Is this a container level (groups other items)?
 *
 * Replaces: `level === "epic" || level === "feature"`
 */
export function isContainerLevel(level: string): boolean {
  if (!isValidLevel(level)) return false;
  const child = CHILD_LEVEL[level as ItemLevel];
  // A container has children, and those children can themselves have children
  // (i.e., the container is at least 2 levels above the deepest leaf).
  // Task is NOT a container even though it can have subtask children —
  // it's a work item that can be subdivided.
  if (child === null) return false;
  const grandchild = CHILD_LEVEL[child];
  return grandchild !== null;
}

/**
 * Is this the deepest possible level (cannot have children)?
 *
 * Replaces: `level === "subtask"` or `CHILD_LEVEL[level] === null`
 */
export function isLeafLevel(level: string): boolean {
  if (!isValidLevel(level)) return false;
  return CHILD_LEVEL[level as ItemLevel] === null;
}

/**
 * Is this a valid level string?
 */
export function isValidLevel(level: string): level is ItemLevel {
  return level in LEVEL_HIERARCHY;
}

// ── Display helpers ─────────────────────────────────────────────────

/** Get the display label for a level. e.g. "epic" → "Epic" */
export function getLevelLabel(level: string): string {
  return activeDisplay[level]?.label ?? level;
}

/** Get the plural display label. e.g. "epic" → "Epics" */
export function getLevelPlural(level: string): string {
  return activeDisplay[level]?.labelPlural ?? `${level}s`;
}

/** Get the emoji for a level. e.g. "epic" → "📦" */
export function getLevelEmoji(level: string): string {
  return activeDisplay[level]?.emoji ?? "\u2022"; // bullet fallback
}

/** Get all level display configs (for iteration). */
export function getLevelDisplayMap(): Readonly<Record<string, LevelDisplay>> {
  return activeDisplay;
}

// ── Hierarchy navigation ────────────────────────────────────────────

/** Get the default child level. e.g. "epic" → "feature" */
export function getChildLevel(level: string): ItemLevel | null {
  if (!isValidLevel(level)) return null;
  return CHILD_LEVEL[level as ItemLevel];
}

/** Get all valid parent levels (excluding null). e.g. "task" → ["feature", "epic"] */
export function getParentLevels(level: string): ItemLevel[] {
  if (!isValidLevel(level)) return [];
  return LEVEL_HIERARCHY[level as ItemLevel].filter(
    (p): p is ItemLevel => p !== null,
  );
}

/** Get all levels in hierarchy order (shallowest first). */
export function getAllLevels(): ItemLevel[] {
  return ["epic", "feature", "task", "subtask"];
}

/** Get all work-item levels. */
export function getWorkItemLevels(): ItemLevel[] {
  return getAllLevels().filter((l) => isWorkItem(l));
}

/** Get all container levels. */
export function getContainerLevels(): ItemLevel[] {
  return getAllLevels().filter((l) => isContainerLevel(l));
}

/**
 * Format a level summary string. e.g. { epic: 2, task: 3 } → "2 epics, 3 tasks"
 */
export function formatLevelSummary(byLevel: Record<string, number>): string {
  const order = getAllLevels();
  const parts: string[] = [];
  for (const level of order) {
    const count = byLevel[level];
    if (count) {
      const label = count === 1 ? getLevelLabel(level).toLowerCase() : getLevelPlural(level).toLowerCase();
      parts.push(`${count} ${label}`);
    }
  }
  return parts.join(", ");
}
