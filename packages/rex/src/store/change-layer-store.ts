/**
 * The change layer of a v2 tree behind the {@link PRDStore} interface, so the
 * level-based restructuring commands (`rex reshape`, `rex reorganize`,
 * `rex prune`) run on it as they run on a v1 tree. `resolveStore` returns it
 * on a v2 tree, so every `PRDStore` caller opens the change layer there.
 *
 * The document is the change layer projected as v1 items
 * (`core/layer-projection.ts`). Every write goes through
 * {@link withPrdModelTransaction}: the mutation edits a freshly projected
 * document under the PRD lock and the items are mapped back onto the change
 * layer. The product layer is never in the document, so nothing written here
 * touches `product/`; it changes only through a change's amendments.
 *
 * A write whose result breaks a v2 rule the tree did not already break (a
 * change moved under a task, a `blockedBy` left dangling) is refused before
 * anything is written, as is one that removes a change prune keeps (an
 * applied change with removed or added amendments). Config, log and workflow are the v1 store's: they do
 * not depend on the tree layout.
 *
 * @module rex/store/change-layer-store
 */

import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { SCHEMA_VERSION } from "../schema/v1.js";
import { SCHEMA_VERSION_V2 } from "../schema/v2.js";
import { newErrors } from "../core/apply-amendments.js";
import { changeLayerFromItems, changeLayerItems, productLayerItems } from "../core/layer-projection.js";
import { pruneKeepReason } from "../core/prune.js";
import { findItem, insertChild, removeFromTree, updateInTree, walkTree } from "../core/tree.js";
import { indexTree, type RuleNode, type V2Tree } from "../schema/v2-rules.js";
import { join } from "node:path";
import { projectRootOf } from "@n-dx/llm-client";
import type { PRDStore, SaveFileReport, StoreCapabilities, WriteOptions } from "./contracts.js";
import { buildSaveFileReport, mergeSaveFileReports } from "./contracts.js";
import { loadPrdModel, prdLayout, type PrdModel } from "./prd-model-reader.js";
import {
  withPrdModelTransaction,
  type PrdModelEdit,
  type PrdModelTransactionOptions,
  type PrdModelTransactionResult,
} from "./prd-model-transaction.js";

/** Thrown when a change-layer write would break a v2 rule the tree did not break before. */
export class ChangeLayerWriteError extends Error {
  constructor(problems: readonly string[]) {
    super(`Refusing to write the change layer: ${problems.join("; ")}`);
    this.name = "ChangeLayerWriteError";
  }
}

export class ChangeLayerStore implements PRDStore {
  /** Files written/deleted under `product/` and `changes/` since the last {@link takeSaveFileReport}. */
  private pendingSaveReport: SaveFileReport | null = null;

  constructor(
    readonly rexDir: string,
    /** The v1 store, for config, log and workflow. */
    private readonly base: PRDStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadDocument(): Promise<PRDDocument> {
    const model = await loadPrdModel(this.rexDir);
    return { schema: SCHEMA_VERSION, title: model.title, items: changeLayerItems(model.tree.changes) };
  }

  /** The v2 tree itself, for the code that works on change-layer nodes rather than projected items. */
  async loadTree(): Promise<V2Tree> {
    return (await loadPrdModel(this.rexDir)).tree;
  }

  /**
   * {@link withPrdModelTransaction} on this store's tree, recording the files
   * the write touched for {@link takeSaveFileReport}. Every v2 write made
   * through this store goes through here: the change-layer edits and
   * `completeV2Work`'s completion and apply.
   */
  async withModelTransaction<T>(
    mutate: (model: PrdModel) => PrdModelEdit<T> | Promise<PrdModelEdit<T>>,
    options?: PrdModelTransactionOptions,
  ): Promise<PrdModelTransactionResult<T>> {
    const out = await withPrdModelTransaction(this.rexDir, mutate, options);
    const abs = (paths: string[]) => paths.map((p) => join(this.rexDir, p));
    // projectRootOf, not dirname: on the `.ndx/` layout rexDir's parent is the container.
    this.pendingSaveReport = mergeSaveFileReports(
      this.pendingSaveReport,
      buildSaveFileReport({ writtenPaths: abs(out.written.written), deletedPaths: abs(out.written.deletedFiles) }, projectRootOf(this.rexDir)),
    );
    return out;
  }

  /** Drain the files this store's writes touched since the last take; `null` when none did. */
  takeSaveFileReport(): SaveFileReport | null {
    const report = this.pendingSaveReport;
    this.pendingSaveReport = null;
    return report;
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    return this.changeLayerTransaction(fn);
  }

  /** {@link withTransaction}, keeping the existing author of the nodes in `preserveAuthorFor`. */
  private async changeLayerTransaction<T>(fn: (doc: PRDDocument) => Promise<T>, preserveAuthorFor?: ReadonlySet<string>): Promise<T> {
    const { result } = await this.withModelTransaction(
      async (model) => {
        const doc: PRDDocument = { schema: SCHEMA_VERSION, title: model.title, items: changeLayerItems(model.tree.changes) };
        const value = await fn(doc);
        const { changes, removed } = changeLayerFromItems(doc.items, model.tree.changes);
        const kept = keptRemovals(model.tree.changes, removed);
        if (kept.length) throw new ChangeLayerWriteError(kept);
        const tree = { product: model.tree.product, changes };
        const broken = newErrors(model.tree, tree, this.now());
        if (broken.length) throw new ChangeLayerWriteError(broken.map((f) => `the result breaks ${f.rule}: ${f.message}`));
        return { tree, result: value, removed, preserveAuthorFor };
      },
      { now: this.now },
    );
    return result;
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    await this.withTransaction(async (current) => {
      current.items = doc.items;
    });
  }

  /**
   * The node id of the live change a reference names: its id, display id or
   * alias, as `get_item` resolves it. A reference that names no change comes
   * back unchanged, so the caller's own not-found path reports it.
   */
  async resolveRef(ref: string): Promise<string> {
    const { entries, resolve } = indexTree(await this.loadTree());
    const node = resolve(ref);
    return node && entries.some((e) => e.node === node && e.root === "changes") ? node.id : ref;
  }

  async getItem(id: string): Promise<PRDItem | null> {
    return findItem((await this.loadDocument()).items, id)?.item ?? null;
  }

  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    await this.withTransaction(async (doc) => {
      if (parentId === undefined) doc.items.push(item);
      else if (!insertChild(doc.items, parentId, item)) throw new Error(`Cannot add "${item.title}" under ${parentId}`);
    });
  }

  /** `options.preserveModifiedBy` keeps the node's existing `lastModifiedBy`, as on v1 (GitHub #368). */
  async updateItem(id: string, updates: Partial<PRDItem>, options?: WriteOptions): Promise<void> {
    await this.changeLayerTransaction(
      async (doc) => {
        if (!updateInTree(doc.items, id, updates)) throw new Error(`Item not found: ${id}`);
      },
      options?.preserveModifiedBy ? new Set([id]) : undefined,
    );
  }

  async removeItem(id: string): Promise<void> {
    await this.withTransaction(async (doc) => {
      if (!removeFromTree(doc.items, id)) throw new Error(`Item not found: ${id}`);
    });
  }

  loadConfig(): Promise<RexConfig> {
    return this.base.loadConfig();
  }

  saveConfig(config: RexConfig): Promise<void> {
    return this.base.saveConfig(config);
  }

  appendLog(entry: LogEntry): Promise<void> {
    return this.base.appendLog(entry);
  }

  readLog(limit?: number): Promise<LogEntry[]> {
    return this.base.readLog(limit);
  }

  loadWorkflow(): Promise<string> {
    return this.base.loadWorkflow();
  }

  saveWorkflow(content: string): Promise<void> {
    return this.base.saveWorkflow(content);
  }

  capabilities(): StoreCapabilities {
    return { adapter: "v2-change-layer", supportsTransactions: true, supportsWatch: false, schemaVersion: SCHEMA_VERSION_V2 };
  }
}

/** Whether `store` serves the change layer of a v2 tree. */
export function isChangeLayerStore(store: PRDStore): store is ChangeLayerStore {
  return store instanceof ChangeLayerStore;
}

/**
 * `ref` as the id the store looks items up by: on a v2 tree a display id or
 * alias maps to its change's node id. A v1 store, and a reference that names
 * no change, return it unchanged.
 */
export async function resolveItemRef(store: PRDStore, ref: string): Promise<string> {
  return isChangeLayerStore(store) ? store.resolveRef(ref) : ref;
}

/**
 * A problem for each removed change prune keeps ({@link pruneKeepReason}): the
 * backstop behind the restructure guards, so no write path can delete the
 * change that marks a product node retired. Other completed changes may go.
 */
function keptRemovals(changes: readonly RuleNode[], removed: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const { item } of walkTree(changeLayerItems(changes))) {
    const reason = removed.has(item.id) ? pruneKeepReason(item) : undefined;
    if (reason) problems.push(`"${item.title}" (${item.id}) cannot be removed: ${reason}`);
  }
  return problems;
}

/**
 * The change layer on a v2 tree, `base` itself on a v1 tree. A `base` that is
 * already the change layer (what `resolveStore` returns on a v2 tree) is
 * returned as it is.
 */
export async function resolveLayerStore(rexDir: string, base: PRDStore): Promise<{ store: PRDStore; v2: boolean }> {
  if ((await prdLayout(rexDir)) !== "v2") return { store: base, v2: false };
  if (base instanceof ChangeLayerStore) return { store: base, v2: true };
  return { store: new ChangeLayerStore(rexDir, base), v2: true };
}

/** The live product layer of a v2 tree, as read-only v1 items for analysis. */
export async function loadProductLayerItems(rexDir: string): Promise<PRDItem[]> {
  return productLayerItems((await loadPrdModel(rexDir)).tree.product);
}
