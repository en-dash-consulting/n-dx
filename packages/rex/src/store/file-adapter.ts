import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/index.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, insertChild, updateInTree, removeFromTree } from "../core/tree.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { PRDStore, StoreCapabilities } from "./types.js";

export class FileStore implements PRDStore {
  private rexDir: string;

  constructor(rexDir: string) {
    this.rexDir = rexDir;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
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
    await writeFile(this.path("prd.json"), toCanonicalJSON(doc), "utf-8");
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    const doc = await this.loadDocument();
    if (parentId) {
      const inserted = insertChild(doc.items, parentId, item);
      if (!inserted) {
        throw new Error(`Parent "${parentId}" not found`);
      }
    } else {
      doc.items.push(item);
    }
    await this.saveDocument(doc);
  }

  async updateItem(id: string, updates: Partial<PRDItem>): Promise<void> {
    const doc = await this.loadDocument();
    const updated = updateInTree(doc.items, id, updates);
    if (!updated) {
      throw new Error(`Item "${id}" not found`);
    }
    await this.saveDocument(doc);
  }

  async removeItem(id: string): Promise<void> {
    const doc = await this.loadDocument();
    const removed = removeFromTree(doc.items, id);
    if (!removed) {
      throw new Error(`Item "${id}" not found`);
    }
    await this.saveDocument(doc);
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
    await appendFile(
      this.path("execution-log.jsonl"),
      JSON.stringify(entry) + "\n",
      "utf-8",
    );
  }

  async readLog(limit?: number): Promise<LogEntry[]> {
    let raw: string;
    try {
      raw = await readFile(this.path("execution-log.jsonl"), "utf-8");
    } catch {
      return [];
    }
    const lines = raw.trim().split("\n").filter(Boolean);
    const entries = lines.map((line) => JSON.parse(line) as LogEntry);
    if (limit !== undefined && limit > 0) {
      return entries.slice(-limit);
    }
    return entries;
  }

  async loadWorkflow(): Promise<string> {
    return readFile(this.path("workflow.md"), "utf-8");
  }

  async saveWorkflow(content: string): Promise<void> {
    await writeFile(this.path("workflow.md"), content, "utf-8");
  }

  capabilities(): StoreCapabilities {
    return {
      adapter: "file",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }
}

export async function ensureRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}
