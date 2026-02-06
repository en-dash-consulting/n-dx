/**
 * Types for PRD hierarchy visualization.
 * Mirrors the Rex PRDItem/PRDDocument types needed for the viewer,
 * without depending on the Rex package directly.
 */

export type ItemLevel = "epic" | "feature" | "task" | "subtask";

export type ItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "deferred"
  | "blocked";

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
}
