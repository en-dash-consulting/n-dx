/**
 * Integration test: FolderTreeStore + SyncEngine.
 *
 * Before this fix, FolderTreeStore never stamped `lastModified` on local
 * writes, so `isModifiedSinceSync()` (packages/rex/src/core/sync.ts) always
 * returned false for folder-tree-backed items — locally edited items were
 * silently skipped on push. This test drives a real FolderTreeStore (disk
 * backed, not a mock) through `updateItem` and proves the change is detected
 * and pushed by `SyncEngine`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore, ensureFolderTreeRexDir } from "../../src/store/folder-tree-store.js";
import { SyncEngine } from "../../src/core/sync-engine.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import type { PRDStore, StoreCapabilities } from "../../src/store/contracts.js";
import type { PRDDocument, PRDItem, RexConfig, LogEntry } from "../../src/schema/index.js";

/**
 * Minimal in-memory "remote" store — stands in for a real remote adapter
 * (Notion/Jira/etc). Only the surface SyncEngine touches is implemented.
 */
class MemoryRemoteStore implements PRDStore {
  doc: PRDDocument = { schema: SCHEMA_VERSION, title: "remote", items: [] };

  async loadDocument(): Promise<PRDDocument> {
    return structuredCloneJSON(this.doc);
  }
  async saveDocument(doc: PRDDocument): Promise<void> {
    this.doc = structuredCloneJSON(doc);
  }
  async getItem(id: string): Promise<PRDItem | null> {
    return findInTree(this.doc.items, id);
  }
  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    const clone = structuredCloneJSON(item);
    if (parentId) {
      const parent = findInTree(this.doc.items, parentId);
      if (!parent) throw new Error(`Parent "${parentId}" not found`);
      parent.children = [...(parent.children ?? []), clone];
    } else {
      this.doc.items.push(clone);
    }
  }
  async updateItem(id: string, updates: Partial<PRDItem>): Promise<void> {
    const item = findInTree(this.doc.items, id);
    if (!item) throw new Error(`Item "${id}" not found`);
    Object.assign(item, updates);
  }
  async removeItem(id: string): Promise<void> {
    removeFromTree(this.doc.items, id);
  }
  async loadConfig(): Promise<RexConfig> {
    return { schema: SCHEMA_VERSION, project: "remote", adapter: "memory" };
  }
  async saveConfig(): Promise<void> {}
  async appendLog(): Promise<void> {}
  async readLog(): Promise<LogEntry[]> {
    return [];
  }
  async loadWorkflow(): Promise<string> {
    return "";
  }
  async saveWorkflow(): Promise<void> {}
  async withTransaction<T>(fn: (doc: PRDDocument) => Promise<T>): Promise<T> {
    const doc = await this.loadDocument();
    const result = await fn(doc);
    await this.saveDocument(doc);
    return result;
  }
  capabilities(): StoreCapabilities {
    return { adapter: "memory", supportsTransactions: false, supportsWatch: false };
  }
}

function findInTree(items: PRDItem[], id: string): PRDItem | null {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.children) {
      const found = findInTree(item.children, id);
      if (found) return found;
    }
  }
  return null;
}

function removeFromTree(items: PRDItem[], id: string): boolean {
  for (let i = 0; i < items.length; i++) {
    if (items[i].id === id) {
      items.splice(i, 1);
      return true;
    }
    if (items[i].children && removeFromTree(items[i].children!, id)) {
      return true;
    }
  }
  return false;
}

function structuredCloneJSON<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

describe("FolderTreeStore + SyncEngine: local edits are detected and pushed", () => {
  let tmpDir: string;
  let rexDir: string;
  let local: FolderTreeStore;
  let remote: MemoryRemoteStore;
  let engine: SyncEngine;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-ft-sync-"));
    rexDir = join(tmpDir, ".rex");
    await ensureFolderTreeRexDir(rexDir);

    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "sync-test", adapter: "folder-tree" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    local = new FolderTreeStore(rexDir);
    remote = new MemoryRemoteStore();
    engine = new SyncEngine(local, remote);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("pushes a locally updated item after an initial sync established lastSyncedAt", async () => {
    await local.addItem({
      id: "sync-task",
      title: "Original title",
      status: "pending",
      level: "task",
    });

    // First sync: establishes lastSyncedAt on both sides and no further
    // local edits have happened yet.
    const firstReport = await engine.push();
    expect(firstReport.pushed).toContain("sync-task");

    const afterFirstSync = await local.getItem("sync-task");
    expect(afterFirstSync!.lastSyncedAt).toBeDefined();

    // A second push with no local edits should skip — proves the item is
    // not perpetually flagged modified.
    const noOpReport = await engine.push();
    expect(noOpReport.pushed).not.toContain("sync-task");
    expect(noOpReport.skipped).toContain("sync-task");

    // Now perform a real local edit through the store's mutation path.
    // Advance the clock slightly first so the new `lastModified` stamp is
    // unambiguously later than `lastSyncedAt` (both are millisecond ISO
    // timestamps).
    await new Promise((resolve) => setTimeout(resolve, 5));
    await local.updateItem("sync-task", { title: "Edited locally" });

    const edited = await local.getItem("sync-task");
    // This is the crux of the bug fix: without a fresh lastModified stamp,
    // isModifiedSinceSync() would return false and the edit would never push.
    expect((edited!.lastModified as string) > (edited!.lastSyncedAt as string)).toBe(true);

    const pushReport = await engine.push();
    expect(pushReport.pushed).toContain("sync-task");
    expect(pushReport.skipped).not.toContain("sync-task");

    const remoteDoc = await remote.loadDocument();
    const remoteItem = findInTree(remoteDoc.items, "sync-task");
    expect(remoteItem?.title).toBe("Edited locally");
  });
});
