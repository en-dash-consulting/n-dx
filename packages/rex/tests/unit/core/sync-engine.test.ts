import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  SyncEngine,
  type SyncDirection,
  type SyncReport,
} from "../../../src/core/sync-engine.js";
import type { PRDStore, StoreCapabilities } from "../../../src/store/contracts.js";
import type {
  PRDDocument,
  PRDItem,
  RexConfig,
  LogEntry,
} from "../../../src/schema/index.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";

// ---------------------------------------------------------------------------
// In-memory PRDStore for testing
// ---------------------------------------------------------------------------

class MemoryStore implements PRDStore {
  doc: PRDDocument;
  config: RexConfig;
  log: LogEntry[] = [];
  workflow = "";

  constructor(
    items: PRDItem[] = [],
    project = "test",
  ) {
    this.doc = { schema: SCHEMA_VERSION, title: project, items };
    this.config = { schema: SCHEMA_VERSION, project, adapter: "memory" };
  }

  async loadDocument(): Promise<PRDDocument> {
    return structuredClone(this.doc);
  }
  async saveDocument(doc: PRDDocument): Promise<void> {
    this.doc = structuredClone(doc);
  }
  async getItem(id: string): Promise<PRDItem | null> {
    return findInTree(this.doc.items, id);
  }
  async addItem(item: PRDItem, parentId?: string): Promise<void> {
    const clone = structuredClone(item);
    if (parentId) {
      const parent = findInTree(this.doc.items, parentId);
      if (!parent) throw new Error(`Parent "${parentId}" not found`);
      if (!parent.children) parent.children = [];
      parent.children.push(clone);
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
    return { ...this.config };
  }
  async saveConfig(config: RexConfig): Promise<void> {
    this.config = { ...config };
  }
  async appendLog(entry: LogEntry): Promise<void> {
    this.log.push(entry);
  }
  async readLog(limit?: number): Promise<LogEntry[]> {
    if (limit !== undefined && limit > 0) return this.log.slice(-limit);
    return [...this.log];
  }
  async loadWorkflow(): Promise<string> {
    return this.workflow;
  }
  async saveWorkflow(content: string): Promise<void> {
    this.workflow = content;
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

function makeItem(
  overrides: Partial<PRDItem> & { id: string; title: string },
): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SyncEngine", () => {
  let local: MemoryStore;
  let remote: MemoryStore;
  let engine: SyncEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));
    local = new MemoryStore();
    remote = new MemoryStore();
    engine = new SyncEngine(local, remote);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("push (local → remote)", () => {
    it("pushes new local items to empty remote", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "New task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.push();

      expect(report.direction).toBe("push");
      expect(report.pushed).toContain("t1");
      expect(report.conflicts).toEqual([]);

      const remoteDoc = await remote.loadDocument();
      expect(remoteDoc.items).toHaveLength(1);
      expect(remoteDoc.items[0].title).toBe("New task");
    });

    it("pushes updated local items to remote", async () => {
      const syncTime = "2024-06-15T10:00:00Z";
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Updated locally",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Original",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.push();

      expect(report.pushed).toContain("t1");
      const remoteDoc = await remote.loadDocument();
      expect(remoteDoc.items[0].title).toBe("Updated locally");
    });

    it("skips items not modified since last sync", async () => {
      const syncTime = "2024-06-15T11:00:00Z";
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Same",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      remote.doc.items = [
        makeItem({ id: "t1", title: "Same" }),
      ];

      const report = await engine.push();

      expect(report.pushed).toEqual([]);
      expect(report.skipped).toContain("t1");
    });

    it("detects and resolves conflicts on push", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      // Both sides modified since last sync
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Local change",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Remote change",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.push();

      // Local is newer → local wins
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].field).toBe("title");
      expect(report.conflicts[0].resolution).toBe("local");
      const remoteDoc = await remote.loadDocument();
      expect(remoteDoc.items[0].title).toBe("Local change");
    });

    it("writes remote-winning conflict values back to local on push", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      // Remote is newer → remote wins the field
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Old local",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Newer remote",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.push();

      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].resolution).toBe("remote");

      // Both stores should converge to the remote value
      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();
      expect(localDoc.items[0].title).toBe("Newer remote");
      expect(remoteDoc.items[0].title).toBe("Newer remote");
    });

    it("pushes multiple new local items to empty remote", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "First", lastModified: "2024-06-15T11:00:00Z" }),
        makeItem({ id: "t2", title: "Second", lastModified: "2024-06-15T11:00:00Z" }),
        makeItem({ id: "t3", title: "Third", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.push();

      expect(report.pushed).toEqual(["t1", "t2", "t3"]);
      expect(report.skipped).toEqual([]);
      const remoteDoc = await remote.loadDocument();
      expect(remoteDoc.items).toHaveLength(3);
    });

    it("stamps both stores with lastSyncedAt after push", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      await engine.push();

      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();
      expect(localDoc.items[0].lastSyncedAt).toBe("2024-06-15T12:00:00.000Z");
      expect(remoteDoc.items[0].lastSyncedAt).toBe("2024-06-15T12:00:00.000Z");
    });

    it("preserves remote-only items during push", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Local task", lastModified: "2024-06-15T11:00:00Z" }),
      ];
      remote.doc.items = [
        makeItem({ id: "t2", title: "Remote-only task" }),
      ];

      await engine.push();

      const remoteDoc = await remote.loadDocument();
      const remoteIds = collectIds(remoteDoc.items);
      // Remote should keep its existing item AND get the pushed one
      expect(remoteIds).toContain("t1");
      expect(remoteIds).toContain("t2");
    });

    it("captures errors in report when remote saveDocument throws", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const err = new Error("network failure");
      vi.spyOn(remote, "saveDocument").mockRejectedValueOnce(err);

      const report = await engine.push();

      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].error).toContain("network failure");
    });

    it("handles nested tree items", async () => {
      local.doc.items = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          lastModified: "2024-06-15T11:00:00Z",
          children: [
            makeItem({
              id: "t1",
              title: "Nested task",
              lastModified: "2024-06-15T11:00:00Z",
            }),
          ],
        }),
      ];

      const report = await engine.push();

      expect(report.pushed).toContain("e1");
      expect(report.pushed).toContain("t1");
      const remoteDoc = await remote.loadDocument();
      expect(remoteDoc.items).toHaveLength(1);
      expect(remoteDoc.items[0].children).toHaveLength(1);
      expect(remoteDoc.items[0].children![0].title).toBe("Nested task");
    });
  });

  describe("pull (remote → local)", () => {
    it("pulls new remote items to empty local", async () => {
      remote.doc.items = [
        makeItem({ id: "t1", title: "Remote task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.pull();

      expect(report.direction).toBe("pull");
      expect(report.pulled).toContain("t1");
      expect(report.conflicts).toEqual([]);

      const localDoc = await local.loadDocument();
      expect(localDoc.items).toHaveLength(1);
      expect(localDoc.items[0].title).toBe("Remote task");
    });

    it("pulls updated remote items to local", async () => {
      const syncTime = "2024-06-15T10:00:00Z";
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Updated remotely",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Original",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.pull();

      expect(report.pulled).toContain("t1");
      const localDoc = await local.loadDocument();
      expect(localDoc.items[0].title).toBe("Updated remotely");
    });

    it("skips items not modified since last sync", async () => {
      const syncTime = "2024-06-15T11:00:00Z";
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Same",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      local.doc.items = [
        makeItem({ id: "t1", title: "Same" }),
      ];

      const report = await engine.pull();

      expect(report.pulled).toEqual([]);
      expect(report.skipped).toContain("t1");
    });

    it("detects and resolves conflicts on pull", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Remote change",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Local change",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.pull();

      // Remote is newer → remote wins
      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].field).toBe("title");
      expect(report.conflicts[0].resolution).toBe("remote");
      const localDoc = await local.loadDocument();
      expect(localDoc.items[0].title).toBe("Remote change");
    });

    it("writes local-winning conflict values back to remote on pull", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      // Local is newer → local wins the field
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Old remote",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Newer local",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.pull();

      expect(report.conflicts).toHaveLength(1);
      expect(report.conflicts[0].resolution).toBe("local");

      // Both stores should converge to the local value
      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();
      expect(localDoc.items[0].title).toBe("Newer local");
      expect(remoteDoc.items[0].title).toBe("Newer local");
    });

    it("pulls remote-only items that don't exist locally", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Existing" }),
      ];
      remote.doc.items = [
        makeItem({ id: "t1", title: "Existing" }),
        makeItem({ id: "t2", title: "New from remote", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.pull();

      expect(report.pulled).toContain("t2");
      const localDoc = await local.loadDocument();
      expect(localDoc.items).toHaveLength(2);
    });

    it("pulls multiple new remote items to empty local", async () => {
      remote.doc.items = [
        makeItem({ id: "t1", title: "First", lastModified: "2024-06-15T11:00:00Z" }),
        makeItem({ id: "t2", title: "Second", lastModified: "2024-06-15T11:00:00Z" }),
        makeItem({ id: "t3", title: "Third", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.pull();

      expect(report.pulled).toEqual(["t1", "t2", "t3"]);
      expect(report.skipped).toEqual([]);
      const localDoc = await local.loadDocument();
      expect(localDoc.items).toHaveLength(3);
    });

    it("stamps both stores with lastSyncedAt after pull", async () => {
      remote.doc.items = [
        makeItem({ id: "t1", title: "Task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      await engine.pull();

      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();
      expect(localDoc.items[0].lastSyncedAt).toBe("2024-06-15T12:00:00.000Z");
      expect(remoteDoc.items[0].lastSyncedAt).toBe("2024-06-15T12:00:00.000Z");
    });

    it("preserves local-only items during pull", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Local-only task" }),
      ];
      remote.doc.items = [
        makeItem({ id: "t2", title: "Remote task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      await engine.pull();

      const localDoc = await local.loadDocument();
      const localIds = collectIds(localDoc.items);
      // Local should keep its existing item AND get the pulled one
      expect(localIds).toContain("t1");
      expect(localIds).toContain("t2");
    });

    it("handles nested remote tree items on pull", async () => {
      remote.doc.items = [
        makeItem({
          id: "e1",
          title: "Remote Epic",
          level: "epic",
          lastModified: "2024-06-15T11:00:00Z",
          children: [
            makeItem({
              id: "t1",
              title: "Nested remote task",
              lastModified: "2024-06-15T11:00:00Z",
            }),
          ],
        }),
      ];

      const report = await engine.pull();

      expect(report.pulled).toContain("e1");
      expect(report.pulled).toContain("t1");
      const localDoc = await local.loadDocument();
      expect(localDoc.items).toHaveLength(1);
      expect(localDoc.items[0].children).toHaveLength(1);
      expect(localDoc.items[0].children![0].title).toBe("Nested remote task");
    });

    it("captures errors in report when local saveDocument throws", async () => {
      remote.doc.items = [
        makeItem({ id: "t1", title: "Task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const err = new Error("disk full");
      vi.spyOn(local, "saveDocument").mockRejectedValueOnce(err);

      const report = await engine.pull();

      expect(report.errors).toHaveLength(1);
      expect(report.errors[0].error).toContain("disk full");
    });
  });

  describe("sync (bidirectional)", () => {
    it("syncs both directions", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Local only", lastModified: "2024-06-15T11:00:00Z" }),
      ];
      remote.doc.items = [
        makeItem({ id: "t2", title: "Remote only", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.sync();

      expect(report.direction).toBe("sync");
      // Local-only item should be pushed to remote
      expect(report.pushed).toContain("t1");
      // Remote-only item should be pulled to local
      expect(report.pulled).toContain("t2");

      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();
      expect(localDoc.items).toHaveLength(2);
      expect(remoteDoc.items).toHaveLength(2);
    });

    it("resolves conflicts with last-write-wins", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Local edit",
          status: "in_progress",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Remote edit",
          status: "completed",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];

      const report = await engine.sync();

      // Local is newer, so local wins
      expect(report.conflicts.length).toBeGreaterThan(0);
      const titleConflict = report.conflicts.find((c) => c.field === "title");
      expect(titleConflict?.resolution).toBe("local");

      // Both stores should have the merged result
      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();
      expect(localDoc.items[0].title).toBe("Local edit");
      expect(remoteDoc.items[0].title).toBe("Local edit");
    });

    it("stamps synced items with lastSyncedAt", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      await engine.sync();

      const localDoc = await local.loadDocument();
      expect(localDoc.items[0].lastSyncedAt).toBe("2024-06-15T12:00:00.000Z");
    });

    it("logs conflicts to the local store", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      local.doc.items = [
        makeItem({
          id: "t1",
          title: "Local",
          lastModified: "2024-06-15T11:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Remote",
          lastModified: "2024-06-15T10:00:00Z",
          lastSyncedAt: syncTime,
        }),
      ];

      await engine.sync();

      expect(local.log.length).toBeGreaterThan(0);
      const conflictLog = local.log.find((e) => e.event === "sync_conflict");
      expect(conflictLog).toBeDefined();
      expect(conflictLog!.field).toBe("title");
    });

    it("handles empty stores on both sides", async () => {
      const report = await engine.sync();

      expect(report.pushed).toEqual([]);
      expect(report.pulled).toEqual([]);
      expect(report.conflicts).toEqual([]);
    });

    it("handles items with children in bidirectional sync", async () => {
      local.doc.items = [
        makeItem({
          id: "e1",
          title: "Epic",
          level: "epic",
          lastModified: "2024-06-15T11:00:00Z",
          children: [
            makeItem({ id: "t1", title: "Local task", lastModified: "2024-06-15T11:00:00Z" }),
          ],
        }),
      ];
      remote.doc.items = [
        makeItem({ id: "t2", title: "Remote task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.sync();

      expect(report.pushed).toContain("e1");
      expect(report.pushed).toContain("t1");
      expect(report.pulled).toContain("t2");

      const localDoc = await local.loadDocument();
      const remoteDoc = await remote.loadDocument();

      // Local should have both the epic + children AND the remote-only task
      const localIds = collectIds(localDoc.items);
      expect(localIds).toContain("e1");
      expect(localIds).toContain("t1");
      expect(localIds).toContain("t2");

      // Remote should have the epic + children AND the original remote task
      const remoteIds = collectIds(remoteDoc.items);
      expect(remoteIds).toContain("e1");
      expect(remoteIds).toContain("t1");
      expect(remoteIds).toContain("t2");
    });

    it("removes locally deleted items from remote on push", async () => {
      const syncTime = "2024-06-15T09:00:00Z";
      // Item exists in remote but was deleted locally after sync
      local.doc.items = [];
      remote.doc.items = [
        makeItem({
          id: "t1",
          title: "Will be deleted",
          lastSyncedAt: syncTime,
          remoteId: "remote-t1",
        }),
      ];

      // Track that t1 was deleted locally after last sync
      const report = await engine.sync({ deletions: new Set(["t1"]) });

      const remoteDoc = await remote.loadDocument();
      const remoteIds = collectIds(remoteDoc.items);
      expect(remoteIds).not.toContain("t1");
      expect(report.deleted).toContain("t1");
    });
  });

  describe("report structure", () => {
    it("returns well-formed SyncReport", async () => {
      local.doc.items = [
        makeItem({ id: "t1", title: "Task", lastModified: "2024-06-15T11:00:00Z" }),
      ];

      const report = await engine.sync();

      expect(report).toHaveProperty("direction");
      expect(report).toHaveProperty("pushed");
      expect(report).toHaveProperty("pulled");
      expect(report).toHaveProperty("skipped");
      expect(report).toHaveProperty("conflicts");
      expect(report).toHaveProperty("deleted");
      expect(report).toHaveProperty("errors");
      expect(report).toHaveProperty("timestamp");
      expect(report.timestamp).toBe("2024-06-15T12:00:00.000Z");
    });
  });
});

function collectIds(items: PRDItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
    if (item.children) {
      ids.push(...collectIds(item.children));
    }
  }
  return ids;
}
