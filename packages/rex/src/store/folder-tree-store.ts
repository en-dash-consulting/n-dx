/**
 * PRDStore adapter backed by the folder-tree format.
 *
 * Reads and writes PRD items via `parseFolderTree` / `serializeFolderTree`.
 * Config, log, and workflow are stored as regular files alongside the tree.
 *
 * Contract guarantees:
 *   - `loadDocument` parses the on-disk folder tree and returns a PRDDocument.
 *   - `saveDocument` serializes the document items to the folder tree and
 *     persists the document title and schema version to `tree-meta.json`.
 *   - Unknown item fields survive round-trip via frontmatter passthrough;
 *     nested-object values are coerced to strings (supportsPassthrough: false).
 *   - All writes use atomic (temp + rename) operations for crash-safety.
 *   - Advisory file-locking prevents concurrent PRD writes (FIFO queue).
 *   - Single-item mutations avoid full-tree re-serialization when possible.
 *
 * @module rex/store/folder-tree-store
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { SCHEMA_VERSION } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { findItem, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { serializeFolderTree } from "./folder-tree-serializer.js";
import { parseFolderTree } from "./folder-tree-parser.js";
import { withLock } from "./file-lock.js";
import { parseTreeMeta, treeMetaContents } from "./tree-meta.js";
import { assertSlugRuleWritable, assertSlugRuleAdoptable } from "./slug-rule-guard.js";
import { PRD_TREE_DIRNAME, TREE_META_FILENAME, prdLockPath } from "./paths.js";
import type { PRDStore, StoreCapabilities, WriteOptions, SaveFileReport } from "./contracts.js";
import { buildSaveFileReport, mergeSaveFileReports } from "./contracts.js";
import {
  stampModified,
  stampUpdatedItem,
  stampActor,
  stampModifiedFields,
  snapshotItemContent,
  stampChangedItems,
} from "../core/sync.js";
import { resolveActor } from "../core/identity.js";

// ---------------------------------------------------------------------------
// FolderTreeStore
// ---------------------------------------------------------------------------

/**
 * PRDStore implementation that uses `.rex/prd_tree/` as the primary PRD backend.
 * Document title and schema version are persisted in `tree-meta.json` in the
 * same directory — see that module for why the schema has to be recorded.
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
  /** Identity of item files at load/save time, used by relocation-safe deletes. */
  private loadedFiles: ReadonlyMap<string, string> = new Map();
  /** Files written/deleted by saves since the last {@link takeSaveFileReport}. */
  private pendingSaveReport: SaveFileReport | null = null;

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
    // The version the tree was *written* at, not the one reading it. Absent on
    // any tree older than the marker, which then reads as the running version.
    let schema = SCHEMA_VERSION;
    try {
      const raw = await readFile(this.path(TREE_META_FILENAME), "utf-8");
      const meta = parseTreeMeta(raw);
      if (meta.title !== undefined) title = meta.title;
      if (meta.schema !== undefined) schema = meta.schema;
    } catch (err) {
      if (!isMissingFileError(err)) {
        throw err;
      }
    }

    const { items, fileDigests } = await parseFolderTree(this.treeRoot);
    this.loadedFiles = fileDigests;
    return { schema, title, items };
  }

  /**
   * Serialize the document to disk. Callers must hold the PRD lock.
   *
   * @param adoptSlugRule Skip the ordinary slug-rule guard and take ownership
   *   of the tree under this build's rule instead. Only `rex migrate-slugs`
   *   may pass this — see {@link adoptSlugRule}. The direction check still
   *   runs; only the *comparison* changes, from "matches exactly" to "is not
   *   newer".
   */
  private async writeTree(doc: PRDDocument, adoptSlugRule = false): Promise<void> {
    // Before mkdir, before the sidecar, before the serializer: a refusal has
    // to leave the tree byte-identical, which it only does if nothing has been
    // written yet. Both branches read the marker fresh, here, under the lock
    // `writeTree` is always called while holding — reading it any earlier
    // leaves a window where a concurrent writer's newer marker is read, then
    // silently overwritten by this write once it takes the lock.
    if (adoptSlugRule) {
      await assertSlugRuleAdoptable(this.rexDir);
    } else {
      await assertSlugRuleWritable(this.rexDir, this.treeRoot);
    }
    await mkdir(this.treeRoot, { recursive: true });
    const metaPath = this.path(TREE_META_FILENAME);
    await writeFile(metaPath, JSON.stringify(await treeMetaContents(metaPath, doc)), "utf-8");
    const written = await serializeFolderTree(doc.items, this.treeRoot, {
      loadedAt: this.loadedAt,
      loadedFiles: this.loadedFiles,
    });
    // A completed save makes this instance's view of the tree current again:
    // its own writes must not read as "another writer's work" on the next save.
    this.loadedAt = Date.now();
    this.loadedFiles = written.fileDigests;
    // Accumulated rather than replaced: a caller may save several times
    // between commit points and needs the union at take time.
    this.pendingSaveReport = mergeSaveFileReports(
      this.pendingSaveReport,
      buildSaveFileReport(written, dirname(this.rexDir)),
    );
  }

  takeSaveFileReport(): SaveFileReport | null {
    const report = this.pendingSaveReport;
    this.pendingSaveReport = null;
    return report;
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
    await withLock(prdLockPath(this.rexDir), () => this.writeTree(doc));
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

  async updateItem(id: string, updates: Partial<PRDItem>, options?: WriteOptions): Promise<void> {
    await this.runTransaction(
      async (doc) => {
        const entry = findItem(doc.items, id);
        if (!entry) {
          throw new Error(`Item "${id}" not found`);
        }
        const merged = await stampUpdatedItem(entry.item, updates, options);
        if (!updateInTree(doc.items, id, merged)) {
          throw new Error(`Item "${id}" not found`);
        }
      },
      options?.preserveModifiedBy ? new Set([id]) : undefined,
    );
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
    return this.runTransaction(fn);
  }

  /**
   * Rewrite the whole tree under this build's slug rule and record the marker.
   *
   * The one sanctioned way past {@link assertSlugRuleWritable}, and the reason
   * `rex migrate-slugs` can do its job at all: every other writer is refused
   * precisely because it would re-slug the tree, which is what this command
   * exists to do deliberately.
   *
   * Rewrite and marker land in the same locked write, so there is no window in
   * which the marker claims a rule the paths do not yet follow — a crash
   * between the two would disarm the guard on a tree it was meant to protect.
   *
   * Bounded to the adopt-older direction by {@link assertSlugRuleAdoptable},
   * checked by {@link writeTree} under the lock, ahead of `mkdir` — not here.
   * A pre-lock check here would read the marker, then race a concurrent
   * writer that records a newer one before this call takes the lock; the
   * stale "adoptable" verdict would let the migration overwrite it anyway.
   */
  async adoptSlugRule(): Promise<void> {
    await this.runTransaction(async () => {}, undefined, true);
  }

  /**
   * `withTransaction` plus the two knobs the public contract has no place for.
   *
   * `preserveAuthorFor` is threaded to {@link stampChangedItems}: a status
   * change moves an item's content signature, so the transaction-level stamp
   * would otherwise overwrite the author that `updateItem` deliberately kept
   * for a cascaded write (GitHub #368). The per-item stamp is not enough on
   * its own — this is where it gets undone.
   *
   * `adoptSlugRule` suppresses the slug-rule guard for this one write. It is
   * passed by {@link adoptSlugRule} and nothing else.
   */
  private async runTransaction<T>(
    fn: (doc: PRDDocument) => Promise<T>,
    preserveAuthorFor?: ReadonlySet<string>,
    adoptSlugRule = false,
  ): Promise<T> {
    // The lock file lives in rexDir, which may not exist on first write.
    await mkdir(this.rexDir, { recursive: true });
    const lockPath = prdLockPath(this.rexDir);
    // Resolved before the lock is taken: the first call in a process shells
    // out to git, and that is not work to do while holding the PRD lock. The
    // result is cached process-wide, so warming it here also keeps the
    // `stampModified` calls in addItem/updateItem/removeItem — which run
    // inside this transaction — off the locked span.
    const actor = await resolveActor();
    return withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      // Signatured before `fn` runs, so the stamp below covers whatever it
      // mutated directly — callers that bypass updateItem still get one.
      const before = snapshotItemContent(doc.items);
      const result = await fn(doc);
      stampChangedItems(doc.items, before, await stampModifiedFields(undefined, actor), preserveAuthorFor);
      const check = validateDocument(doc);
      if (!check.ok) {
        throw new Error(`Invalid document after mutation: ${check.errors.message}`);
      }
      // Write directly — the lock is already held. Calling saveDocument here
      // would deadlock on the in-process mutex, and an instance flag to skip
      // its lock would let a concurrent direct saveDocument bypass the lock
      // while a transaction is open.
      await this.writeTree(doc, adoptSlugRule);
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
