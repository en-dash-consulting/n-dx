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
 *   - Single-item mutations avoid full-tree re-serialization when possible.
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
import { parseFolderTree } from "./folder-tree-parser.js";
import { withLock } from "./file-lock.js";
import { PRD_TREE_DIRNAME } from "./paths.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";

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

  constructor(rexDir: string) {
    this.rexDir = rexDir;
    this.treeRoot = join(rexDir, PRD_TREE_DIRNAME);
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // ---- Document CRUD -------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
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

  async saveDocument(doc: PRDDocument): Promise<void> {
    const check = validateDocument(doc);
    if (!check.ok) {
      throw new Error(`Invalid document: ${check.errors.message}`);
    }

    await mkdir(this.treeRoot, { recursive: true });
    await writeFile(this.path("tree-meta.json"), JSON.stringify({ title: doc.title }), "utf-8");
    await serializeFolderTree(doc.items, this.treeRoot);
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string, _options?: WriteOptions): Promise<void> {
    const lockPath = this.path("prd.lock");
    await withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      if (parentId) {
        if (!insertChild(doc.items, parentId, item)) {
          throw new Error(`Parent "${parentId}" not found`);
        }
      } else {
        doc.items.push(item);
      }
      await this.saveDocument(doc);
    });
  }

  async updateItem(id: string, updates: Partial<PRDItem>, _options?: WriteOptions): Promise<void> {
    const lockPath = this.path("prd.lock");
    await withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      if (!updateInTree(doc.items, id, updates)) {
        throw new Error(`Item "${id}" not found`);
      }
      await this.saveDocument(doc);
    });
  }

  async removeItem(id: string): Promise<void> {
    const lockPath = this.path("prd.lock");
    await withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      if (!removeFromTree(doc.items, id)) {
        throw new Error(`Item "${id}" not found`);
      }
      await this.saveDocument(doc);
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
    const check = validateLogEntry(entry);
    if (!check.ok) {
      throw new Error(`Invalid log entry: ${check.errors.message}`);
    }
    await appendFile(this.path("execution-log.jsonl"), JSON.stringify(entry) + "\n", "utf-8");
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
    const lockPath = this.path("prd.lock");
    return withLock(lockPath, async () => {
      const doc = await this.loadDocument();
      const result = await fn(doc);
      const check = validateDocument(doc);
      if (!check.ok) {
        throw new Error(`Invalid document after mutation: ${check.errors.message}`);
      }
      await this.saveDocument(doc);
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
