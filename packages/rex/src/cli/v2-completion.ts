/**
 * A status update to `completed` on a v2 tree, shared by `update_task_status`
 * and `rex update --status` so the two behave the same.
 *
 * The node completes through `completeWork` (core/change-completion.ts)
 * inside one {@link withPrdModelTransaction}: completing the last live task
 * of a `pending` change completes the change (and each `pending` enclosing
 * change whose work is then all done), and under `rex.applyOn: complete`
 * (read with {@link loadApplyOn}) their amendments apply, innermost first, in
 * the same write. A v1 tree never comes here; it keeps the cascade in
 * `core/parent-completion.ts`.
 *
 * @module rex/cli/v2-completion
 */

import { loadApplyOn } from "../core/apply-policy.js";
import { completeWork, type CompleteWorkResult } from "../core/change-completion.js";
import { findItem } from "../core/tree.js";
import type { PRDItem, ResolutionType } from "../schema/index.js";
import type { ChangeLayerStore } from "../store/change-layer-store.js";
import { withPrdModelTransaction } from "../store/prd-model-transaction.js";

export interface V2CompletionOptions {
  resolutionType?: ResolutionType;
  resolutionDetail?: string;
  clock?: () => Date;
}

/** What completed beyond the node itself, in the v1 answer's terms plus the optional v2 fields. */
export interface V2Completion {
  /** Nodes completed with the node (its task, its change), as v1's `autoCompleted`. */
  autoCompleted: Array<{ id: string; title: string; level: string }>;
  /** The change the node belongs to (itself when it is a change). */
  changeId?: string;
  /** Whether that change is now completed. */
  changeCompleted: boolean;
  /** Whether the change's amendments were applied in this write. */
  applied: boolean;
  /** Why the change was held open or left unapplied, when it was. */
  reason?: string;
  /** `rex.applyOn` config warnings. */
  warnings: string[];
}

/** Complete `id` on the store's v2 tree and log what completed and applied. */
export async function completeV2Work(store: ChangeLayerStore, id: string, options: V2CompletionOptions = {}): Promise<V2Completion> {
  const { rexDir } = store;
  const { applyOn, warnings } = await loadApplyOn(rexDir);
  const clock = options.clock ?? (() => new Date());
  // Read inside the lock: a call that waited behind another writer is stamped when it wrote.
  let now!: Date;
  const { result: out } = await withPrdModelTransaction<CompleteWorkResult>(
    rexDir,
    (model) => {
      now = clock();
      const result = completeWork(model.tree, id, {
        applyOn,
        now,
        appliedAt: now.toISOString(),
        resolutionType: options.resolutionType,
        resolutionDetail: options.resolutionDetail,
      });
      return { tree: result.tree, result };
    },
    { now: () => now },
  );

  const items = (await store.loadDocument()).items;
  const timestamp = now.toISOString();
  const autoCompleted: V2Completion["autoCompleted"] = [];
  for (const doneId of out.completed) {
    const item: PRDItem | undefined = findItem(items, doneId)?.item;
    if (doneId === id || !item) continue;
    autoCompleted.push({ id: item.id, title: item.title, level: item.level });
    await store.appendLog({
      timestamp,
      event: "auto_completed",
      itemId: item.id,
      detail: `Auto-completed ${item.level}: ${item.title} (all children done)`,
    });
  }

  // `apply` and `reason` describe the node's own change; an enclosing change completed with it is logged only.
  const applied = out.apply?.applied === true;
  for (const { changeId, apply } of out.applies) {
    if (!apply.applied) continue;
    const amendments = apply.result.applied;
    await store.appendLog({
      timestamp,
      event: "change_applied",
      itemId: changeId,
      detail: amendments.length ? amendments.map((a) => `${a.delta} ${a.nodeId}`).join(", ") : "no amendments",
    });
  }
  const held = out.held?.changeId === out.changeId ? out.held : null;
  const reason = held?.reason ?? (out.apply && !out.apply.applied ? out.apply.reason : undefined);
  return {
    autoCompleted,
    ...(out.changeId ? { changeId: out.changeId } : {}),
    changeCompleted: out.changeId !== undefined && findItem(items, out.changeId)?.item.status === "completed",
    applied,
    ...(reason ? { reason } : {}),
    warnings,
  };
}
