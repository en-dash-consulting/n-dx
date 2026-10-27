import type { PRDStore } from "../prd/rex-gateway.js";
import { allChildrenSuccessful, findItem, isChangeLayerStore } from "../prd/rex-gateway.js";

/** No item is treated as completed in advance: only the tree's own statuses count. */
const NO_VIRTUAL_COMPLETIONS: Set<string> = new Set();

/**
 * True when `taskId` is a parent whose children are all completed.
 *
 * rex's `collectActionable` offers exactly such a parent as actionable work —
 * the step that closes it — and judges it by the same `allChildrenSuccessful`
 * predicate. Its work landed in its children's commits, so a run on it
 * rightly changes no code. Without this the completion gate's "no changes"
 * rule refused every such run, reset the parent to pending, and the next
 * selection picked it again: an endless queue of runs that each left the
 * status writes uncommitted. Callers pass the answer to `validateCompletion`
 * as `finalizeReadyParent`, so an empty diff completes it and the completion
 * commit records the status.
 *
 * v1 trees only. A v2 tree completes through `completeV2Work`, whose own rule
 * decides when a change closes. Any failure to read the tree answers false,
 * which leaves the ordinary gate in force.
 */
export async function isFinalizeReadyParent(store: PRDStore, taskId: string): Promise<boolean> {
  if (isChangeLayerStore(store)) return false;
  try {
    const doc = await store.loadDocument();
    const entry = findItem(doc.items, taskId);
    return entry !== null && allChildrenSuccessful(entry.item, NO_VIRTUAL_COMPLETIONS);
  } catch {
    return false;
  }
}
