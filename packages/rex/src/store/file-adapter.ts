import { readFile, writeFile, appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { SCHEMA_VERSION } from "../schema/index.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, walkTree, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import { atomicWrite } from "./atomic-write.js";
import { withLock } from "./file-lock.js";
import { discoverPRDFiles } from "./prd-discovery.js";
import {
  PRD_MARKDOWN_FILENAME,
  toMarkdownSourcePath,
} from "./prd-md-migration.js";
import { parseDocument } from "./markdown-parser.js";
import { parseFolderTree } from "./folder-tree-parser.js";
import { serializeFolderTree } from "./folder-tree-serializer.js";
import { titleToFilename } from "./title-to-filename.js";
import { resolveGitBranch } from "./branch-naming.js";
import { withSelfHealTag } from "./self-heal-tag.js";
import { PRD_TREE_DIRNAME } from "./paths.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";

/** Canonical filename for the consolidated PRD document. */
export const PRD_FILENAME = "prd.json";

export class FileStore implements PRDStore {
  private rexDir: string;
  /** True while inside withTransaction — prevents double-locking in saveDocument. */
  private inTransaction = false;
  private itemToFile: Map<string, string> = new Map();
  private fileMetadata: Map<string, { schema: string; title: string }> = new Map();
  private ownershipLoaded = false;
  private primaryFile: string | null = null;
  private currentBranchFile: string = PRD_FILENAME;

  constructor(rexDir: string, options?: { currentBranchFile?: string }) {
    this.rexDir = rexDir;
    if (options?.currentBranchFile) {
      this.currentBranchFile = options.currentBranchFile;
    }
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  private get prdPath(): string {
    return this.path(PRD_FILENAME);
  }

  private get markdownPath(): string {
    return this.path(PRD_MARKDOWN_FILENAME);
  }

  private get prdLockPath(): string {
    return this.path(`${PRD_FILENAME}.lock`);
  }

  private get markdownLockPath(): string {
    return this.path(`${PRD_MARKDOWN_FILENAME}.lock`);
  }

  private get treeRoot(): string {
    return this.path(PRD_TREE_DIRNAME);
  }

  setCurrentBranchFile(filename: string): void {
    this.currentBranchFile = filename;
  }

  getCurrentBranchFile(): string {
    return this.currentBranchFile;
  }

  /** Expose the item-to-file ownership map for cross-file duplicate detection. */
  getItemFileMap(): ReadonlyMap<string, string> {
    return this.itemToFile;
  }

  /**
   * Ensure the item-to-file ownership map is populated, then return it.
   *
   * Forces a JSON-source read so the map reflects all on-disk PRD files
   * even when {@link loadDocument} was satisfied by the markdown cache.
   * Use this when callers need authoritative per-file attribution
   * (e.g. `rex status --show-individual`).
   */
  async loadFileOwnership(): Promise<ReadonlyMap<string, string>> {
    await this.ensureOwnershipMap();
    return this.itemToFile;
  }

  /** Filenames known to the store after ownership has been loaded. */
  getKnownFiles(): ReadonlyArray<string> {
    return [...this.fileMetadata.keys()];
  }

  private lockPathForFile(filename: string): string {
    return this.path(`${filename}.lock`);
  }

  private toAttributedSourceFile(filename: string): string {
    return toMarkdownSourcePath(filename);
  }

  private applyWriteAttribution<T extends PRDItem | Partial<PRDItem>>(
    value: T,
    filename: string,
    options?: WriteOptions,
  ): T {
    if (!options?.applyAttribution) {
      return value;
    }

    const attributed = {
      ...value,
      sourceFile: this.toAttributedSourceFile(filename),
    };
    const branch = resolveGitBranch(options.projectDir ?? join(this.rexDir, ".."));
    if (branch !== "unknown") {
      attributed.branch = branch;
    } else {
      delete attributed.branch;
    }
    return attributed as T;
  }

  private async loadSingleFile(filename: string): Promise<PRDDocument> {
    const raw = await readFile(this.path(filename), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateDocument(parsed);
    if (!result.ok) {
      throw new Error(`Invalid ${filename}: ${result.errors.message}`);
    }
    return result.data as PRDDocument;
  }

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

  private async ensureOwnershipMap(): Promise<void> {
    if (this.ownershipLoaded) return;
    await this.loadDocument();
  }

  private async resolveOwnerFile(itemId: string): Promise<string> {
    await this.ensureOwnershipMap();
    const file = this.itemToFile.get(itemId);
    if (!file) {
      throw new Error(`Item "${itemId}" not found in any PRD file`);
    }
    return file;
  }

  /**
   * Map an item back to its logical "owner file" key for the in-memory
   * itemToFile map. The actual on-disk write target is the folder-tree at `.rex/prd_tree/`,
   * but the map is preserved so backwards-compatible APIs (getKnownFiles, ownership
   * inspection) continue to work. The key is derived from the item's
   * `sourceFile` attribution, normalized to a bare legacy `.json` filename
   * (no `.rex/` prefix) so that callers like `toMarkdownSourcePath` can apply
   * the prefix idempotently.
   */
  private deriveOwnerFile(item: PRDItem): string {
    const md = (item as unknown as { sourceFile?: string }).sourceFile;
    if (typeof md === "string" && md.length > 0) {
      const stripped = md.startsWith(".rex/") ? md.slice(".rex/".length) : md;
      return stripped.endsWith(".md") ? stripped.slice(0, -3) + ".json" : stripped;
    }
    return this.currentBranchFile;
  }

  /**
   * Rebuild the itemToFile / fileMetadata view from a freshly-loaded merged
   * PRDDocument. After this call `ownershipLoaded` is true and subsequent
   * write routing (which now uses the folder-tree backend) has consistent metadata.
   */
  private rebuildOwnershipFromItems(doc: PRDDocument): void {
    this.itemToFile.clear();
    this.fileMetadata.clear();

    for (const entry of walkTree(doc.items)) {
      const owner = this.deriveOwnerFile(entry.item);
      this.itemToFile.set(entry.item.id, owner);
      if (!this.fileMetadata.has(owner)) {
        this.fileMetadata.set(owner, { schema: doc.schema, title: doc.title });
      }
    }

    if (this.fileMetadata.size === 0) {
      this.fileMetadata.set(this.currentBranchFile, {
        schema: doc.schema,
        title: doc.title,
      });
    }

    this.primaryFile = this.fileMetadata.has(PRD_FILENAME)
      ? PRD_FILENAME
      : [...this.fileMetadata.keys()][0] ?? PRD_FILENAME;
    this.ownershipLoaded = true;
  }

  /**
   * Mutate the PRD document and persist it to the folder-tree backend.
   *
   * Folder-tree is the sole writable surface. The `_filename` argument is
   * accepted for callsite-compat with the historical multi-file layout but
   * is no longer used to route writes — every mutation lands in `.rex/prd_tree/`.
   * Per-item attribution (`branch`, `sourceFile`) still travels with each
   * item via {@link applyWriteAttribution}.
   *
   * Title renames are handled by the cleanup step in serializeFolderTree,
   * which removes orphaned markdown files within item directories.
   */
  private async withFileTransaction<T>(
    _filename: string,
    fn: (doc: PRDDocument) => Promise<T>,
  ): Promise<T> {
    const folderTreeLockPath = this.path("tree.lock");
    return withLock(folderTreeLockPath, async () => {
      const doc = await this.loadDocument();
      const result = await fn(doc);
      const valid = validateDocument(doc);
      if (!valid.ok) {
        throw new Error(`Invalid document after mutation: ${valid.errors.message}`);
      }
      await mkdir(this.treeRoot, { recursive: true });
      await atomicWrite(
        this.path("tree-meta.json"),
        JSON.stringify({ title: doc.title }),
      );
      await serializeFolderTree(doc.items, this.treeRoot);
      this.rebuildOwnershipFromItems(doc);
      return result;
    });
  }

  private async loadDocumentFromJsonSources(): Promise<PRDDocument> {
    const branchFiles = await discoverPRDFiles(this.rexDir);

    if (branchFiles.length === 0) {
      const doc = await this.loadSingleFile(PRD_FILENAME);
      this.itemToFile.clear();
      this.fileMetadata.clear();
      this.fileMetadata.set(PRD_FILENAME, { schema: doc.schema, title: doc.title });
      for (const entry of walkTree(doc.items)) {
        this.itemToFile.set(entry.item.id, PRD_FILENAME);
      }
      this.primaryFile = PRD_FILENAME;
      this.ownershipLoaded = true;
      return doc;
    }

    const sources: Array<{ filename: string; doc: PRDDocument }> = [];

    try {
      const doc = await this.loadSingleFile(PRD_FILENAME);
      sources.push({ filename: PRD_FILENAME, doc });
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw err;
      }
    }

    for (const filename of branchFiles) {
      const doc = await this.loadSingleFile(filename);
      sources.push({ filename, doc });
    }

    if (sources.length === 0) {
      throw new Error(`Invalid ${PRD_FILENAME}: file not found`);
    }

    if (sources.length === 1) {
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

  private async directoryExists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isDirectory();
    } catch (err) {
      if (this.isMissingFileError(err)) return false;
      throw err;
    }
  }

  private async fileExists(filename: string): Promise<boolean> {
    try {
      return (await stat(this.path(filename))).isFile();
    } catch (err) {
      if (this.isMissingFileError(err)) return false;
      throw err;
    }
  }

  private async loadDocumentFromMarkdownSource(): Promise<PRDDocument> {
    const raw = await readFile(this.markdownPath, "utf-8");
    const parsed = parseDocument(raw);
    if (!parsed.ok) {
      throw new Error(`Invalid ${PRD_MARKDOWN_FILENAME}: ${parsed.error.message}`);
    }
    const result = validateDocument(parsed.data);
    if (!result.ok) {
      throw new Error(`Invalid ${PRD_MARKDOWN_FILENAME}: ${result.errors.message}`);
    }
    const doc = result.data as PRDDocument;
    this.rebuildOwnershipFromItems(doc);
    return doc;
  }

  private async loadLegacyDocument(): Promise<PRDDocument> {
    if (await this.fileExists(PRD_MARKDOWN_FILENAME)) {
      return this.loadDocumentFromMarkdownSource();
    }
    const doc = await this.loadDocumentFromJsonSources();
    const attributed = this.withMarkdownSourceAttribution(doc);
    // Do not write prd.md here — folder-tree is the sole writable PRD surface
    this.rebuildOwnershipFromItems(attributed);
    return attributed;
  }

  private withMarkdownSourceAttribution(doc: PRDDocument): PRDDocument {
    const attributeItem = (item: PRDItem): PRDItem => {
      const owner = this.itemToFile.get(item.id) ?? PRD_FILENAME;
      const attributed: PRDItem = {
        ...item,
        sourceFile: toMarkdownSourcePath(owner),
      };
      if (item.children) {
        attributed.children = item.children.map(attributeItem);
      }
      return attributed;
    };

    return {
      ...doc,
      items: doc.items.map(attributeItem),
    };
  }

  /**
   * Load and validate the consolidated PRD document.
   *
   * Reads from the folder-tree format at `.rex/prd_tree/` when present. If the tree
   * has not been created yet, falls back to legacy read-only sources
   * (`prd.md`, then `prd.json`/branch JSON files) so pre-migration projects and
   * tests can still be inspected. Mutations still persist only to `.rex/prd_tree/`.
   *
   * Document title is read from `tree-meta.json` if present; defaults to "PRD".
   */
  async loadDocument(): Promise<PRDDocument> {
    if (!(await this.directoryExists(this.treeRoot))) {
      return this.loadLegacyDocument();
    }

    // Warn if prd.md coexists with tree/ — tree is authoritative
    if (await this.fileExists(PRD_MARKDOWN_FILENAME)) {
      this.warnPrdMdIgnored();
    }

    // Read document title from tree-meta.json. Its presence also signals the
    // folder tree has been initialised — if it's there we trust the tree as
    // canonical and do not silently fall back to a legacy prd.md/prd.json.
    let title = "PRD";
    let treeMetaPresent = false;
    try {
      const raw = await readFile(this.path("tree-meta.json"), "utf-8");
      const meta = JSON.parse(raw) as Record<string, unknown>;
      if (typeof meta["title"] === "string") title = meta["title"];
      treeMetaPresent = true;
    } catch (err) {
      if (!this.isMissingFileError(err)) {
        throw err;
      }
    }

    // Parse items from the folder tree
    try {
      const { items } = await parseFolderTree(this.treeRoot);
      if (items.length === 0 && !treeMetaPresent && (await this.hasLegacySource())) {
        return this.loadLegacyDocument();
      }
      this.rebuildOwnershipFromItems({ schema: SCHEMA_VERSION, title, items });
      return { schema: SCHEMA_VERSION, title, items };
    } catch (error) {
      // Check if the tree directory is missing
      if (this.isMissingFileError(error)) {
        throw new Error(
          `No PRD found at .rex/${PRD_TREE_DIRNAME}/. ` +
            `Run 'rex migrate-to-folder-tree' to initialize the folder-tree backend.`,
        );
      }
      // Re-throw other errors (parse errors, permission errors, etc.)
      throw error;
    }
  }

  /**
   * Check if an error is a file-not-found error (ENOENT).
   */
  private isMissingFileError(err: unknown): boolean {
    return (err as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
  }

  private async hasLegacySource(): Promise<boolean> {
    if (await this.fileExists(PRD_MARKDOWN_FILENAME)) return true;
    if (await this.fileExists(PRD_FILENAME)) return true;
    const branchFiles = await discoverPRDFiles(this.rexDir);
    return branchFiles.length > 0;
  }

  private warnPrdMdIgnored(): void {
    // eslint-disable-next-line no-console
    console.warn(
      `Warning: .rex/prd.md exists alongside .rex/${PRD_TREE_DIRNAME}/ (folder-tree). ` +
      `The tree is authoritative; prd.md is ignored and will be removed in a future version. ` +
      `To remove this warning, delete: rm .rex/prd.md`,
    );
  }

  /**
   * Persist a PRD document to the folder-tree backend at `.rex/prd_tree/`.
   * No prd.md or branch-scoped files are written.
   *
   * When not already inside {@link withTransaction}, acquires the folder-tree
   * lock so concurrent writers serialize safely.
   */
  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }

    const writeFolderTree = async () => {
      await mkdir(this.treeRoot, { recursive: true });
      await atomicWrite(
        this.path("tree-meta.json"),
        JSON.stringify({ title: doc.title }),
      );
      await serializeFolderTree(doc.items, this.treeRoot);
      this.rebuildOwnershipFromItems(doc);
    };

    if (this.inTransaction) {
      await writeFolderTree();
      return;
    }

    // Use folder-tree lock path (not markdown lock)
    const folderTreeLockPath = this.path("tree.lock");
    await withLock(folderTreeLockPath, writeFolderTree);
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    const folderTreeLockPath = this.path("tree.lock");
    return withLock(folderTreeLockPath, async () => {
      this.inTransaction = true;
      try {
        const doc = await this.loadDocument();
        const result = await fn(doc);
        const valid = validateDocument(doc);
        if (!valid.ok) {
          throw new Error(`Invalid document after mutation: ${valid.errors.message}`);
        }
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

  async addItem(item: PRDItem, parentId?: string, options?: WriteOptions): Promise<void> {
    // Self-heal tagging runs on creation only so that self-heal runs never
    // rewrite tags on previously-authored items (see updateItem).
    const tagged = withSelfHealTag(item);

    if (parentId) {
      let owner: string;
      try {
        owner = await this.resolveOwnerFile(parentId);
      } catch {
        throw new Error(`Parent "${parentId}" not found`);
      }
      const attributedItem = this.applyWriteAttribution(tagged, owner, options);
      await this.withFileTransaction(owner, async (doc) => {
        if (!insertChild(doc.items, parentId, attributedItem)) {
          throw new Error(`Parent "${parentId}" not found`);
        }
      });
      this.itemToFile.set(attributedItem.id, owner);
      this.ownershipLoaded = true;
      return;
    }

    const attributedItem = this.applyWriteAttribution(tagged, this.currentBranchFile, options);
    await this.withFileTransaction(this.currentBranchFile, async (doc) => {
      doc.items.push(attributedItem);
    });
    this.itemToFile.set(attributedItem.id, this.currentBranchFile);
    this.ownershipLoaded = true;
  }

  async updateItem(id: string, updates: Partial<PRDItem>, options?: WriteOptions): Promise<void> {
    const owner = await this.resolveOwnerFile(id);
    const attributedUpdates = this.applyWriteAttribution(updates, owner, options);
    await this.withFileTransaction(owner, async (doc) => {
      if (!updateInTree(doc.items, id, attributedUpdates)) {
        throw new Error(`Item "${id}" not found`);
      }
    });
  }

  async removeItem(id: string): Promise<void> {
    const owner = await this.resolveOwnerFile(id);
    await this.withFileTransaction(owner, async (doc) => {
      const removed = removeFromTree(doc.items, id);
      if (!removed) {
        throw new Error(`Item "${id}" not found`);
      }
    });
    this.itemToFile.delete(id);
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
