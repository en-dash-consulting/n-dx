/**
 * Apply an open v2 change as a steward, or preview the apply: the one entry
 * MCP `apply_change` and the dashboard's Apply share.
 *
 * Both run {@link applyAmendments} on the loaded tree. A preview stops there
 * and writes nothing; an apply runs it inside {@link withPrdModelTransaction}
 * and writes the result. A preview is the same call with the same refusals, so
 * a change that previews clean applies clean unless the tree moves between.
 *
 * Rex's refusal comes back as `{ ok: false }` carrying rex's message, not as a
 * thrown error, so a caller across the package boundary needs no error class.
 * Logging the apply is the caller's: each names its own source.
 *
 * @module rex/core/apply-change
 */

import { applyAmendments, ApplyAmendmentsError, type AppliedAmendment } from "./apply-amendments.js";
import { indexTree, type V2Tree } from "../schema/v2-rules.js";
import { loadPrdModel } from "../store/prd-model-reader.js";
import { PrdLayoutError, withPrdModelTransaction } from "../store/prd-model-transaction.js";

export interface ApplyChangeOptions {
  /** Apply amendments whose `base` no longer matches their target's spec. */
  force?: boolean;
  /** Judge the apply and describe it, writing nothing. */
  preview?: boolean;
  /**
   * Clock for `appliedAt`, History dates and the rules. An apply reads it
   * inside the PRD lock, so a call that waits behind another writer is stamped
   * with the time it got the lock. Default the system clock.
   */
  clock?: () => Date;
}

/** One amendment and the product node it creates, edits or retires. */
export interface AppliedAmendmentEffect extends AppliedAmendment {
  node: { id: string; displayId?: string; title: string; type: string };
  /** Where an added node lands. */
  under?: { id: string; displayId?: string; title: string };
}

export type ApplyChangeOutcome =
  | {
      ok: true;
      /** The change's id; the ref passed may be a display id. */
      change: string;
      appliedAt: string;
      applied: AppliedAmendmentEffect[];
      /** False for a preview. */
      written: boolean;
    }
  | {
      ok: false;
      /** Rex's refusal, naming every problem. */
      message: string;
      problems: readonly string[];
    };

/** Preview or apply the change `ref` (id, display id or alias) on the v2 tree in `rexDir`. */
export async function applyChange(rexDir: string, ref: string, options: ApplyChangeOptions = {}): Promise<ApplyChangeOutcome> {
  const clock = options.clock ?? (() => new Date());
  let now!: Date;
  const run = (tree: V2Tree) => {
    now = clock();
    const appliedAt = now.toISOString();
    const out = applyAmendments(tree, ref, { appliedAt, now, force: options.force });
    return { tree: out.tree, change: indexTree(out.tree).resolve(ref)!.id, appliedAt, applied: describeEffects(out.tree, out.applied) };
  };
  try {
    if (options.preview) {
      const model = await loadPrdModel(rexDir);
      if (model.layout !== "v2") throw new PrdLayoutError(rexDir, model.layout);
      const { change, appliedAt, applied } = run(model.tree);
      return { ok: true, change, appliedAt, applied, written: false };
    }
    const { result } = await withPrdModelTransaction(rexDir, (model) => {
      const { tree, ...result } = run(model.tree);
      return { tree, result };
    }, { now: () => now });
    return { ok: true, ...result, written: true };
  } catch (err) {
    if (err instanceof ApplyAmendmentsError) return { ok: false, message: err.message, problems: err.problems };
    throw err;
  }
}

function describeEffects(tree: V2Tree, applied: readonly AppliedAmendment[]): AppliedAmendmentEffect[] {
  // Tombstones included: a removed amendment's node is retired by the apply.
  const index = indexTree(tree, { includeTombstones: true });
  return applied.map((a) => {
    const entry = index.entries.find((e) => e.node.id === a.nodeId);
    const node = entry?.node;
    const parent = a.delta === "added" ? entry?.parent : undefined;
    return {
      ...a,
      node: { id: a.nodeId, ...(node?.displayId ? { displayId: node.displayId } : {}), title: node?.title ?? a.nodeId, type: node?.type ?? "capability" },
      ...(parent ? { under: { id: parent.id, ...(parent.displayId ? { displayId: parent.displayId } : {}), title: parent.title } } : {}),
    };
  });
}
