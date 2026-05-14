/**
 * Reshape operations for restructuring the PRD tree.
 *
 * Provides typed proposal actions (merge, update, reparent, obsolete, split)
 * and an apply function that executes accepted proposals using existing
 * tree primitives.
 *
 * @module core/reshape
 */

import { randomUUID } from "node:crypto";
import type { PRDItem } from "../schema/index.js";
import { findItem, removeFromTree, updateInTree, insertChild } from "./tree.js";
import { moveItem } from "./move.js";

// ── Proposal types ──

export interface MergeAction {
  action: "merge";
  /** ID of the item that survives the merge. */
  survivorId: string;
  /** IDs of items to merge into the survivor (will be removed). */
  mergedIds: string[];
  /** Optional updated title for the survivor. */
  title?: string;
  /** Optional updated description for the survivor. */
  description?: string;
  reason: string;
  /** Detailed merge reasoning for audit trail: which fields taken from where. */
  mergeReasoning?: string;
}

export interface UpdateAction {
  action: "update";
  itemId: string;
  updates: {
    title?: string;
    description?: string;
    acceptanceCriteria?: string[];
    priority?: string;
  };
  reason: string;
}

export interface ReparentAction {
  action: "reparent";
  itemId: string;
  /** New parent ID, or undefined to move to root. */
  newParentId?: string;
  reason: string;
}

export interface ObsoleteAction {
  action: "obsolete";
  itemId: string;
  reason: string;
}

export interface SplitAction {
  action: "split";
  /** ID of the item to split (will be removed). */
  sourceId: string;
  /** New children to create under the same parent. */
  children: Array<{
    title: string;
    description?: string;
    acceptanceCriteria?: string[];
    priority?: string;
    level: string;
  }>;
  reason: string;
}

export interface GroupAction {
  action: "group";
  /** ID to use for the new container item. */
  containerId: string;
  /** Title of the new container (the stripped/normalized title). */
  containerTitle: string;
  /** Level of the container item (one level above grouped items). */
  containerLevel: string;
  /** IDs of items to move under the container, in order. */
  itemIds: string[];
  /** Optional per-item title overrides (specific scope names). */
  renamedTitles?: Record<string, string>;
  reason: string;
}

export type ReshapeAction =
  | MergeAction
  | UpdateAction
  | ReparentAction
  | ObsoleteAction
  | SplitAction
  | GroupAction;

export interface ReshapeProposal {
  /** Unique ID for this proposal (generated during parsing). */
  id: string;
  action: ReshapeAction;
}

// ── Apply result ──

/**
 * Single merge audit entry recorded during a reshape operation.
 */
export interface MergeAuditRecord {
  survivorId: string;
  mergedFromIds: string[];
  reasoning: string;
}

export interface ReshapeResult {
  applied: ReshapeProposal[];
  /** IDs of items that were removed (for sync deletion tracking). */
  deletedIds: string[];
  /** Items that were archived (for archive persistence). */
  archivedItems: PRDItem[];
  /** Audit trail of merges performed (for archive recording). */
  mergeAuditTrail: MergeAuditRecord[];
  errors: Array<{ proposal: ReshapeProposal; error: string }>;
}

// ── Apply logic ──

function applyMerge(
  items: PRDItem[],
  action: MergeAction,
  result: ReshapeResult,
  proposal: ReshapeProposal,
): void {
  const survivorEntry = findItem(items, action.survivorId);
  if (!survivorEntry) {
    result.errors.push({ proposal, error: `Survivor item "${action.survivorId}" not found.` });
    return;
  }

  // Update survivor with merged info
  const updates: Partial<PRDItem> = {};
  if (action.title) updates.title = action.title;
  if (action.description) updates.description = action.description;
  updateInTree(items, action.survivorId, updates);

  // Remove merged items and collect children to reparent
  for (const mergedId of action.mergedIds) {
    const mergedEntry = findItem(items, mergedId);
    if (!mergedEntry) {
      result.errors.push({ proposal, error: `Merged item "${mergedId}" not found, skipping.` });
      continue;
    }

    // Reparent children of merged item to survivor before removing
    const mergedItem = mergedEntry.item;
    if (mergedItem.children && mergedItem.children.length > 0) {
      for (const child of [...mergedItem.children]) {
        removeFromTree(items, child.id);
        if (!survivorEntry.item.children) survivorEntry.item.children = [];
        survivorEntry.item.children.push(child);
      }
    }

    const removed = removeFromTree(items, mergedId);
    if (removed) {
      // Clear children since they were reparented
      removed.children = [];
      result.archivedItems.push(removed);
      result.deletedIds.push(mergedId);
    }
  }

  // Record merge in audit trail
  result.mergeAuditTrail.push({
    survivorId: action.survivorId,
    mergedFromIds: action.mergedIds,
    reasoning: action.mergeReasoning || action.reason || "merge",
  });

  result.applied.push(proposal);
}

function applyUpdate(
  items: PRDItem[],
  action: UpdateAction,
  result: ReshapeResult,
  proposal: ReshapeProposal,
): void {
  const entry = findItem(items, action.itemId);
  if (!entry) {
    result.errors.push({ proposal, error: `Item "${action.itemId}" not found.` });
    return;
  }

  const updates: Partial<PRDItem> = {};
  if (action.updates.title) updates.title = action.updates.title;
  if (action.updates.description) updates.description = action.updates.description;
  if (action.updates.acceptanceCriteria) updates.acceptanceCriteria = action.updates.acceptanceCriteria;
  if (action.updates.priority) updates.priority = action.updates.priority as PRDItem["priority"];

  updateInTree(items, action.itemId, updates);
  result.applied.push(proposal);
}

function applyReparent(
  items: PRDItem[],
  action: ReparentAction,
  result: ReshapeResult,
  proposal: ReshapeProposal,
): void {
  try {
    moveItem(items, action.itemId, action.newParentId);
    result.applied.push(proposal);
  } catch (err) {
    result.errors.push({ proposal, error: (err as Error).message });
  }
}

function applyObsolete(
  items: PRDItem[],
  action: ObsoleteAction,
  result: ReshapeResult,
  proposal: ReshapeProposal,
): void {
  const entry = findItem(items, action.itemId);
  if (!entry) {
    result.errors.push({ proposal, error: `Item "${action.itemId}" not found.` });
    return;
  }

  updateInTree(items, action.itemId, { status: "deferred" });
  result.applied.push(proposal);
}

function applySplit(
  items: PRDItem[],
  action: SplitAction,
  result: ReshapeResult,
  proposal: ReshapeProposal,
): void {
  const entry = findItem(items, action.sourceId);
  if (!entry) {
    result.errors.push({ proposal, error: `Source item "${action.sourceId}" not found.` });
    return;
  }

  const parentId = entry.parents.length > 0
    ? entry.parents[entry.parents.length - 1].id
    : undefined;

  // Create new children
  for (const child of action.children) {
    const newItem: PRDItem = {
      id: randomUUID(),
      title: child.title,
      level: child.level as PRDItem["level"],
      status: "pending",
      description: child.description,
      acceptanceCriteria: child.acceptanceCriteria,
      priority: child.priority as PRDItem["priority"],
    };

    if (parentId) {
      const inserted = insertChild(items, parentId, newItem);
      if (!inserted) {
        // Fall back to root if hierarchy doesn't allow
        items.push(newItem);
      }
    } else {
      items.push(newItem);
    }
  }

  // Remove the source item
  const removed = removeFromTree(items, action.sourceId);
  if (removed) {
    result.archivedItems.push(removed);
    result.deletedIds.push(action.sourceId);
  }

  result.applied.push(proposal);
}

function applyGroup(
  items: PRDItem[],
  action: GroupAction,
  result: ReshapeResult,
  proposal: ReshapeProposal,
): void {
  // Verify all itemIds exist
  for (const id of action.itemIds) {
    if (!findItem(items, id)) {
      result.errors.push({ proposal, error: `Group item "${id}" not found.` });
      return;
    }
  }

  if (action.itemIds.length === 0) {
    result.errors.push({ proposal, error: "GroupAction has no itemIds." });
    return;
  }

  // Find the parent of the first item (all should be siblings)
  const firstEntry = findItem(items, action.itemIds[0])!;
  const originalParentId = firstEntry.parents.length > 0
    ? firstEntry.parents[firstEntry.parents.length - 1].id
    : undefined;

  // Create a new container PRDItem
  const container: PRDItem = {
    id: action.containerId,
    title: action.containerTitle,
    level: action.containerLevel as PRDItem["level"],
    status: "pending",
  };

  // Insert container under the original parent; fall back to root on mismatch
  if (originalParentId) {
    const inserted = insertChild(items, originalParentId, container);
    if (!inserted) {
      items.push(container);
    }
  } else {
    items.push(container);
  }

  // Apply renamed titles and move each item under the container
  for (const id of action.itemIds) {
    if (action.renamedTitles?.[id]) {
      updateInTree(items, id, { title: action.renamedTitles[id] });
    }
    try {
      moveItem(items, id, action.containerId);
    } catch (err) {
      result.errors.push({ proposal, error: `Failed to move "${id}" under container: ${(err as Error).message}` });
    }
  }

  result.applied.push(proposal);
}

/**
 * Apply a set of accepted reshape proposals to the PRD tree.
 *
 * Proposals are applied in order. Each uses existing tree primitives
 * (updateInTree, removeFromTree, insertChild, moveItem). Failures on
 * individual proposals are collected in `errors` without aborting.
 *
 * @param items - The mutable items array (modified in place)
 * @param proposals - Accepted reshape proposals to apply
 * @returns Result with applied proposals, deleted IDs, archived items, and errors
 */
export function applyReshape(
  items: PRDItem[],
  proposals: ReshapeProposal[],
): ReshapeResult {
  const result: ReshapeResult = {
    applied: [],
    deletedIds: [],
    archivedItems: [],
    mergeAuditTrail: [],
    errors: [],
  };

  for (const proposal of proposals) {
    switch (proposal.action.action) {
      case "merge":
        applyMerge(items, proposal.action, result, proposal);
        break;
      case "update":
        applyUpdate(items, proposal.action, result, proposal);
        break;
      case "reparent":
        applyReparent(items, proposal.action, result, proposal);
        break;
      case "obsolete":
        applyObsolete(items, proposal.action, result, proposal);
        break;
      case "split":
        applySplit(items, proposal.action, result, proposal);
        break;
      case "group":
        applyGroup(items, proposal.action, result, proposal);
        break;
    }
  }

  return result;
}
