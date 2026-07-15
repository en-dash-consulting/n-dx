/**
 * Jira Cloud adapter for the PRDStore interface.
 *
 * Reads/writes PRD data through the Jira REST API, using the mapping utilities
 * from `store/jira-map.ts`. Each PRD item is a Jira issue; the PRD hierarchy and
 * metadata are encoded in the issue description (Jira has no cross-instance
 * external reference and its native hierarchy is issue-type-specific).
 *
 * A local `.rex/` directory is still required for config, logs, and workflow
 * (those are file-local concerns). The PRD document itself lives in Jira.
 *
 * Structurally this mirrors `github-projects-adapter.ts` / `asana-adapter.ts`.
 */

import { readFile, writeFile, appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../schema/index.js";
import { validateDocument, validateConfig, validateLogEntry } from "../schema/validate.js";
import { toCanonicalJSON } from "../core/canonical.js";
import { findItem, walkTree } from "../core/tree.js";
import { stampModified } from "../core/sync.js";
import {
  mapIssuesToDocument,
  mapItemToCreate,
  mapItemToUpdate,
  parseMeta,
} from "./jira-map.js";
import { loadProjectOverrides, mergeWithOverrides } from "./project-config.js";
import type { PRDStore, StoreCapabilities, WriteOptions } from "./contracts.js";
import type { JiraClient, JiraAdapterConfig } from "./jira-client.js";

const DEFAULT_ISSUE_TYPE = "Task";

export class JiraStore implements PRDStore {
  private rexDir: string;
  private client: JiraClient;
  private projectKey: string;
  private issueType: string;
  private syncLabels: boolean;

  constructor(rexDir: string, client: JiraClient, config: JiraAdapterConfig) {
    this.rexDir = rexDir;
    this.client = client;
    this.projectKey = config.projectKey;
    this.issueType = config.issueType || DEFAULT_ISSUE_TYPE;
    // Label sync defaults on (matches the integration schema default).
    this.syncLabels = config.syncLabels !== false;
  }

  private path(file: string): string {
    return join(this.rexDir, file);
  }

  // -------------------------------------------------------------------------
  // Document operations — backed by Jira
  // -------------------------------------------------------------------------

  async loadDocument(): Promise<PRDDocument> {
    const issues = await this.client.listIssues(this.projectKey);
    const config = await this.loadConfig();
    const doc = mapIssuesToDocument(issues, config.project);

    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document from Jira: ${result.errors.message}`);
    }
    return result.data as PRDDocument;
  }

  async saveDocument(doc: PRDDocument): Promise<void> {
    const result = validateDocument(doc);
    if (!result.ok) {
      throw new Error(`Invalid document: ${result.errors.message}`);
    }

    // Persist document title to config (Jira stores issues, not the wrapper).
    const config = await this.loadConfig();
    if (config.project !== doc.title) {
      config.project = doc.title;
      await this.saveConfig(config);
    }

    const remoteIdMap = await this.buildIdMap();

    // Walk the tree; hierarchy is encoded in each issue's description via
    // parentId (a PRD id), so no remote-id resolution is needed for parenting.
    for (const { item, parents } of walkTree(doc.items)) {
      const parentItem = parents.length > 0 ? parents[parents.length - 1] : undefined;

      const existingKey = remoteIdMap.get(item.id);
      if (existingKey) {
        await this.client.updateIssue(
          existingKey,
          mapItemToUpdate(item, this.syncLabels, parentItem?.id),
        );
      } else {
        const created = await this.client.createIssue(
          mapItemToCreate(item, this.projectKey, this.issueType, this.syncLabels, parentItem?.id),
        );
        remoteIdMap.set(item.id, created.key);
      }
    }

    // Delete issues that no longer exist in the document.
    const currentIds = new Set<string>();
    for (const { item } of walkTree(doc.items)) {
      currentIds.add(item.id);
    }
    for (const [prdId, key] of remoteIdMap) {
      if (!currentIds.has(prdId)) {
        await this.client.deleteIssue(key);
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
    await this.client.createIssue(
      mapItemToCreate(stamped, this.projectKey, this.issueType, this.syncLabels, parentId),
    );
  }

  async updateItem(id: string, updates: Partial<PRDItem>, _options?: WriteOptions): Promise<void> {
    const key = await this.resolveKey(id);
    if (!key) {
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
    await this.client.updateIssue(key, mapItemToUpdate(stamped, this.syncLabels, parentItem?.id));
  }

  async removeItem(id: string): Promise<void> {
    const key = await this.resolveKey(id);
    if (!key) {
      throw new Error(`Item "${id}" not found`);
    }
    await this.client.deleteIssue(key);
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
      adapter: "jira",
      supportsTransactions: false,
      supportsWatch: false,
    };
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /** Build a map of PRD item ID → Jira issue key from the project. */
  private async buildIdMap(): Promise<Map<string, string>> {
    const issues = await this.client.listIssues(this.projectKey);
    const map = new Map<string, string>();
    for (const issue of issues) {
      const meta = parseMeta(issue.description);
      const prdId = meta.prdId ?? issue.key;
      map.set(prdId, issue.key);
    }
    return map;
  }

  /** Resolve a PRD item ID to its Jira issue key. */
  private async resolveKey(prdId: string): Promise<string | null> {
    const map = await this.buildIdMap();
    return map.get(prdId) ?? null;
  }
}

export async function ensureJiraRexDir(rexDir: string): Promise<void> {
  await mkdir(rexDir, { recursive: true });
}
