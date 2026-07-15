/**
 * Asana project adapter for the PRDStore interface.
 *
 * Reads/writes PRD data through the Asana API, using the mapping utilities
 * from `store/asana-map.ts` for bidirectional conversion. The PRD hierarchy
 * maps onto Asana tasks and subtasks; each task's native `external` field
 * carries the PRD item ID plus level/status/priority metadata.
 *
 * A local `.rex/` directory is still required for config, logs, and workflow
 * (those are file-local concerns). The PRD document itself lives in Asana.
 *
 * Structurally this mirrors `notion-adapter.ts` — the file-backed config/log/
 * workflow methods are intentionally identical to FileStore/NotionStore.
 */

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, walkTree } from "../core/tree.js";
import { stampModified } from "../core/sync.js";
import {
  mapAsanaToDocument,
  mapItemToCreate,
  mapItemToUpdate,
  parseExternal,
} from "./asana-map.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";
import type { AsanaClient, AsanaAdapterConfig } from "./asana-client.js";

export class AsanaStore implements PRDStore {
  private rexDir: string;
  private client: AsanaClient;
  private projectId: string;

  constructor(rexDir: string, client: AsanaClient, config: AsanaAdapterConfig) {
    this.rexDir = rexDir;
    this.client = client;
    this.projectId = config.projectId;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // -------------------------------------------------------------------------
  // Document operations — backed by Asana
  // -------------------------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
    const tasks = await this.client.listTasks(this.projectId);
    const config = await this.loadConfig();
    const doc = mapAsanaToDocument(tasks, config.project);

    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document from Asana: ${result.errors.message}`);
    }
    return result.data as PRDDocument;
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }

    // Persist document title to config (Asana stores tasks, not the doc wrapper).
    const config = await this.loadConfig();
    if (config.project !== doc.title) {
      config.project = doc.title;
      await this.saveConfig(config);
    }

    // Map existing PRD IDs → Asana task GIDs.
    const remoteIdMap = await this.buildIdMap();

    // Walk the tree in DFS order (parents before children) so a parent's GID is
    // known before its children resolve their `parent` reference.
    const idMap = new Map<string, string>(remoteIdMap);
    for (const { item, parents } of walkTree(doc.items)) {
      const parentItem = parents.length > 0 ? parents[parents.length - 1] : undefined;
      const parentGid = parentItem ? idMap.get(parentItem.id) : undefined;

      const existingGid = remoteIdMap.get(item.id);
      if (existingGid) {
        await this.client.updateTask(existingGid, mapItemToUpdate(item));
      } else {
        const created = await this.client.createTask(
          mapItemToCreate(item, this.projectId, parentGid),
        );
        idMap.set(item.id, created.gid);
      }
    }

    // Delete tasks that no longer exist in the document.
    const currentIds = new Set<string>();
    for (const { item } of walkTree(doc.items)) {
      currentIds.add(item.id);
    }
    for (const [prdId, gid] of remoteIdMap) {
      if (!currentIds.has(prdId)) {
        await this.client.deleteTask(gid);
      }
    }
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string, _options?: WriteOptions): Promise<void> {
    const idMap = await this.buildIdMap();

    if (parentId && !idMap.has(parentId)) {
      throw new Error(`Parent "${parentId}" not found`);
    }

    const parentGid = parentId ? idMap.get(parentId) : undefined;
    const stamped = stampModified(item);
    await this.client.createTask(
      mapItemToCreate(stamped, this.projectId, parentGid),
    );
  }

  async updateItem(id: string, updates: Partial<PRDItem>, _options?: WriteOptions): Promise<void> {
    const gid = await this.resolveAsanaGid(id);
    if (!gid) {
      throw new Error(`Item "${id}" not found`);
    }

    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    if (!entry) {
      throw new Error(`Item "${id}" not found`);
    }

    const merged = { ...entry.item, ...updates } as PRDItem;
    const stamped = stampModified(merged);
    await this.client.updateTask(gid, mapItemToUpdate(stamped));
  }

  async removeItem(id: string): Promise<void> {
    const gid = await this.resolveAsanaGid(id);
    if (!gid) {
      throw new Error(`Item "${id}" not found`);
    }
    await this.client.deleteTask(gid);
  }

  // -------------------------------------------------------------------------
  // Config / Log / Workflow — file-backed (same as FileStore / NotionStore)
  // -------------------------------------------------------------------------

  async loadConfig(): Promise<RexConfig> {
    const raw = await readFile(this.path("config.json"), "utf-8");
    const parsed = JSON.parse(raw);
    const result = validateConfig(parsed);
    if (!result.ok) {
      throw new Error(`Invalid config.json: ${result.errors.message}`);
    }
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
    let base = "";
    try {
      base = await readFile(this.path("n-dx_workflow.md"), "utf-8");
    } catch { /* no base workflow */ }

    let userRaw = "";
    try {
      userRaw = await readFile(this.path("workflow.md"), "utf-8");
    } catch { /* no user workflow */ }

    if (!base) return userRaw || "";

    const user = userRaw.replace(/<!--[\s\S]*?-->/g, "").trim();
    if (user) return `${base}\n\n## Project-Specific Rules\n\n${user}`;
    return base;
  }

  async saveWorkflow(content: string): Promise<void> {
    await writeFile(this.path("workflow.md"), content, "utf-8");
  }

  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    const doc = await this.loadDocument();
    const result = await fn(doc);
    await this.saveDocument(doc);
    return result;
  }

  capabilities(): StoreCapabilities {
    return {
      adapter: "asana",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Build a map of PRD item ID → Asana task GID from the project's tasks. */
  private async buildIdMap(): Promise<Map<string, string>> {
    const tasks = await this.client.listTasks(this.projectId);
    const map = new Map<string, string>();
    for (const task of tasks) {
      const { prdId } = parseExternal(task);
      map.set(prdId, task.gid);
    }
    return map;
  }

  /** Resolve a PRD item ID to its Asana task GID. */
  private async resolveAsanaGid(prdId: string): Promise<string | null> {
    const map = await this.buildIdMap();
    return map.get(prdId) ?? null;
  }
}

export async function ensureAsanaRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}
