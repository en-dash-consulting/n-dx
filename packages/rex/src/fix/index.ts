/**
 * Auto-fix common PRD validation issues.
 *
 * Detects and repairs:
 * 1. Missing timestamps.
 * 2. Orphan blockedBy references.
 * 3. Parent-child status misalignment (a completed parent that isn't).
 * 4. Stuck parents (a pending parent that is finished but never closed).
 *
 * ## Zone coupling: `src/fix/` → `src/core/parent-completion.ts`
 *
 * This module keeps its own structural `FixItem` tree shape, but it must NOT
 * keep its own copy of the *status predicates*. It used to: a private
 * `terminalStatuses` set of `{completed, deferred, cancelled, deleted}` that
 * drifted away from `SUCCESSFUL_CHILD_STATUSES` when #364 narrowed the real
 * predicate to `{completed}`. The visible symptom was that `rex validate`
 * warned about a completed parent with a deferred child while `rex fix`
 * proposed nothing for it — the repair tool and the checker disagreed about
 * what "broken" meant.
 *
 * So `fix/` imports the predicates from `core/parent-completion.ts` and shares
 * them verbatim. That is a deliberate upward-facing dependency from the
 * `rex-fix` satellite zone into `rex-core`; it is recorded in
 * `packages/rex/CLAUDE.md`.
 *
 * **Decision — cancelled and deleted children keep blocking a parent.** They
 * are not in `SUCCESSFUL_CHILD_STATUSES`, so a completed parent holding one is
 * reopened here exactly as `rex validate` warns. Cancelled work is not done
 * work; a `deleted` tombstone under a parent claimed complete is itself worth a
 * human look (`removeTask` splices items out of the tree rather than leaving
 * tombstones, so this is rare and usually means an import went wrong). If that
 * judgement is ever reversed, the exception belongs in
 * `SUCCESSFUL_CHILD_STATUSES` so validate, fix and auto-completion change
 * together — never in a private set here.
 */

import {
  AUTO_COMPLETABLE_STATUSES,
  SUCCESSFUL_CHILD_STATUSES,
  allChildrenSuccessful,
} from "../core/parent-completion.js";
import { collectFixItemIds, collectFixTreePostOrder, walkFixTree } from "./tree.js";
import type { FixAction, FixItem, FixItemStatus, FixKind, FixResult } from "./types.js";

export type { FixAction, FixItem, FixItemStatus, FixKind, FixResult };

export function detectTimestampIssues(items: FixItem[]): FixAction[] {
  const actions: FixAction[] = [];

  for (const { item } of walkFixTree(items)) {
    if (item.status === "completed" && !item.completedAt) {
      actions.push({
        kind: "missing_timestamp",
        itemId: item.id,
        description: `Add completedAt to completed item "${item.title}"`,
      });
    }

    if (
      (item.status === "in_progress" || item.status === "completed") &&
      !item.startedAt
    ) {
      actions.push({
        kind: "missing_timestamp",
        itemId: item.id,
        description: `Add startedAt to ${item.status} item "${item.title}"`,
      });
    }

    if (item.status !== "completed" && item.completedAt) {
      actions.push({
        kind: "missing_timestamp",
        itemId: item.id,
        description: `Clear stale completedAt from ${item.status} item "${item.title}"`,
      });
    }
  }

  return actions;
}

export function detectOrphanBlockedBy(items: FixItem[]): FixAction[] {
  const allIds = collectFixItemIds(items);
  const actions: FixAction[] = [];

  for (const { item } of walkFixTree(items)) {
    if (!item.blockedBy || item.blockedBy.length === 0) continue;

    const orphans = item.blockedBy.filter((ref) => !allIds.has(ref));
    if (orphans.length > 0) {
      actions.push({
        kind: "orphan_blocked_by",
        itemId: item.id,
        description: `Remove ${orphans.length} orphan blockedBy ref${orphans.length > 1 ? "s" : ""} from "${item.title}": ${orphans.map((id) => id.slice(0, 8)).join(", ")}`,
      });
    }
  }

  return actions;
}

/**
 * Completed parents that still hold at least one unfinished child, paired with
 * the children responsible. Single source for both the detector and the fixer
 * so the two can never describe different repairs.
 */
function findMisalignedParents(
  items: FixItem[],
): Array<{ item: FixItem; unfinished: FixItem[] }> {
  const found: Array<{ item: FixItem; unfinished: FixItem[] }> = [];

  for (const { item } of walkFixTree(items)) {
    if (item.status !== "completed") continue;
    if (!item.children || item.children.length === 0) continue;

    const unfinished = item.children.filter(
      (child) => !SUCCESSFUL_CHILD_STATUSES.has(child.status),
    );
    if (unfinished.length > 0) found.push({ item, unfinished });
  }

  return found;
}

export function detectParentChildMisalignment(items: FixItem[]): FixAction[] {
  return findMisalignedParents(items).map(({ item, unfinished }) => ({
    kind: "parent_child_alignment" as const,
    itemId: item.id,
    description: `Reset completed parent "${item.title}" to pending (${unfinished.length} unfinished child${unfinished.length > 1 ? "ren" : ""})`,
  }));
}

/**
 * Pending parents whose children are all `completed` — the whole-tree
 * reconciliation, over this module's structural tree shape.
 *
 * Mirrors `reconcileAutoCompletions` with no `ancestorsOf` scope, which is the
 * sweep no agent run performs any more (#368). Post-order plus the
 * `virtuallyCompleted` set is what lets a feature close and then let its epic
 * close in the same pass.
 */
function findStuckParents(items: FixItem[]): FixItem[] {
  const stuck: FixItem[] = [];
  const virtuallyCompleted = new Set<string>();

  for (const item of collectFixTreePostOrder(items)) {
    if (SUCCESSFUL_CHILD_STATUSES.has(item.status)) {
      virtuallyCompleted.add(item.id);
      continue;
    }

    // Never close an explicit in_progress claim, and never a deferred,
    // blocked or failing parent (#368).
    if (!AUTO_COMPLETABLE_STATUSES.has(item.status)) continue;

    // Returns false for a childless item, so leaves are never completed here.
    if (!allChildrenSuccessful(item, virtuallyCompleted)) continue;

    stuck.push(item);
    virtuallyCompleted.add(item.id);
  }

  return stuck;
}

export function detectStuckParents(items: FixItem[]): FixAction[] {
  return findStuckParents(items).map((item) => ({
    kind: "stuck_parent" as const,
    itemId: item.id,
    description: `Complete stuck parent "${item.title}" (all ${item.children?.length ?? 0} children completed)`,
  }));
}

function applyTimestampFixes(items: FixItem[], now: string): number {
  let count = 0;

  for (const { item } of walkFixTree(items)) {
    if (item.status === "completed" && !item.completedAt) {
      item.completedAt = now;
      count++;
    }

    if (
      (item.status === "in_progress" || item.status === "completed") &&
      !item.startedAt
    ) {
      item.startedAt = now;
      count++;
    }

    if (item.status !== "completed" && item.completedAt) {
      delete item.completedAt;
      count++;
    }
  }

  return count;
}

function applyOrphanBlockedByFixes(items: FixItem[]): number {
  const allIds = collectFixItemIds(items);
  let count = 0;

  for (const { item } of walkFixTree(items)) {
    if (!item.blockedBy || item.blockedBy.length === 0) continue;

    const before = item.blockedBy.length;
    item.blockedBy = item.blockedBy.filter((ref) => allIds.has(ref));

    if (item.blockedBy.length < before) {
      count++;
    }

    if (item.blockedBy.length === 0) {
      delete item.blockedBy;
    }
  }

  return count;
}

/**
 * Reopen falsely-completed parents to `pending`.
 *
 * `pending`, not `in_progress`: that is the codebase's reopen convention
 * (`cascadeParentReset` in `core/parent-reset.ts` does the same), and since
 * #368 `AUTO_COMPLETABLE_STATUSES` is `{pending}` — an `in_progress` parent is
 * an explicit human claim that auto-completion refuses to touch. Reopening to
 * `in_progress` therefore produced a parent that could never close again when
 * its last child finished, with nothing but a printed `rex status` hint to say
 * so. `startedAt` is left alone for the same reason it is in
 * `cascadeParentReset`: it records when the work began, which reopening does
 * not undo.
 */
function applyParentChildFixes(items: FixItem[]): number {
  let count = 0;

  for (const { item } of findMisalignedParents(items)) {
    item.status = "pending";
    delete item.completedAt;
    count++;
  }

  return count;
}

/**
 * Close parents that are finished but were never marked so.
 *
 * Applied in post-order, so a feature is `completed` in the tree before the
 * epic above it is written — the bottom-up order callers of
 * `reconcileAutoCompletions` rely on.
 */
function applyStuckParentFixes(items: FixItem[], now: string): number {
  let count = 0;

  for (const item of findStuckParents(items)) {
    item.status = "completed";
    // The timestamp pass has already run by now and saw this item as pending,
    // so it will not backfill these — set them here or leave the tree in a
    // state the next `rex fix` immediately flags.
    item.completedAt = now;
    if (!item.startedAt) item.startedAt = now;
    count++;
  }

  return count;
}

export function detectIssues(items: FixItem[]): FixAction[] {
  return [
    ...detectTimestampIssues(items),
    ...detectOrphanBlockedBy(items),
    ...detectParentChildMisalignment(items),
    ...detectStuckParents(items),
  ];
}

export function applyFixes(
  items: FixItem[],
  now?: string,
): FixResult {
  const actions = detectIssues(items);

  if (actions.length === 0) {
    return { actions, mutatedCount: 0 };
  }

  const timestamp = now ?? new Date().toISOString();

  const tsCount = applyTimestampFixes(items, timestamp);
  const orphanCount = applyOrphanBlockedByFixes(items);
  // Reopen before sweeping: a parent this pass moves to `pending` still holds
  // an unfinished child, so the sweep below cannot then close it again.
  const parentCount = applyParentChildFixes(items);
  const stuckCount = applyStuckParentFixes(items, timestamp);

  return {
    actions,
    mutatedCount: tsCount + orphanCount + parentCount + stuckCount,
  };
}
