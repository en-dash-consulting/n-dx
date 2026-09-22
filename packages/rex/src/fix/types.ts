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
  | "cancelled"
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
  /**
   * A completed item whose startedAt is after its completedAt. Before #375,
   * `rex fix` manufactured these itself by backfilling a missing startedAt
   * with the current clock — and then could not see the result. The repair
   * clamps startedAt back to completedAt, the only bound the item's own data
   * supports; the true start is unrecoverable.
   */
  | "inverted_timestamps"
  | "orphan_blocked_by"
  | "parent_child_alignment"
  /**
   * A `pending` parent whose children are all `completed` — a completion
   * cascade that was lost, so the parent never closed. Repairing it is the
   * operator's path to the whole-tree reconciliation that agent runs stopped
   * performing in #368. See `detectStuckParents`.
   */
  | "stuck_parent";

export interface FixAction {
  kind: FixKind;
  itemId: string;
  description: string;
}

export interface FixResult {
  actions: FixAction[];
  mutatedCount: number;
}
