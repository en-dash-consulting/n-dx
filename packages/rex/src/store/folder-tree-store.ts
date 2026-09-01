/**
 * PRDStore adapter backed by the folder-tree format.
 *
 * Reads and writes PRD items via `parseFolderTree` / `serializeFolderTree`.
 * Config, log, and workflow are stored as regular files alongside the tree.
 *
 * Contract guarantees:
 *   - `loadDocument` parses the on-disk folder tree and returns a PRDDocument.
 *   - `saveDocument` serializes the document items to the folder tree and
 *     persists the document title to `tree-meta.json`.
 *   - Unknown item fields survive round-trip via frontmatter passthrough;
 *     nested-object values are coerced to strings (supportsPassthrough: false).
 *   - All writes use atomic (temp + rename) operations for crash-safety.
 *   - Advisory file-locking prevents concurrent PRD writes (FIFO queue).
 *
 * ## Every save rewrites the whole tree
 *
 * There is no partial-write path. `saveDocument` and `withTransaction` both go
 * through `writeTree`, which hands the ENTIRE document to `serializeFolderTree`
 * and then removes every on-disk entry the document no longer accounts for.
 * `addItem`/`updateItem`/`removeItem` are read-modify-write over the whole
 * document, not surgical edits. Writes are content-addressed — `writeIfChanged`
 * skips a file whose bytes already match — so a whole-tree save is cheap in
 * practice and produces an empty diff when nothing changed.
 *
 * The consequence worth knowing: a change to the SLUG RULE renames every path
 * at once, so one status edit can produce a diff of hundreds of files. That is
 * a re-layout, not data loss, and `reportLayoutChurn` below says so out loud.
 * It also means a naming migration converges in a single save — if a tree needs
 * several, something is writing it with more than one version of the rule.
 *
 * @module rex/store/folder-tree-store
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { SCHEMA_VERSION } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { findItem, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { serializeFolderTree } from "./folder-tree-serializer.js";
import type { SerializeResult } from "./folder-tree-serializer.js";
import { parseFolderTree } from "./folder-tree-parser.js";
import { withLock } from "./file-lock.js";
import { PRD_TREE_DIRNAME } from "./paths.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";
import { stampModified, stampActor } from "../core/sync.js";

// ---------------------------------------------------------------------------
// Layout-churn reporting
// ---------------------------------------------------------------------------

/**
 * Removals above this count stop looking like an edit and start looking like an
 * accident. A normal mutation removes nothing, or the single path an item moved
 * from; only a layout change — a slug-rule migration, a bulk prune — reaches
 * double digits.
 */
const LAYOUT_CHURN_THRESHOLD = 20;

/**
 * Explain a mass removal so it cannot be misread as data loss.
 *
 * A slug-rule change rewrites every path in the tree, so a single status edit
 * can land a diff with hundreds of deletions in it. That has already been
 * mistaken for the PRD being destroyed, and disproving it meant counting items
 * by hand on both sides of the commit (972 before, 972 after).
 *
 * The reassurance is not a guess. `serializeFolderTree` writes every item in
 * the document to its current path BEFORE it removes anything, so a removed
 * path is necessarily one that nothing in the document occupies any more.
 * Printing the item count beside the removal count puts both halves of that
 * comparison in front of the operator at the moment it would otherwise alarm
 * them.
 *
 * Exported for tests; not part of the store's public contract.
 */
export function reportLayoutChurn(
  result: SerializeResult,
  warn: (message: string) => void = console.warn,
): void {
  const removed = result.filesRemoved + result.directoriesRemoved;
  if (removed < LAYOUT_CHURN_THRESHOLD) return;

  warn(
    `PRD tree layout changed: ${removed} stale path(s) removed after writing ` +
      `all ${result.itemsWritten} item(s) in the document.\n` +
      `  Every item was written to its current path before any removal, so this ` +
      `is a re-layout (e.g. a slug-naming migration), not lost items.\n` +
      `  Expect a large rename diff — check the item count, not the file count.`,
  );
}

// ---------------------------------------------------------------------------
// FolderTreeStore
// ---------------------------------------------------------------------------

/**
 * PRDStore implementation that uses `.rex/prd_tree/` as the primary PRD backend.
 * Document title is persisted in `tree-meta.json` in the same directory.
 */
export class FolderTreeStore implements PRDStore {
  private rexDir: string;
  private treeRoot: string;

  /**
   * When this instance last loaded the tree (epoch ms). Passed to the
   * serializer's stale-save guard: a save may only delete entries no newer
   * than this. Zero means "never loaded" — such a save may delete nothing.
   */
  private loadedAt = 0;

  constructor(rexDir: string) {
    this.rexDir = rexDir;
    this.treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // ---- Document CRUD -------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
    // Taken before the read starts, so an entry written during or after the
    // parse registers as newer than the load and the guard flags it.
    this.loadedAt = Date.now();
    let title = "PRD";
    try {
      const raw = await readFile(this.path("tree-meta.json"), "utf-8");
      const meta = JSON.parse(raw) as Record<string, unknown>;
      if (typeof meta["title"] === "string") title = meta["title"];
    } catch (err) {
      if (!isMissingFileError(err)) {
        throw err;
      }
    }

    const { items } = await parseFolderTree(this.treeRoot);
    return { schema: SCHEMA_VERSION, title, items };
  }

  /** Serialize the document to disk. Callers must hold the PRD lock. */
  private async writeTree(doc: PRDDocument): Promise<void> {
    await mkdir(this.treeRoot, { recursive: true });
    await writeFile(this.path("tree-meta.json"), JSON.stringify({ title: doc.title }), "utf-8");
    const result = await serializeFolderTree(doc.items, this.treeRoot, { loadedAt: this.loadedAt });
    reportLayoutChurn(result);
    // A completed save makes this instance's view of the tree current again:
    // its own writes must not read as "another writer's work" on the next save.
    this.loadedAt = Date.now();
  }

  /**
   * Persist a full PRD document, replacing whatever was stored.
   *
   * Acquires the PRD lock so concurrent writers serialize — matching
   * `FileStore.saveDocument`. Note the lock only serializes the write itself:
   * a caller that loaded the document earlier still overwrites concurrent
   * changes with its stale snapshot. Any read-modify-write belongs in
   * {@link withTransaction}, which holds the lock across the whole span.
   */
  async saveDocument(doc: PRDDocument): Promise<void> {
    const check = validateDocument(doc);
    if (!check.ok) {
      throw new Error(`Invalid document: ${check.errors.message}`);
    }
    // The lock file lives in rexDir, which may not exist on first save.
    await mkdir(this.rexDir, { recursive: true });
    await withLock(this.path("prd.lock"), () => this.writeTree(doc));
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string, _options?: WriteOptions): Promise<void> {
    await this.withTransaction(async (doc) => {
      const stamped = await stampModified(item);
      if (parentId) {
        if (!insertChild(doc.items, parentId, stamped)) {
          throw new Error(`Parent "${parentId}" not found`);
        }
      } else {
        doc.items.push(stamped);
      }
      // The serializer always writes the canonical shape: a leaf subtask
      // gaining its first child is naturally promoted from `<slug>.md` to
      // `<slug>/index.md`, and `removeStaleEntries` cleans the old leaf.
    });
  }

  async updateItem(id: string, updates: Partial<PRDItem>, _options?: WriteOptions): Promise<void> {
    await this.withTransaction(async (doc) => {
      const entry = findItem(doc.items, id);
      if (!entry) {
        throw new Error(`Item "${id}" not found`);
      }
      // Merge updates onto the current item before stamping so `lastModified`
      // always reflects this write, even when `updates` omits it.
      const merged = await stampModified({ ...entry.item, ...updates } as PRDItem);
      if (!updateInTree(doc.items, id, merged)) {
        throw new Error(`Item "${id}" not found`);
      }
    });
  }

  async removeItem(id: string): Promise<void> {
    await this.withTransaction(async (doc) => {
      const entry = findItem(doc.items, id);
      if (!entry) {
        throw new Error(`Item "${id}" not found`);
      }
      if (!removeFromTree(doc.items, id)) {
        throw new Error(`Item "${id}" not found`);
      }
      // Removing a child mutates its parent's on-disk content (children
      // list changes), so the parent needs a fresh stamp too — otherwise a
      // parent whose only observable change was a child's removal would
      // never be detected as modified by the sync engine. `parent` is a
      // live reference into `doc.items` (walkTree does not clone), so
      // mutating it in place is sufficient — no re-lookup needed.
      const parent = entry.parents[entry.parents.length - 1];
      if (parent) {
        Object.assign(parent, await stampModified(parent));
      }
    });
  }

  // ---- Configuration -------------------------------------------------------

  async loadConfig(): Promise<RexConfig> {
    const raw = await readFile(this.path("config.json"), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    const check = validateConfig(parsed);
    if (!check.ok) {
      throw new Error(`Invalid config.json: ${check.errors.message}`);
    }
    return check.data as RexConfig;
  }

  async saveConfig(config: RexConfig): Promise<void> {
    await writeFile(this.path("config.json"), JSON.stringify(config, null, 2), "utf-8");
  }

  // ---- Execution log -------------------------------------------------------

  async appendLog(entry: LogEntry): Promise<void> {
    const stamped = await stampActor(entry);
    const check = validateLogEntry(stamped);
    if (!check.ok) {
      throw new Error(`Invalid log entry: ${check.errors.message}`);
    }
    await appendFile(this.path("execution-log.jsonl"), JSON.stringify(stamped) + "\n", "utf-8");
  }

  async readLog(limit?: number): Promise<LogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path("execution-log.jsonl"), "utf-8");
    } catch (err) {
      if (isMissingFileError(err)) {
        return [];
      }
      throw err;
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch (err) {
        if (!(err instanceof SyntaxError)) {
          throw err;
        }
      }
    }
    if (limit !== undefined && entries.length > limit) {
      return entries.slice(entries.length - limit);
    }
    return entries;
  }

  // ---- Workflow ------------------------------------------------------------

  async loadWorkflow(): Promise<string> {
    try {
      return await readFile(this.path("workflow.md"), "utf-8");
    } catch (err) {
      if (isMissingFileError(err)) {
        return "";
      }
      throw err;
    }
  }

  async saveWorkflow(content: string): Promise<void> {
    await writeFile(this.path("workflow.md"), content, "utf-8");
  }

  // ---- Transactions --------------------------------------------------------

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    // The lock file lives in rexDir, which may not exist on first write.
    await mkdir(this.rexDir, { recursive: true });
    const lockPath = this.path("prd.lock");
    return withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      const result = await fn(doc);
      const check = validateDocument(doc);
      if (!check.ok) {
        throw new Error(`Invalid document after mutation: ${check.errors.message}`);
      }
      // Write directly — the lock is already held. Calling saveDocument here
      // would deadlock on the in-process mutex, and an instance flag to skip
      // its lock would let a concurrent direct saveDocument bypass the lock
      // while a transaction is open.
      await this.writeTree(doc);
      return result;
    });
  }

  // ---- Introspection -------------------------------------------------------

  capabilities(): StoreCapabilities {
    return {
      adapter: "folder-tree",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }

}

// ---------------------------------------------------------------------------
// Initialiser helper
// ---------------------------------------------------------------------------

/**
 * Ensure the files required by FolderTreeStore exist in `rexDir`.
 * Idempotent — safe to call on an already-initialised directory.
 */
export async function ensureFolderTreeRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}

function isMissingFileError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}
