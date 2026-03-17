/**
 * Notion database adapter for the PRDStore interface.
 *
 * Reads/writes PRD data through the Notion API, using the mapping utilities
 * from `store/notion-map.ts` for bidirectional conversion and `core/sync.ts`
 * for conflict resolution.
 *
 * A local `.rex/` directory is still required for config, logs, and workflow
 * (those are file-local concerns). The PRD document itself lives in Notion.
 */

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, insertChild, updateInTree, removeFromTree, walkTree } from "../core/tree.js";
import {
  mapItemToNotion,
  mapNotionToItem,
  mapNotionToDocument,
  resolveParentPage,
  buildStatusGroupMap,
  validateDatabaseSchema,
} from "./notion-map.js";
import type { NotionStatusGroup } from "./notion-map.js";
import {
  stampModified,
  stampSynced,
  extractSyncMeta,
} from "../core/sync.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { PRDStore, StoreCapabilities } from "./contracts.js";
import type { NotionClient, NotionAdapterConfig } from "./notion-client.js";

/* eslint-disable @typescript-eslint/no-explicit-any */

export class NotionStore implements PRDStore {
  private rexDir: string;
  private client: NotionClient;
  private databaseId: string;

  /** Cache invalidated on every write. */
  private cachedStatusGroupMap: Map<string, NotionStatusGroup> | null = null;

  constructor(rexDir: string, client: NotionClient, config: NotionAdapterConfig) {
    this.rexDir = rexDir;
    this.client = client;
    this.databaseId = config.databaseId;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // -------------------------------------------------------------------------
  // Status group map (cached per session, refreshed after writes)
  // -------------------------------------------------------------------------

  private async getStatusGroupMap(): Promise<Map<string, NotionStatusGroup>> {
    if (this.cachedStatusGroupMap) return this.cachedStatusGroupMap;
    const db = await this.client.getDatabase(this.databaseId);
    this.cachedStatusGroupMap = buildStatusGroupMap(db.properties ?? {});
    return this.cachedStatusGroupMap;
  }

  private invalidateCache(): void {
    this.cachedStatusGroupMap = null;
  }

  // -------------------------------------------------------------------------
  // Document operations — backed by Notion
  // -------------------------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
    const statusGroupMap = await this.getStatusGroupMap();
    const pages = await this.client.queryDatabase(this.databaseId);

    // Enrich pages with block children for description / acceptance criteria
    const enrichedPages = await Promise.all(
      pages.map(async (page: any) => {
        const children = await this.client.getBlockChildren(page.id);
        return { ...page, children };
      }),
    );

    // Get project title from config (we need it for the document)
    const config = await this.loadConfig();
    const doc = mapNotionToDocument(enrichedPages, config.project, statusGroupMap);

    // Validate the reconstructed document
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document from Notion: ${result.errors.message}`);
    }

    return result.data as PRDDocument;
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }
    this.invalidateCache();

    // Persist document title to config (Notion stores items, not the doc wrapper)
    const config = await this.loadConfig();
    if (config.project !== doc.title) {
      config.project = doc.title;
      await this.saveConfig(config);
    }

    // Build the ID map of existing items (PRD ID → Notion page ID)
    const existingPages = await this.client.queryDatabase(this.databaseId);
    const remoteIdMap = new Map<string, string>();
    for (const page of existingPages) {
      const prdId =
        page.properties?.["PRD ID"]?.rich_text?.[0]?.plain_text ??
        page.properties?.["PRD ID"]?.rich_text?.[0]?.text?.content;
      if (prdId) {
        remoteIdMap.set(prdId, page.id);
      }
    }

    // Walk the tree in DFS order (parents before children)
    const idMap = new Map<string, string>(remoteIdMap);
    for (const { item, parents } of walkTree(doc.items)) {
      const { properties, children } = mapItemToNotion(item);
      const parentItem = parents.length > 0 ? parents[parents.length - 1] : undefined;
      const parentPrdId = parentItem?.id;

      const parent = resolveParentPage(item, this.databaseId, idMap, parentPrdId);

      const existingNotionId = remoteIdMap.get(item.id);
      if (existingNotionId) {
        // Update existing page
        await this.client.updatePage(existingNotionId, properties);
      } else {
        // Create new page
        const created = await this.client.createPage({
          parent,
          properties,
          children,
        });
        // Record the new Notion page ID for child resolution
        idMap.set(item.id, created.id);
      }
    }

    // Archive pages that no longer exist in the document
    const currentIds = new Set<string>();
    for (const { item } of walkTree(doc.items)) {
      currentIds.add(item.id);
    }
    for (const [prdId, notionId] of remoteIdMap) {
      if (!currentIds.has(prdId)) {
        await this.client.archivePage(notionId);
      }
    }
  }

  async getItem(id: string): Promise<PRDItem | null> {
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    return entry ? (entry.item as PRDItem) : null;
  }

  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    const idMap = await this.buildIdMap();

    // Validate that the parent exists when parentId is provided
    if (parentId && !idMap.has(parentId)) {
      throw new Error(`Parent "${parentId}" not found`);
    }

    const parent = resolveParentPage(item, this.databaseId, idMap, parentId);
    const stamped = stampModified(item);
    const { properties, children } = mapItemToNotion(stamped);

    await this.client.createPage({
      parent,
      properties,
      children,
    });
    this.invalidateCache();
  }

  async updateItem(id: string, updates: Partial<PRDItem>): Promise<void> {
    const notionId = await this.resolveNotionId(id);
    if (!notionId) {
      throw new Error(`Item "${id}" not found`);
    }

    // Load the current item, apply updates, and remap
    const doc = await this.loadDocument();
    const entry = findItem(doc.items, id);
    if (!entry) {
      throw new Error(`Item "${id}" not found`);
    }

    const merged = { ...entry.item, ...updates } as PRDItem;
    const stamped = stampModified(merged);
    const { properties } = mapItemToNotion(stamped);

    await this.client.updatePage(notionId, properties);
    this.invalidateCache();
  }

  async removeItem(id: string): Promise<void> {
    const notionId = await this.resolveNotionId(id);
    if (!notionId) {
      throw new Error(`Item "${id}" not found`);
    }
    await this.client.archivePage(notionId);
    this.invalidateCache();
  }

  // -------------------------------------------------------------------------
  // Config / Log / Workflow — file-backed (same as FileStore)
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
    return readFile(this.path("workflow.md"), "utf-8");
  }

  async saveWorkflow(content: string): Promise<void> {
    await writeFile(this.path("workflow.md"), content, "utf-8");
  }

  capabilities(): StoreCapabilities {
    return {
      adapter: "notion",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Build a map of PRD item ID → Notion page ID from the database. */
  private async buildIdMap(): Promise<Map<string, string>> {
    const pages = await this.client.queryDatabase(this.databaseId);
    const map = new Map<string, string>();
    for (const page of pages) {
      const prdId =
        page.properties?.["PRD ID"]?.rich_text?.[0]?.plain_text ??
        page.properties?.["PRD ID"]?.rich_text?.[0]?.text?.content;
      if (prdId) {
        map.set(prdId, page.id);
      }
    }
    return map;
  }

  /** Resolve a PRD item ID to its Notion page ID. */
  private async resolveNotionId(prdId: string): Promise<string | null> {
    const map = await this.buildIdMap();
    return map.get(prdId) ?? null;
  }
}

export async function ensureNotionRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
