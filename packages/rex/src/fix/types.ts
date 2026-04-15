/**
 * Structural item shape used by the auto-fix engine.
 *
 * This uses the canonical status union from schema so auto-fix stays aligned
 * with the stored document shape as statuses evolve.
 */

import type { ItemStatus } from "../schema/index.js";

export type FixItemStatus = ItemStatus;

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
