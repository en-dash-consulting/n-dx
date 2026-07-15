/**
 * GitHub Projects (v2) adapter for the PRDStore interface.
 *
 * Reads/writes PRD data through the GitHub Projects GraphQL API, using the
 * mapping utilities from `store/github-projects-map.ts`. Each PRD item is a
 * draft issue in the project; the PRD hierarchy and metadata are encoded in the
 * draft-issue body (GitHub Projects v2 has no native parent/child or external
 * reference).
 *
 * A local `.rex/` directory is still required for config, logs, and workflow
 * (those are file-local concerns). The PRD document itself lives in GitHub.
 *
 * Structurally this mirrors `asana-adapter.ts` / `notion-adapter.ts` — the
 * file-backed config/log/workflow methods are intentionally identical.
 */

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, walkTree } from "../core/tree.js";
import { stampModified } from "../core/sync.js";
import {
  mapItemsToDocument,
  mapItemToDraft,
  parseMeta,
} from "./github-projects-map.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";
import type {
  GitHubProjectsClient,
  GitHubProjectsAdapterConfig,
} from "./github-projects-client.js";

/** Location of a PRD item in the project: its item id and draft-issue id. */
interface ItemRef {
  itemId: string;
  contentId: string;
}

export class GitHubProjectsStore implements PRDStore {
  private rexDir: string;
  private client: GitHubProjectsClient;
  private projectId: string;

  constructor(
    rexDir: string,
    client: GitHubProjectsClient,
    config: GitHubProjectsAdapterConfig,
  ) {
    this.rexDir = rexDir;
    this.client = client;
    this.projectId = config.projectId;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // -------------------------------------------------------------------------
  // Document operations — backed by GitHub Projects
  // -------------------------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
    const items = await this.client.listItems(this.projectId);
    const config = await this.loadConfig();
    const doc = mapItemsToDocument(items, config.project);

    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document from GitHub Projects: ${result.errors.message}`);
    }
    return result.data as PRDDocument;
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }

    // Persist document title to config (GitHub stores items, not the wrapper).
    const config = await this.loadConfig();
    if (config.project !== doc.title) {
      config.project = doc.title;
      await this.saveConfig(config);
    }

    const remoteIdMap = await this.buildIdMap();

    // Walk the tree; hierarchy is encoded in each item's body via parentId
    // (a PRD id), so no remote-id resolution is needed for parenting.
    for (const { item, parents } of walkTree(doc.items)) {
      const parentItem = parents.length > 0 ? parents[parents.length - 1] : undefined;
      const draft = mapItemToDraft(item, parentItem?.id);

      const existing = remoteIdMap.get(item.id);
      if (existing) {
        await this.client.updateDraftItem(existing.contentId, draft);
      } else {
        const created = await this.client.createDraftItem(this.projectId, draft);
        remoteIdMap.set(item.id, { itemId: created.itemId, contentId: created.contentId });
      }
    }

    // Delete items that no longer exist in the document.
    const currentIds = new Set<string>();
    for (const { item } of walkTree(doc.items)) {
      currentIds.add(item.id);
    }
    for (const [prdId, ref] of remoteIdMap) {
      if (!currentIds.has(prdId)) {
        await this.client.deleteItem(this.projectId, ref.itemId);
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

    const stamped = stampModified(item);
    await this.client.createDraftItem(this.projectId, mapItemToDraft(stamped, parentId));
  }

  async updateItem(id: string, updates: Partial<PRDItem>, _options?: WriteOptions): Promise<void> {
    const ref = await this.resolveRef(id);
    if (!ref) {
      throw new Error(`Item "${id}" not found`);
    }

    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    if (!entry) {
      throw new Error(`Item "${id}" not found`);
    }

    const parentItem = entry.parents.length > 0 ? entry.parents[entry.parents.length - 1] : undefined;
    const merged = { ...entry.item, ...updates } as PRDItem;
    const stamped = stampModified(merged);
    await this.client.updateDraftItem(ref.contentId, mapItemToDraft(stamped, parentItem?.id));
  }

  async removeItem(id: string): Promise<void> {
    const ref = await this.resolveRef(id);
    if (!ref) {
      throw new Error(`Item "${id}" not found`);
    }
    await this.client.deleteItem(this.projectId, ref.itemId);
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
      adapter: "github",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Build a map of PRD item ID → {itemId, contentId} from the project. */
  private async buildIdMap(): Promise<Map<string, ItemRef>> {
    const items = await this.client.listItems(this.projectId);
    const map = new Map<string, ItemRef>();
    for (const pi of items) {
      const meta = parseMeta(pi.body);
      const prdId = meta.prdId ?? pi.contentId;
      map.set(prdId, { itemId: pi.itemId, contentId: pi.contentId });
    }
    return map;
  }

  /** Resolve a PRD item ID to its project item / draft-issue references. */
  private async resolveRef(prdId: string): Promise<ItemRef | null> {
    const map = await this.buildIdMap();
    return map.get(prdId) ?? null;
  }
}

export async function ensureGitHubProjectsRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}
