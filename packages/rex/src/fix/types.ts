/**
 * Structural item shape used by the auto-fix engine.
 *
 * This intentionally avoids depending on the broader schema/tree modules so
 * the fix pipeline can remain isolated from unrelated rex zones.
 */

export type FixItemStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "deferred"
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
