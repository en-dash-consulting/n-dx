import { readFile, writeFile, appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, walkTree, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import { atomicWriteJSON } from "./atomic-write.js";
import { withLock } from "./file-lock.js";
import { discoverPRDFiles } from "./prd-discovery.js";
import type { PRDStore, StoreCapabilities } from "./contracts.js";

export class FileStore implements PRDStore {
  private rexDir: string;
  /** True while inside withTransaction — prevents double-locking in saveDocument. */
  private inTransaction = false;

  // ── Write-routing state ───────────────────────────────────────────────

  /** Maps item ID → filename that owns the item. Populated by loadDocument/mergeDocuments. */
  private itemToFile: Map<string, string> = new Map();

  /** Per-file metadata (schema, title) for decomposing aggregated documents on save. */
  private fileMetadata: Map<string, { schema: string; title: string }> = new Map();

  /** True once the ownership map has been populated at least once. */
  private ownershipLoaded = false;

  /**
   * The file whose metadata (schema, title) was used as the base for the
   * aggregated document. Title changes on the aggregated doc flow back to
   * this file on save.
   */
  private primaryFile: string | null = null;

  /**
   * Target file for new root-level items (no parentId).
   * Defaults to `"prd.json"` for backward compatibility. Callers that resolve
   * the current git branch can set this via {@link setCurrentBranchFile}.
   */
  private currentBranchFile: string = "prd.json";

  constructor(rexDir: string, options?: { currentBranchFile?: string }) {
    this.rexDir = rexDir;
    if (options?.currentBranchFile) {
      this.currentBranchFile = options.currentBranchFile;
    }
  }

  /**
   * Set the target file for new root-level items.
   *
   * Call this after resolving the current branch via `resolvePRDFile()`
   * so that `addItem()` without a parentId writes to the correct file.
   */
  setCurrentBranchFile(filename: string): void {
    this.currentBranchFile = filename;
  }

  /** Return the current branch file target (for testing / introspection). */
  getCurrentBranchFile(): string {
    return this.currentBranchFile;
  }

  /**
   * Return a read-only snapshot of the item-to-file ownership map.
   *
   * Populated as a side effect of {@link loadDocument}. Returns an empty map
   * if the document has not been loaded yet. Callers should load the document
   * first.
   */
  getItemFileMap(): ReadonlyMap<string, string> {
    return this.itemToFile;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  private lockPathForFile(filename: string): string {
    return this.path(`${filename}.lock`);
  }

  /**
   * Load and validate a single PRD file by filename.
   * Used internally for both primary and branch-scoped files.
   */
  private async loadSingleFile(filename: string): Promise<PRDDocument> {
    const raw = await readFile(this.path(filename), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateDocument(parsed);
    if (!result.ok) {
      throw new Error(`Invalid ${filename}: ${result.errors.message}`);
    }
    return result.data as PRDDocument;
  }

  /**
   * Merge multiple PRD documents into a single unified document.
   * Uses the first source's metadata (schema, title) as the base.
   * Populates the item-to-file ownership map and per-file metadata as a side effect.
   * Throws on ID collisions across files.
   */
  private mergeDocuments(
    sources: Array<{ filename: string; doc: PRDDocument }>,
  ): PRDDocument {
    const allItems: PRDItem[] = [];
    const collisions: string[] = [];

    this.itemToFile.clear();
    this.fileMetadata.clear();

    for (const { filename, doc } of sources) {
      this.fileMetadata.set(filename, { schema: doc.schema, title: doc.title });
      for (const entry of walkTree(doc.items)) {
        const existing = this.itemToFile.get(entry.item.id);
        if (existing) {
          collisions.push(`  ${entry.item.id} in ${existing} and ${filename}`);
        } else {
          this.itemToFile.set(entry.item.id, filename);
        }
      }
      allItems.push(...doc.items);
    }

    if (collisions.length > 0) {
      throw new Error(`ID collision across PRD files:\n${collisions.join("\n")}`);
    }

    this.primaryFile = sources[0].filename;
    this.ownershipLoaded = true;

    return {
      ...sources[0].doc,
      items: allItems,
    };
  }

  /**
   * Ensure the ownership map is populated.
   *
   * Loads all PRD files to build the item→file mapping. Skipped when
   * the map is already populated from a prior loadDocument() call.
   */
  private async ensureOwnershipMap(): Promise<void> {
    if (this.ownershipLoaded) return;
    await this.loadDocument();
  }

  /**
   * Resolve the owning file for a given item ID.
   *
   * Builds the ownership map on first call (lazy). Throws if the item
   * is not found in any PRD file.
   */
  private async resolveOwnerFile(itemId: string): Promise<string> {
    await this.ensureOwnershipMap();
    const file = this.itemToFile.get(itemId);
    if (!file) {
      throw new Error(`Item "${itemId}" not found in any PRD file`);
    }
    return file;
  }

  // ── Per-file transaction ──────────────────────────────────────────────

  /**
   * Execute a read-modify-write cycle on a single PRD file.
   *
   * Acquires a per-file lock, loads the file, runs the callback (which
   * may mutate the document in-place), validates, and saves atomically.
   */
  private async withFileTransaction<T>(
    filename: string,
    fn: (doc: PRDDocument) => Promise<T>,
  ): Promise<T> {
    return withLock(this.lockPathForFile(filename), async () => {
      const doc = await this.loadSingleFile(filename);
      const result = await fn(doc);
      const valid = validateDocument(doc);
      if (!valid.ok) {
        throw new Error(`Invalid document after mutation: ${valid.errors.message}`);
      }
      await atomicWriteJSON(this.path(filename), doc, toCanonicalJSON);
      return result;
    });
  }

  // ── Nested lock helper ────────────────────────────────────────────────

  /**
   * Acquire per-file locks in deterministic (sorted) order, then run `fn`.
   *
   * Prevents deadlocks by always acquiring locks in the same order.
   * When the file list is empty, `fn` runs immediately.
   */
  private async withNestedLocks<T>(
    filenames: string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    if (filenames.length === 0) return fn();
    const [next, ...rest] = filenames;
    return withLock(this.lockPathForFile(next), () =>
      this.withNestedLocks(rest, fn),
    );
  }

  /**
   * Load the full PRD document tree, aggregating items from all PRD files.
   *
   * Discovers all `prd_*.json` files in `.rex/` and merges their item trees
   * with the legacy `prd.json` (if present) into a single unified document.
   * Populates the item-to-file ownership map as a side effect.
   *
   * When only `prd.json` exists (no branch-scoped files), behaves identically
   * to the original single-file load.
   *
   * @throws If no PRD files exist, if any file contains invalid data,
   *         or if item IDs collide across files.
   */
  async loadDocument(): Promise<PRDDocument> {
    const branchFiles = await discoverPRDFiles(this.rexDir);

    // Fast path: no branch-scoped files, load legacy prd.json directly
    if (branchFiles.length === 0) {
      const doc = await this.loadSingleFile("prd.json");
      // Populate ownership map even for single-file case
      this.itemToFile.clear();
      this.fileMetadata.clear();
      this.fileMetadata.set("prd.json", { schema: doc.schema, title: doc.title });
      for (const entry of walkTree(doc.items)) {
        this.itemToFile.set(entry.item.id, "prd.json");
      }
      this.primaryFile = "prd.json";
      this.ownershipLoaded = true;
      return doc;
    }

    // Aggregate all PRD sources
    const sources: Array<{ filename: string; doc: PRDDocument }> = [];

    // Include legacy prd.json if it exists
    try {
      const doc = await this.loadSingleFile("prd.json");
      sources.push({ filename: "prd.json", doc });
    } catch (err: unknown) {
      // Tolerate "file not found" — corrupt prd.json should still fail
      if (
        !(err instanceof Error) ||
        !("code" in err) ||
        (err as NodeJS.ErrnoException).code !== "ENOENT"
      ) {
        throw err;
      }
    }

    // Load each branch-scoped file
    for (const filename of branchFiles) {
      const doc = await this.loadSingleFile(filename);
      sources.push({ filename, doc });
    }

    if (sources.length === 1) {
      // Single source — populate ownership directly (mergeDocuments requires 2+)
      const { filename, doc } = sources[0];
      this.itemToFile.clear();
      this.fileMetadata.clear();
      this.fileMetadata.set(filename, { schema: doc.schema, title: doc.title });
      for (const entry of walkTree(doc.items)) {
        this.itemToFile.set(entry.item.id, filename);
      }
      this.primaryFile = filename;
      this.ownershipLoaded = true;
      return doc;
    }

    return this.mergeDocuments(sources);
  }

  /**
   * Persist a PRD document, routing items back to their owning files.
   *
   * When ownership data exists (from a prior loadDocument call), decomposes
   * the document by root-item ownership and writes each file independently.
   * New root items (not in the ownership map) go to {@link currentBranchFile}.
   *
   * When no ownership data exists (legacy single-file mode), writes the
   * entire document to `prd.json`.
   */
  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }

    // Single-file fast path: no ownership data — write to prd.json
    if (!this.ownershipLoaded) {
      if (this.inTransaction) {
        await atomicWriteJSON(this.path("prd.json"), doc, toCanonicalJSON);
      } else {
        await withLock(this.lockPathForFile("prd.json"), async () => {
          await atomicWriteJSON(this.path("prd.json"), doc, toCanonicalJSON);
        });
      }
      return;
    }

    // Multi-file decomposition: group root items by owning file
    const fileItems = new Map<string, PRDItem[]>();

    // Seed with all known files so emptied files get written
    for (const filename of this.fileMetadata.keys()) {
      fileItems.set(filename, []);
    }

    for (const item of doc.items) {
      const file = this.itemToFile.get(item.id) ?? this.currentBranchFile;
      if (!fileItems.has(file)) fileItems.set(file, []);
      fileItems.get(file)!.push(item);
    }

    const filenames = [...fileItems.keys()].sort();

    const writeAll = async () => {
      for (const filename of filenames) {
        const items = fileItems.get(filename)!;
        // Primary file gets the aggregated doc's metadata (title changes propagate).
        // Other files keep their own cached metadata.
        const meta =
          filename === this.primaryFile
            ? { schema: doc.schema, title: doc.title }
            : this.fileMetadata.get(filename) ?? {
                schema: doc.schema,
                title: doc.title,
              };
        const fileDoc: PRDDocument = {
          schema: meta.schema,
          title: meta.title,
          items,
        };
        await atomicWriteJSON(this.path(filename), fileDoc, toCanonicalJSON);
      }
    };

    if (this.inTransaction) {
      // Locks already held by withTransaction
      await writeAll();
    } else {
      await this.withNestedLocks(filenames, writeAll);
    }

    // Refresh ownership map to reflect the new state
    this.itemToFile.clear();
    for (const [filename, items] of fileItems) {
      for (const entry of walkTree(items)) {
        this.itemToFile.set(entry.item.id, filename);
      }
    }
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    // Discover all PRD files to lock
    const branchFiles = await discoverPRDFiles(this.rexDir);
    const allFiles = ["prd.json", ...branchFiles].sort();

    return this.withNestedLocks(allFiles, async () => {
      this.inTransaction = true;
      try {
        const doc = await this.loadDocument();
        const result = await fn(doc);
        await this.saveDocument(doc);
        return result;
      } finally {
        this.inTransaction = false;
      }
    });
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    if (parentId) {
      let ownerFile: string;
      try {
        ownerFile = await this.resolveOwnerFile(parentId);
      } catch {
        throw new Error(`Parent "${parentId}" not found`);
      }
      await this.withFileTransaction(ownerFile, async (doc) => {
        if (!insertChild(doc.items, parentId, item)) {
          throw new Error(`Parent "${parentId}" not found`);
        }
      });
      // Update ownership map for the new item and any children it carries
      for (const entry of walkTree([item])) {
        this.itemToFile.set(entry.item.id, ownerFile);
      }
    } else {
      await this.withFileTransaction(this.currentBranchFile, async (doc) => {
        doc.items.push(item);
      });
      for (const entry of walkTree([item])) {
        this.itemToFile.set(entry.item.id, this.currentBranchFile);
      }
    }
  }

  async updateItem(id: string, updates: Partial<PRDItem>): Promise<void> {
    const ownerFile = await this.resolveOwnerFile(id);
    await this.withFileTransaction(ownerFile, async (doc) => {
      if (!updateInTree(doc.items, id, updates)) {
        throw new Error(`Item "${id}" not found`);
      }
    });
  }

  async removeItem(id: string): Promise<void> {
    const ownerFile = await this.resolveOwnerFile(id);
    let removedItem: PRDItem | null = null;
    await this.withFileTransaction(ownerFile, async (doc) => {
      removedItem = removeFromTree(doc.items, id);
      if (!removedItem) {
        throw new Error(`Item "${id}" not found`);
      }
    });
    // Clean up ownership for removed item and its descendants
    if (removedItem) {
      for (const entry of walkTree([removedItem])) {
        this.itemToFile.delete(entry.item.id);
      }
    }
  }

  async loadConfig(): Promise<RexConfig> {
    const raw = await readFile(this.path("config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateConfig(parsed);
    if (!result.ok) {
      throw new Error(`Invalid config.json: ${result.errors.message}`);
    }

    // Merge project-level .n-dx.json overrides (project config takes precedence)
    const overrides = await loadProjectOverrides(this.rexDir, "rex");
    return mergeWithOverrides(result.data as RexConfig, overrides);
  }

  async saveConfig(config: RexConfig): Promise<void> {
    await writeFile(this.path("config.json"), toCanonicalJSON(config), "utf-8");
  }

  async appendLog(entry: LogEntry): Promise<void> {
    const result = validateLogEntry(entry);
    if (!result.ok) {
      throw new Error(`Invalid log entry: ${result.errors.message}`);
    }
    // Truncate detail to prevent huge log entries
    const MAX_DETAIL_LENGTH = 2000;
    const sanitizedEntry =
      entry.detail && entry.detail.length > MAX_DETAIL_LENGTH
        ? { ...entry, detail: entry.detail.slice(0, MAX_DETAIL_LENGTH) + "..." }
        : entry;

    const logPath = this.path("execution-log.jsonl");

    // Rotate if the log exceeds the size threshold (1 MB default).
    // The rotated file is kept as a single backup; older backups are discarded.
    await this.maybeRotateLog(logPath);

    await appendFile(logPath, JSON.stringify(sanitizedEntry) + "\n", "utf-8");
  }

  /** Rotate execution-log.jsonl when it exceeds MAX_LOG_BYTES. */
  private async maybeRotateLog(logPath: string): Promise<void> {
    const MAX_LOG_BYTES = 1_048_576; // 1 MB
    try {
      const info = await stat(logPath);
      if (info.size < MAX_LOG_BYTES) return;
      // Rotate: current → .1 (overwrites any previous .1)
      await rename(logPath, logPath.replace(".jsonl", ".1.jsonl"));
    } catch {
      // File doesn't exist yet or stat/rename failed — skip rotation
    }
  }

  async readLog(limit?: number): Promise<LogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path("execution-log.jsonl"), "utf-8");
    } catch {
      return [];
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries: LogEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line) as LogEntry);
      } catch {
        // Skip malformed lines (e.g., from truncated writes or unescaped newlines)
      }
    }
    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }
    return entries;
  }

  async loadWorkflow(): Promise<string> {
    // Load base n-dx workflow + user customizations
    let base = "";
    try {
      base = await readFile(this.path("n-dx_workflow.md"), "utf-8");
    } catch {
      // n-dx_workflow.md doesn't exist — legacy or pre-split installation
    }

    let userRaw = "";
    try {
      userRaw = await readFile(this.path("workflow.md"), "utf-8");
    } catch {
      // No user workflow
    }

    if (!base) {
      // Legacy mode: workflow.md is the only file, return as-is
      return userRaw || "";
    }

    // Strip HTML comments from user workflow (the default template is one big comment)
    const user = userRaw.replace(/<!--[\s\S]*?-->/g, "").trim();

    if (user) {
      return `${base}\n\n## Project-Specific Rules\n\n${user}`;
    }
    return base;
  }

  async saveWorkflow(content: string): Promise<void> {
    await writeFile(this.path("workflow.md"), content, "utf-8");
  }

  capabilities(): StoreCapabilities {
    return {
      adapter: "file",
      supportsTransactions: true,
      supportsWatch: false,
    };
  }
}

export async function ensureRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}
