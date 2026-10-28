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
 * that throws writes nothing. Every node the mutation changed, created or
 * moved is stamped with `lastModified` / `lastModifiedBy`, as v1's store
 * stamps its items; an unchanged node keeps its stamp.
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
import { canonicalJson } from "./state-writer.js";
import { resolveActor } from "../core/identity.js";
import { ITEM_BOOKKEEPING_FIELDS } from "../core/sync.js";
import type { RuleNode, V2Tree } from "../schema/v2-rules.js";

/** What a mutation returns: the tree to write and the caller's result. */
export interface PrdModelEdit<T> {
  tree: V2Tree;
  result: T;
  /** Ids of nodes the mutation deliberately removed; see `WritePrdModelOptions.removed`. */
  removed?: ReadonlySet<string>;
  /**
   * Ids of nodes whose existing `lastModifiedBy` survives the stamp: a node
   * the write changed only as a cascade (a change auto-completed with its
   * last task) keeps its author, as v1's `WriteOptions.preserveModifiedBy`
   * (GitHub #368). Its `lastModified` still moves; a node with no author yet
   * gets the actor.
   */
  preserveAuthorFor?: ReadonlySet<string>;
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
  // Resolved before the lock: the first call in a process shells out to git.
  const actor = await resolveActor();
  return withLock(
    prdLockPath(rexDir),
    async () => {
      const model = await loadPrdModel(rexDir, { ignoreSchemaSkew: false });
      if (model.layout !== "v2") throw new PrdLayoutError(rexDir, model.layout);
      // Signatured before `mutate` runs: a mutation may edit the loaded tree in place.
      const before = signTree(model.tree);
      const edit = await mutate(model);
      stampChangedNodes(
        edit.tree,
        before,
        { lastModified: (options.now?.() ?? new Date()).toISOString(), lastModifiedBy: actor },
        edit.preserveAuthorFor,
      );
      const written = await writePrdModel(rexDir, { ...model, tree: edit.tree }, { removed: edit.removed, now: options.now });
      return { result: edit.result, written };
    },
    options.lock,
  );
}

// ── Modification stamps ──────────────────────────────────────────

/**
 * A node's content signature: every field but sync bookkeeping, its parent's
 * id (so a move reads as a change to the node moved) and its children's ids
 * (so a parent gaining or losing a child reads as changed, as on v1).
 */
function nodeSignature(node: RuleNode, parentId: string | undefined): string {
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key !== "children" && !ITEM_BOOKKEEPING_FIELDS.has(key)) own[key] = value;
  }
  return canonicalJson({ own, parentId, children: (node.children ?? []).map((c) => c.id) });
}

function* walkNodes(tree: V2Tree): Generator<{ node: RuleNode; parentId: string | undefined }> {
  function* walk(nodes: readonly RuleNode[], parentId: string | undefined): Generator<{ node: RuleNode; parentId: string | undefined }> {
    for (const node of nodes) {
      yield { node, parentId };
      yield* walk(node.children ?? [], node.id);
    }
  }
  yield* walk(tree.product, undefined);
  yield* walk(tree.changes, undefined);
}

/** Every node's {@link nodeSignature}, by id; computed eagerly, since the tree may then be mutated in place. */
function signTree(tree: V2Tree): Map<string, string> {
  const signatures = new Map<string, string>();
  for (const { node, parentId } of walkNodes(tree)) signatures.set(node.id, nodeSignature(node, parentId));
  return signatures;
}

/**
 * Stamp `lastModified` / `lastModifiedBy` on every node of `tree` whose
 * content differs from `before`, in place: the v2 counterpart of v1's
 * `stampChangedItems`, with the same rules. A node unchanged is left alone, so
 * a write that changes nothing stamps nothing. A new node gets the timestamp
 * when it has none, and the author only when it brought none: an import or a
 * caller that set them keeps its provenance. A changed node named in
 * `preserveAuthorFor` takes the timestamp but keeps the author it has.
 */
function stampChangedNodes(
  tree: V2Tree,
  before: ReadonlyMap<string, string>,
  stamp: { lastModified: string; lastModifiedBy: string },
  preserveAuthorFor?: ReadonlySet<string>,
): void {
  for (const { node, parentId } of walkNodes(tree)) {
    const previous = before.get(node.id);
    if (previous !== undefined) {
      if (previous === nodeSignature(node, parentId)) continue;
      node.lastModified = stamp.lastModified;
      if (!(preserveAuthorFor?.has(node.id) && node.lastModifiedBy)) node.lastModifiedBy = stamp.lastModifiedBy;
      continue;
    }
    if (node.lastModified) continue;
    node.lastModified = stamp.lastModified;
    if (!node.lastModifiedBy) node.lastModifiedBy = stamp.lastModifiedBy;
  }
}
