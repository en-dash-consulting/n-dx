/**
 * The v2 store transaction: the write path for the product and change layers.
 *
 * The v2 counterpart of `store.withTransaction`, which is v1-only. Takes the
 * PRD lock for `rexDir`, loads the tree with {@link loadPrdModel}, hands it to
 * the caller's mutation and writes the tree that comes back with
 * {@link writePrdModel}, all under one hold of the lock. A concurrent writer
 * therefore waits for the lock and loads this write, rather than overwriting
 * it from a stale read.
 *
 * The mutation returns a new tree, which fits the pure v2 logic
 * (`core/change-completion.ts`, `core/change-selection.ts`): it returns a tree
 * and writes nothing. A tree returned unchanged writes nothing. A mutation
 * that throws writes nothing.
 *
 * A v1 tree is refused before the mutation runs: it is written by
 * `store.withTransaction`. A tree past a schema refusal is never read for a
 * write: the skew override is ignored here, so loading it throws. Parse
 * warnings are on the model's `warnings`, for the mutation to report.
 *
 * @module rex/store/prd-model-transaction
 */

import { withLock, type LockOptions } from "./file-lock.js";
import { PRD_TREE_DIRNAME, prdLockPath } from "./paths.js";
import { CHANGES_DIRNAME, PRODUCT_DIRNAME, loadPrdModel, type PrdModel } from "./prd-model-reader.js";
import { writePrdModel, type WritePrdModelResult } from "./prd-model-writer.js";
import type { V2Tree } from "../schema/v2-rules.js";

/** What a mutation returns: the tree to write and the caller's result. */
export interface PrdModelEdit<T> {
  tree: V2Tree;
  result: T;
  /** Ids of nodes the mutation deliberately removed; see `WritePrdModelOptions.removed`. */
  removed?: ReadonlySet<string>;
}

export interface PrdModelTransactionOptions {
  /** Clock for `revisedAt` stamps. */
  now?: () => Date;
  /** Lock acquisition timeout and retry delay. */
  lock?: LockOptions;
}

export interface PrdModelTransactionResult<T> {
  result: T;
  written: WritePrdModelResult;
}

/** Thrown when the tree under `rexDir` is not a v2 tree. */
export class PrdLayoutError extends Error {
  constructor(rexDir: string, layout: PrdModel["layout"]) {
    super(
      `The PRD under ${rexDir} uses the ${layout} layout (${PRD_TREE_DIRNAME}/), not v2 (${PRODUCT_DIRNAME}/ and ${CHANGES_DIRNAME}/): ` +
        `a v2 transaction cannot write it. Write it through store.withTransaction.`,
    );
    this.name = "PrdLayoutError";
  }
}

/** Load, mutate and write the v2 tree under `rexDir`, holding the PRD lock throughout. */
export async function withPrdModelTransaction<T>(
  rexDir: string,
  mutate: (model: PrdModel) => PrdModelEdit<T> | Promise<PrdModelEdit<T>>,
  options: PrdModelTransactionOptions = {},
): Promise<PrdModelTransactionResult<T>> {
  return withLock(
    prdLockPath(rexDir),
    async () => {
      const model = await loadPrdModel(rexDir, { ignoreSchemaSkew: false });
      if (model.layout !== "v2") throw new PrdLayoutError(rexDir, model.layout);
      const edit = await mutate(model);
      const written = await writePrdModel(rexDir, { ...model, tree: edit.tree }, { removed: edit.removed, now: options.now });
      return { result: edit.result, written };
    },
    options.lock,
  );
}
