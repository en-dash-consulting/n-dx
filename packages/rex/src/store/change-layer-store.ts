/**
 * The change layer of a v2 tree behind the {@link PRDStore} interface, so the
 * level-based restructuring commands (`rex reshape`, `rex reorganize`,
 * `rex prune`) run on it as they run on a v1 tree.
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
import { newErrors } from "../core/apply-amendments.js";
import { changeLayerFromItems, changeLayerItems, productLayerItems } from "../core/layer-projection.js";
import { pruneKeepReason } from "../core/prune.js";
import { findItem, insertChild, removeFromTree, updateInTree, walkTree } from "../core/tree.js";
import type { RuleNode } from "../schema/v2-rules.js";
import type { PRDStore, StoreCapabilities } from "./contracts.js";
import { loadPrdModel, prdLayout } from "./prd-model-reader.js";
import { withPrdModelTransaction } from "./prd-model-transaction.js";

/** Thrown when a change-layer write would break a v2 rule the tree did not break before. */
export class ChangeLayerWriteError extends Error {
  constructor(problems: readonly string[]) {
    super(`Refusing to write the change layer: ${problems.join("; ")}`);
    this.name = "ChangeLayerWriteError";
  }
}

export class ChangeLayerStore implements PRDStore {
  constructor(
    private readonly rexDir: string,
    /** The v1 store, for config, log and workflow. */
    private readonly base: PRDStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async loadDocument(): Promise<PRDDocument> {
    const model = await loadPrdModel(this.rexDir);
    return { schema: SCHEMA_VERSION, title: model.title, items: changeLayerItems(model.tree.changes) };
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    const { result } = await withPrdModelTransaction(
      this.rexDir,
      async (model) => {
        const doc: PRDDocument = { schema: SCHEMA_VERSION, title: model.title, items: changeLayerItems(model.tree.changes) };
        const value = await fn(doc);
        const { changes, removed } = changeLayerFromItems(doc.items, model.tree.changes);
        const kept = keptRemovals(model.tree.changes, removed);
        if (kept.length) throw new ChangeLayerWriteError(kept);
        const tree = { product: model.tree.product, changes };
        const broken = newErrors(model.tree, tree, this.now());
        if (broken.length) throw new ChangeLayerWriteError(broken.map((f) => `the result breaks ${f.rule}: ${f.message}`));
        return { tree, result: value, removed };
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

  async getItem(id: string): Promise<PRDItem | null> {
    return findItem((await this.loadDocument()).items, id)?.item ?? null;
  }

  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    await this.withTransaction(async (doc) => {
      if (parentId === undefined) doc.items.push(item);
      else if (!insertChild(doc.items, parentId, item)) throw new Error(`Cannot add "${item.title}" under ${parentId}`);
    });
  }

  async updateItem(id: string, updates: Partial<PRDItem>): Promise<void> {
    await this.withTransaction(async (doc) => {
      if (!updateInTree(doc.items, id, updates)) throw new Error(`Item not found: ${id}`);
    });
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
    return { adapter: "v2-change-layer", supportsTransactions: true, supportsWatch: false };
  }
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

/** The store the restructuring commands write: the change layer on a v2 tree, `base` itself on a v1 tree. */
export async function resolveLayerStore(rexDir: string, base: PRDStore): Promise<{ store: PRDStore; v2: boolean }> {
  if ((await prdLayout(rexDir)) !== "v2") return { store: base, v2: false };
  return { store: new ChangeLayerStore(rexDir, base), v2: true };
}

/** The live product layer of a v2 tree, as read-only v1 items for analysis. */
export async function loadProductLayerItems(rexDir: string): Promise<PRDItem[]> {
  return productLayerItems((await loadPrdModel(rexDir)).tree.product);
}
