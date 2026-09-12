/**
 * Automatic parent completion for PRD items.
 *
 * When all children of a parent item are `completed`, the parent can be
 * automatically marked as completed. This walks up the tree from a given
 * item, propagating completion as far as it goes.
 *
 * Rules:
 * - A parent is auto-completable when *every* child is `completed`.
 *   `deferred`, `blocked`, and `failing` are terminal-in-the-sense-of-stopped
 *   but NOT successful — a child in any of those states means the work is
 *   not actually done, so it must block the parent from auto-completing
 *   (GitHub #364: an epic was reported complete with deferred children still
 *   outstanding — half-migrated work read as finished).
 * - Propagation walks up the ancestor chain: if completing a parent makes its
 *   own parent fully done, that grandparent is completed too.
 * - Only `pending` parents are auto-completed. `in_progress` is a deliberate
 *   human/agent claim that the parent has work of its own still running, so a
 *   child transition must not close it (GitHub #368).
 * - Returns the list of item IDs that were auto-completed, bottom-up.
 *
 * ## Two independent predicates — do not merge them
 *
 * This module answers two separate questions and both guards are load-bearing:
 *
 * | Question | Predicate | Issue |
 * |----------|-----------|-------|
 * | Which CHILD statuses count as done? | {@link SUCCESSFUL_CHILD_STATUSES} | #364 |
 * | May the PARENT be touched at all? | {@link AUTO_COMPLETABLE_STATUSES} + scope | #368 |
 *
 * #364 narrowed the child predicate from `{completed, deferred}` to
 * `{completed}`. That does nothing for #368, where the child genuinely *is*
 * completed: an `in_progress` task belonging to another user, with one
 * completed subtask, was swept to `completed` — and its epic with it — by a
 * run that had made zero tool calls and was operating in a different epic
 * entirely. Narrowing the child predicate further would not have stopped it;
 * refusing to touch the parent does. A future change that collapses the two
 * sets into one reintroduces whichever bug it drops.
 *
 * @module core/parent-completion
 */

import type { PRDItem, ItemStatus } from "../schema/index.js";
import { findItem } from "./tree.js";

export interface AutoCompletionResult {
  /** IDs of items that should be auto-completed, ordered bottom-up (child → ancestor). */
  completedIds: string[];
  /** Human-readable descriptions of what was auto-completed. */
  completedItems: Array<{ id: string; title: string; level: string }>;
}

/**
 * The only parent status a child transition may close automatically.
 *
 * `in_progress` used to be here and is deliberately gone (GitHub #368). It is
 * an explicit claim — someone set it, and it means the parent has work of its
 * own beyond its children. Auto-completing over it silently closes another
 * person's open investigation and rewrites its authorship. Already-completed,
 * deferred, blocked, and failing parents were never eligible.
 *
 * **On acceptance criteria.** #368 also asked whether a parent with unmet
 * acceptance criteria of its own needs a *separate* guard. It does not, and a
 * separate guard would do more harm than good: criteria are free prose, only
 * the `automated:` subset is machine-checkable (see
 * `validateAutomatedRequirements`), and nearly every epic in a real PRD
 * carries some. Keying off their mere presence would strand every epic in
 * `pending` forever, and the sole reliable signal that a parent has
 * outstanding work of its own is precisely the `in_progress` marker this set
 * now honours. So: subsumed by the status guard, by decision, not oversight.
 *
 * This is the single source of truth — `remove-task.ts` imports it rather than
 * keeping its own copy. `cli/commands/status-sections.ts` deliberately does
 * NOT use it; see the note there.
 */
export const AUTO_COMPLETABLE_STATUSES: Set<ItemStatus> = new Set(["pending"]);

/** Options for {@link reconcileAutoCompletions}. */
export interface ReconcileOptions {
  /**
   * Contain the sweep to the ancestors of this item.
   *
   * Without it the sweep is whole-tree: it heals every stuck parent in the
   * PRD, including ones in epics the caller has never heard of. That is fine
   * for an explicit `rex`-side reconciliation, and catastrophic for an agent
   * run — GitHub #368, where a failing run completed a task and an epic in an
   * unrelated part of the tree. Any caller acting on behalf of a single item
   * must pass its id here, which bounds the blast radius to that item's
   * ancestor chain no matter what the completion predicate decides.
   *
   * An unknown id contains the sweep to nothing: fail closed, never open.
   */
  ancestorsOf?: string;
}

/**
 * The only child status that counts as successfully done for the purpose of
 * auto-completing a parent. `deferred`, `blocked`, and `failing` are all
 * terminal-ish (they stop a task from progressing further on its own) but
 * they are not *successful* completions, so they must not let a parent be
 * reported as done. This is the single predicate every auto-completion check
 * in the codebase should use — see `remove-task.ts`, `structural.ts`, and
 * `cli/commands/status-sections.ts`.
 */
export const SUCCESSFUL_CHILD_STATUSES: Set<ItemStatus> = new Set(["completed"]);

/**
 * The minimum shape this module needs to judge a parent's children.
 *
 * Deliberately structural rather than `PRDItem`: the auto-fix engine in
 * `src/fix/` carries its own `FixItem` tree shape and must reuse this
 * predicate rather than keeping a private copy of the status set — the two
 * copies drifting apart is exactly how `rex fix` came to repair something
 * different from what `rex validate` warns about. Widening the parameter is
 * what lets `fix/` share the real predicate instead of forking it.
 */
export interface ChildStatusNode {
  id: string;
  status: ItemStatus;
}

/** A node whose children this module may inspect. See {@link ChildStatusNode}. */
export interface ParentStatusNode {
  children?: ChildStatusNode[];
}

/**
 * Check whether all children of an item are successfully done (`completed`),
 * treating any IDs in `virtuallyCompleted` as if they were already completed.
 */
export function allChildrenSuccessful(
  item: ParentStatusNode,
  virtuallyCompleted: Set<string>,
): boolean {
  if (!item.children || item.children.length === 0) return false;
  return item.children.every(
    (c) => SUCCESSFUL_CHILD_STATUSES.has(c.status) || virtuallyCompleted.has(c.id),
  );
}

/**
 * Scan the PRD tree bottom-up and return every `pending` parent whose children
 * are all `completed`. Only `pending` — an `in_progress` parent is an explicit
 * claim and is never swept (#368); `rex status` surfaces those for a human via
 * `findAutoCompletable` instead.
 *
 * Items are returned bottom-up: a feature appears before its epic so that
 * callers can apply updates in order without re-checking the tree.
 *
 * ## Whole-tree sweeps are an operator action, not an agent-run side effect
 *
 * Called without `options.ancestorsOf` this is a whole-tree sweep, which does
 * self-heal parents whose event-driven cascade was previously lost (e.g. an
 * `appendLog` failure after child completion). That healing is real but it is
 * no longer something an agent run performs: since #368 every caller acting on
 * behalf of a single item passes `ancestorsOf`, which is the whole point of
 * that option. The unscoped sweep now belongs to `rex fix` (the `stuck_parent`
 * kind), where an operator asks for it deliberately and can see the diff.
 *
 * Do not reintroduce an unscoped call on a run path to "restore self-healing" —
 * that is precisely the blast radius #368 was filed for.
 *
 * @param items   - The full PRD item tree.
 * @param options - Containment options; whole-tree when omitted.
 * @returns Items to auto-complete, ordered bottom-up. Empty when everything is consistent.
 */
export function reconcileAutoCompletions(
  items: PRDItem[],
  options?: ReconcileOptions,
): AutoCompletionResult {
  const result: AutoCompletionResult = {
    completedIds: [],
    completedItems: [],
  };

  // Ids the sweep is allowed to complete. `null` means unrestricted.
  let scope: Set<string> | null = null;
  if (options?.ancestorsOf !== undefined) {
    const anchor = findItem(items, options.ancestorsOf);
    // A missing anchor scopes to the empty set rather than the whole tree:
    // a caller that asked for containment must never silently get a
    // whole-tree sweep because its id lookup failed.
    scope = new Set(anchor ? anchor.parents.map((p) => p.id) : []);
  }

  // Collect all items in post-order (children before parents)
  const postOrder: PRDItem[] = [];
  function collectPostOrder(nodes: PRDItem[]): void {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        collectPostOrder(node.children);
      }
      postOrder.push(node);
    }
  }
  collectPostOrder(items);

  // Track items that are already terminal or have been decided as auto-completable
  const virtuallyCompleted = new Set<string>();

  for (const item of postOrder) {
    // Already successfully done: treat as virtually completed for ancestor
    // checks. Anything else terminal-but-unsuccessful (deferred/blocked/
    // failing) falls through to the AUTO_COMPLETABLE_STATUSES check below
    // and is skipped without being marked virtually completed — it must
    // keep blocking its parent.
    if (SUCCESSFUL_CHILD_STATUSES.has(item.status)) {
      virtuallyCompleted.add(item.id);
      continue;
    }

    // Containment (#368): outside the requested scope, an item is neither
    // completed nor marked virtually complete, so it also keeps its own
    // ancestors from completing on its behalf.
    if (scope && !scope.has(item.id)) continue;

    // Only auto-complete pending parents — never an explicit in_progress (#368)
    if (!AUTO_COMPLETABLE_STATUSES.has(item.status)) continue;

    // allChildrenSuccessful returns false when there are no children — leaf
    // items in a non-terminal status are never auto-completed.
    if (!allChildrenSuccessful(item, virtuallyCompleted)) continue;

    result.completedIds.push(item.id);
    result.completedItems.push({
      id: item.id,
      title: item.title,
      level: item.level,
    });
    virtuallyCompleted.add(item.id);
  }

  return result;
}

/**
 * Given a recently-completed item, find all ancestors that should be
 * auto-completed because all their children are now successfully done.
 *
 * Walks up the parent chain, simulating each completion so that
 * grandparents can see their child (which we just decided to complete)
 * as successfully done.
 *
 * Contained by construction: it only ever visits `itemId`'s own ancestors, so
 * it cannot reach a sibling subtree. `reconcileAutoCompletions` gets the same
 * guarantee only when given `ancestorsOf` (#368).
 *
 * @param items     - The full PRD item tree.
 * @param itemId    - The ID of the item that just completed.
 * @returns Items to auto-complete, ordered bottom-up. Empty if no propagation needed.
 */
export function findAutoCompletions(
  items: PRDItem[],
  itemId: string,
): AutoCompletionResult {
  const result: AutoCompletionResult = {
    completedIds: [],
    completedItems: [],
  };

  const entry = findItem(items, itemId);
  if (!entry) return result;

  // Callers invoke this after ANY terminal-ish status change (completed OR
  // deferred). If the item itself didn't land on a successful completion,
  // it cannot make its parent auto-completable — seeding it into
  // `virtuallyCompleted` below would silently reintroduce GitHub #364
  // (a deferred child masquerading as done for its parent's check).
  if (!SUCCESSFUL_CHILD_STATUSES.has(entry.item.status)) return result;

  // Track items we've decided to auto-complete so higher ancestors
  // see them as terminal when checking their own children.
  const virtuallyCompleted = new Set<string>([itemId]);

  // Walk up the parent chain from immediate parent to root
  const parents = entry.parents;

  for (let i = parents.length - 1; i >= 0; i--) {
    const parent = parents[i];

    // Only auto-complete pending parents. An in_progress parent stops the
    // cascade dead (#368) — and because the walk breaks rather than skips,
    // nothing above it completes either.
    if (!AUTO_COMPLETABLE_STATUSES.has(parent.status)) break;

    // Check if all children are successfully done (including virtually
    // completed ones). A deferred/blocked/failing child breaks the cascade.
    if (!allChildrenSuccessful(parent, virtuallyCompleted)) break;

    result.completedIds.push(parent.id);
    result.completedItems.push({
      id: parent.id,
      title: parent.title,
      level: parent.level,
    });

    // This parent is now virtually completed for the next ancestor check
    virtuallyCompleted.add(parent.id);
  }

  return result;
}
