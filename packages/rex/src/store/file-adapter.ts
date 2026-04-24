import { readFile, writeFile, appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, walkTree, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import { atomicWrite, atomicWriteJSON } from "./atomic-write.js";
import { withLock } from "./file-lock.js";
import { discoverPRDFiles } from "./prd-discovery.js";
import {
  PRD_MARKDOWN_FILENAME,
} from "./prd-md-migration.js";
import { parseDocument } from "./markdown-parser.js";
import { serializeDocument } from "./markdown-serializer.js";
import { resolveGitBranch } from "./branch-naming.js";
import { withSelfHealTag } from "./self-heal-tag.js";
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

  private lockPathForFile(filename: string): string {
    return this.path(`${filename}.lock`);
  }

  private toAttributedSourceFile(filename: string): string {
    const markdownName = filename === PRD_FILENAME
      ? PRD_MARKDOWN_FILENAME
      : filename.replace(/\.json$/i, ".md");
    return `.rex/${markdownName}`;
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
    await this.loadDocumentFromJsonSources();
  }

  private async resolveOwnerFile(itemId: string): Promise<string> {
    await this.ensureOwnershipMap();
    const file = this.itemToFile.get(itemId);
    if (!file) {
      throw new Error(`Item "${itemId}" not found in any PRD file`);
    }
    return file;
  }

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
      const snapshot = await this.loadDocumentFromJsonSources();
      await this.saveMarkdownDocument(snapshot);
      return result;
    });
  }

  private async withNestedLocks<T>(
    filenames: string[],
    fn: () => Promise<T>,
  ): Promise<T> {
    if (filenames.length === 0) return fn();
    const [next, ...rest] = filenames;
    return withLock(this.lockPathForFile(next), () => this.withNestedLocks(rest, fn));
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

  /**
   * Load and validate the consolidated PRD document.
   *
   * `prd.md` is the primary read surface when present. If only `prd.json`
   * exists, the first read migrates it to markdown and subsequent reads use
   * the markdown file.
   *
   * @throws If the backing files are missing, invalid, or fail validation.
   */
  async loadDocument(): Promise<PRDDocument> {
    try {
      const markdown = await readFile(this.markdownPath, "utf-8");
      const parsed = parseDocument(markdown);
      if (!parsed.ok) {
        throw new Error(`Invalid ${PRD_MARKDOWN_FILENAME}: ${parsed.error.message}`);
      }
      return parsed.data;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") {
        throw error;
      }
    }

    const doc = await this.loadDocumentFromJsonSources();
    await this.saveMarkdownDocument(doc);
    return doc;
  }

  private async saveMarkdownDocument(doc: PRDDocument): Promise<void> {
    await atomicWrite(this.markdownPath, serializeDocument(doc));
  }

  /**
   * Persist a PRD document to the canonical `prd.json` file.
   *
   * When not inside a {@link withTransaction}, acquires a per-file lock
   * so concurrent writers serialize safely.
   */
  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }

    if (!this.ownershipLoaded) {
      if (this.inTransaction) {
        await atomicWriteJSON(this.prdPath, doc, toCanonicalJSON);
        await this.saveMarkdownDocument(doc);
        return;
      }

      await withLock(this.prdLockPath, async () => {
        await atomicWriteJSON(this.prdPath, doc, toCanonicalJSON);
        await this.saveMarkdownDocument(doc);
      });
      return;
    }

    const fileItems = new Map<string, PRDItem[]>();
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
        const meta =
          filename === this.primaryFile
            ? { schema: doc.schema, title: doc.title }
            : this.fileMetadata.get(filename) ?? { schema: doc.schema, title: doc.title };
        await atomicWriteJSON(
          this.path(filename),
          { schema: meta.schema, title: meta.title, items },
          toCanonicalJSON,
        );
      }
    };

    if (this.inTransaction) {
      await writeAll();
      await this.saveMarkdownDocument(doc);
      return;
    }

    await this.withNestedLocks(filenames, async () => {
      await writeAll();
      await this.saveMarkdownDocument(doc);
    });
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    await this.ensureOwnershipMap();
    const filenames =
      this.fileMetadata.size > 0 ? [...this.fileMetadata.keys()].sort() : [PRD_FILENAME];

    return this.withNestedLocks(filenames, async () => {
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
