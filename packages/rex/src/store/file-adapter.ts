import { readFile, writeFile, appendFile, mkdir, rename, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import { atomicWriteJSON } from "./atomic-write.js";
import { withLock } from "./file-lock.js";
import type { PRDStore, StoreCapabilities } from "./contracts.js";

export class FileStore implements PRDStore {
  private rexDir: string;
  /** True while inside withTransaction — prevents double-locking in saveDocument. */
  private inTransaction = false;

  constructor(rexDir: string) {
    this.rexDir = rexDir;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  private lockPath(): string {
    return this.path("prd.json.lock");
  }

  async loadDocument(): Promise<PRDDocument> {
    const raw = await readFile(this.path("prd.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateDocument(parsed);
    if (!result.ok) {
      throw new Error(`Invalid prd.json: ${result.errors.message}`);
    }
    return result.data as PRDDocument;
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }
    // When called outside a transaction, acquire the lock for the write.
    // Inside a transaction, the lock is already held.
    if (this.inTransaction) {
      await atomicWriteJSON(this.path("prd.json"), doc, toCanonicalJSON);
    } else {
      await withLock(this.lockPath(), async () => {
        await atomicWriteJSON(this.path("prd.json"), doc, toCanonicalJSON);
      });
    }
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    return withLock(this.lockPath(), async () => {
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
    await this.withTransaction(async (doc) => {
      if (parentId) {
        const inserted = insertChild(doc.items, parentId, item);
        if (!inserted) {
          throw new Error(`Parent "${parentId}" not found`);
        }
      } else {
        doc.items.push(item);
      }
    });
  }

  async updateItem(id: string, updates: Partial<PRDItem>): Promise<void> {
    await this.withTransaction(async (doc) => {
      const updated = updateInTree(doc.items, id, updates);
      if (!updated) {
        throw new Error(`Item "${id}" not found`);
      }
    });
  }

  async removeItem(id: string): Promise<void> {
    await this.withTransaction(async (doc) => {
      const removed = removeFromTree(doc.items, id);
      if (!removed) {
        throw new Error(`Item "${id}" not found`);
      }
    });
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
