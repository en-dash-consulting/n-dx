/**
 * Level system helpers for the browser-bundled viewer.
 *
 * These mirror the canonical helpers in rex/src/schema/levels.ts but are
 * self-contained for browser bundling. They use the same level strings
 * as the rex types mirror in ./types.ts.
 *
 * @see packages/rex/src/schema/levels.ts — canonical source
 * @see ./types.ts — viewer-side type definitions
 */

import type { ItemLevel } from "./types.js";

// ── Semantic helpers ────────────────────────────────────────────────

/** Can this level exist at the tree root? Replaces: `level === "epic"` */
export function isRootLevel(level: string): boolean {
  return level === "epic";
}

/**
 * Is this a work item (actionable leaf-level)?
 * Replaces: `level === "task" || level === "subtask"`
 */
export function isWorkItem(level: string): boolean {
  return level === "task" || level === "subtask";
}

/**
 * Is this a container level (groups other items)?
 * Replaces: `level === "epic" || level === "feature"`
 */
export function isContainerLevel(level: string): boolean {
  return level === "epic" || level === "feature";
}

// ── Display helpers ─────────────────────────────────────────────────

const LEVEL_LABELS: Record<string, string> = {
  epic: "Epic",
  feature: "Feature",
  task: "Task",
  subtask: "Subtask",
};

const LEVEL_LABELS_PLURAL: Record<string, string> = {
  epic: "Epics",
  feature: "Features",
  task: "Tasks",
  subtask: "Subtasks",
};

const LEVEL_EMOJI: Record<string, string> = {
  epic: "\u{1F4E6}",    // 📦
  feature: "\u{2728}",   // ✨
  task: "\u{1F4CB}",     // 📋
  subtask: "\u{1F539}",  // 🔹
};

/** Get the display label for a level. e.g. "epic" → "Epic" */
export function getLevelLabel(level: string): string {
  return LEVEL_LABELS[level] ?? level;
}

/** Get the plural display label. e.g. "epic" → "Epics" */
export function getLevelPlural(level: string): string {
  return LEVEL_LABELS_PLURAL[level] ?? `${level}s`;
}

/** Get the emoji for a level. e.g. "epic" → "📦" */
export function getLevelEmoji(level: string): string {
  return LEVEL_EMOJI[level] ?? "\u2022";
}

// ── Hierarchy ───────────────────────────────────────────────────────

const CHILD_LEVEL: Record<string, ItemLevel | null> = {
  epic: "feature",
  feature: "task",
  task: "subtask",
  subtask: null,
};

/** Get the default child level. e.g. "epic" → "feature" */
export function getChildLevel(level: string): ItemLevel | null {
  return CHILD_LEVEL[level] ?? null;
}
