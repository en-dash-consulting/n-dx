/**
 * Reorganization executor: applies reorganization proposals to the PRD tree.
 *
 * Each proposal type maps to existing tree primitives:
 * - merge  → mergeItems()
 * - move   → moveItem()
 * - delete → removeFromTree()
 * - prune  → pruneItems()
 * - collapse → moveItem() + removeFromTree()
 * - split  → (deferred: requires LLM or user input for grouping)
 *
 * Proposals are applied atomically — the caller saves the document once
 * after all proposals are applied.
 *
 * @module core/reorganize-executor
 */

import type { PRDItem } from "../schema/index.js";
import type {
  ReorganizationProposal,
  MergeDetail,
  MoveDetail,
  DeleteDetail,
  PruneDetail,
  CollapseDetail,
  SplitDetail,
} from "./reorganize.js";
import { removeFromTree, findItem } from "./tree.js";
import { mergeItems } from "./merge.js";
import { moveItem } from "./move.js";
import { pruneItems } from "./prune.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  /** Number of proposals successfully applied. */
  applied: number;
  /** Number of proposals that could not be applied. */
  failed: number;
  /** Detail per proposal. */
  results: ProposalResult[];
}

export interface ProposalResult {
  proposalId: number;
  success: boolean;
  error?: string;
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Apply a set of reorganization proposals to the PRD tree.
 * Mutates `items` in place. Returns a summary of applied/failed proposals.
 *
 * Proposals are applied in order. Later proposals may fail if earlier ones
 * changed the tree in unexpected ways.
 */
export function applyProposals(
  items: PRDItem[],
  proposals: ReorganizationProposal[],
): ApplyResult {
  const results: ProposalResult[] = [];
  let applied = 0;
  let failed = 0;

  for (const proposal of proposals) {
    try {
      applyOne(items, proposal);
      results.push({ proposalId: proposal.id, success: true });
      applied++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ proposalId: proposal.id, success: false, error: message });
      failed++;
    }
  }

  return { applied, failed, results };
}

/**
 * Apply a single proposal to the tree. Throws on failure.
 */
function applyOne(items: PRDItem[], proposal: ReorganizationProposal): void {
  switch (proposal.detail.kind) {
    case "merge":
      applyMerge(items, proposal.detail);
      break;
    case "move":
      applyMove(items, proposal.detail);
      break;
    case "delete":
      applyDelete(items, proposal.detail);
      break;
    case "prune":
      applyPrune(items);
      break;
    case "collapse":
      applyCollapse(items, proposal.detail);
      break;
    case "split":
      applySplit(items, proposal.detail);
      break;
  }
}

// ── Executors ────────────────────────────────────────────────────────────────

function applyMerge(items: PRDItem[], detail: MergeDetail): void {
  const result = mergeItems(items, detail.sourceIds, detail.targetId);
  // mergeItems mutates in place; throws internally on validation failure
  if (!result) {
    throw new Error(`Merge failed for target=${detail.targetId}`);
  }
}

function applyMove(items: PRDItem[], detail: MoveDetail): void {
  if (detail.toParentId === null && detail.fromParentId === null) {
    throw new Error(`Item "${detail.itemId}" is already at root`);
  }

  // Verify item still exists
  const entry = findItem(items, detail.itemId);
  if (!entry) {
    throw new Error(`Item "${detail.itemId}" not found in tree`);
  }

  moveItem(items, detail.itemId, detail.toParentId ?? undefined);
}

function applyDelete(items: PRDItem[], detail: DeleteDetail): void {
  const removed = removeFromTree(items, detail.itemId);
  if (!removed) {
    throw new Error(`Item "${detail.itemId}" not found for deletion`);
  }
}

function applyPrune(items: PRDItem[]): void {
  const result = pruneItems(items);
  if (result.prunedCount === 0) {
    throw new Error("No prunable items found");
  }
}

function applyCollapse(items: PRDItem[], detail: CollapseDetail): void {
  // Collapse = move all grandchildren up to parent level, then remove the child
  const parentEntry = findItem(items, detail.parentId);
  if (!parentEntry) {
    throw new Error(`Parent "${detail.parentId}" not found`);
  }

  const childEntry = findItem(items, detail.childId);
  if (!childEntry) {
    throw new Error(`Child "${detail.childId}" not found`);
  }

  // Move grandchildren (child's children) up to the parent
  const grandchildren = [...(childEntry.item.children ?? [])];
  const parentItem = parentEntry.item;

  // Replace the child with its children in the parent's children array
  const parentChildren = parentItem.children ?? [];
  const childIndex = parentChildren.findIndex((c) => c.id === detail.childId);
  if (childIndex === -1) {
    throw new Error(`Child "${detail.childId}" not found under parent "${detail.parentId}"`);
  }

  // Splice out the child and insert its children in its place
  parentChildren.splice(childIndex, 1, ...grandchildren);
}

function applySplit(_items: PRDItem[], _detail: SplitDetail): void {
  // Split requires user/LLM input to decide groupings.
  // For now, throw an informative error.
  throw new Error(
    "Split proposals require manual grouping. Use 'rex reorganize --accept' " +
    "to apply other proposals, then manually reorganize the oversized container.",
  );
}

// ── Formatting ───────────────────────────────────────────────────────────────

/**
 * Format an apply result for human-readable display.
 */
export function formatApplyResult(result: ApplyResult): string {
  const lines: string[] = [];

  if (result.applied > 0) {
    lines.push(`Applied ${result.applied} proposal${result.applied === 1 ? "" : "s"} successfully.`);
  }

  if (result.failed > 0) {
    lines.push(`${result.failed} proposal${result.failed === 1 ? "" : "s"} failed:`);
    for (const r of result.results) {
      if (!r.success) {
        lines.push(`  #${r.proposalId}: ${r.error}`);
      }
    }
  }

  if (result.applied === 0 && result.failed === 0) {
    lines.push("No proposals to apply.");
  }

  return lines.join("\n");
}
