/**
 * Types for PRD hierarchy visualization.
 *
 * These mirror the canonical types in packages/rex/src/schema/v1.ts.
 * Duplication is intentional: the viewer is bundled as standalone browser
 * code via esbuild and cannot import from the Rex Node.js package at
 * runtime. If the canonical Rex types change, update these to match.
 *
 * Drift between these types and the canonical source is caught by
 * compile-time consistency tests in tests/unit/server/type-consistency.test.ts.
 *
 * @see packages/rex/src/schema/v1.ts — canonical source: ItemLevel, ItemStatus, Priority, PRDItem, PRDDocument
 */

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "deferred"
  | "blocked"
  | "deleted";

export type Priority = "critical" | "high" | "medium" | "low";

export interface PRDItemData {
  id: string;
  title: string;
  status: ItemStatus;
  level: ItemLevel;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: Priority;
  tags?: string[];
  blockedBy?: string[];
  startedAt?: string;
  completedAt?: string;
  children?: PRDItemData[];
}

export interface PRDDocumentData {
  schema: string;
  title: string;
  items: PRDItemData[];
}

/** Computed stats for a branch of the tree. */
export interface BranchStats {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  deferred: number;
  blocked: number;
  deleted: number;
}
