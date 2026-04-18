/**
 * Structural item shape used by the auto-fix engine.
 *
 * FixItemStatus mirrors ItemStatus from the schema. Keep in sync if new
 * statuses are added to packages/rex/src/schema/v1.ts.
 */

export type FixItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failing"
  | "deferred"
  | "blocked"
  | "deleted";

export interface FixItem {
  id: string;
  title: string;
  status: FixItemStatus;
  level?: string;
  startedAt?: string;
  completedAt?: string;
  blockedBy?: string[];
  children?: FixItem[];
}

export type FixKind =
  | "missing_timestamp"
  | "orphan_blocked_by"
  | "parent_child_alignment";

export interface FixAction {
  kind: FixKind;
  itemId: string;
  description: string;
}

export interface FixResult {
  actions: FixAction[];
  mutatedCount: number;
}
