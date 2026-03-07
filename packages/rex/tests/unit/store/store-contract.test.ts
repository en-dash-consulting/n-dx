/**
 * Contract tests for the PRDStore adapter interface.
 *
 * Every implementation of PRDStore must satisfy this contract. The suite
 * is parameterised: pass a factory that creates a fresh store instance and
 * it will exercise every method defined in the interface.
 *
 * To add a new adapter, import `describeStoreContract` and call it with a
 * factory for that adapter.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDStore } from "../../../src/store/contracts.js";
import type { PRDItem, PRDDocument } from "../../../src/schema/index.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { FileStore, ensureRexDir } from "../../../src/store/file-adapter.js";
import { NotionStore, ensureNotionRexDir } from "../../../src/store/notion-adapter.js";
import type { NotionClient, NotionAdapterConfig } from "../../../src/store/notion-client.js";

// ---------------------------------------------------------------------------
// Reusable contract test suite
// ---------------------------------------------------------------------------

function describeStoreContract(
  name: string,
  factory: () => {
    setup: () => Promise<{
      store: PRDStore;
      cleanup: () => Promise<void>;
      /**
       * Optional hook to verify that a removed item was archived (soft-deleted)
       * rather than hard-deleted. Only adapters with archival semantics (e.g.
       * NotionStore) provide this.
       */
      checkArchived?: (itemId: string) => Promise<boolean>;
    }>;
    /** Whether the adapter preserves arbitrary unknown fields on documents/items. */
    supportsPassthrough?: boolean;
    /** Whether the adapter archives removed items (soft-delete vs hard-delete). */
    supportsArchival?: boolean;
  },
) {
  describe(`PRDStore contract: ${name}`, () => {
    let store: PRDStore;
    let cleanup: () => Promise<void>;
    let checkArchived: ((itemId: string) => Promise<boolean>) | undefined;

    beforeEach(async () => {
      const ctx = factory();
      const result = await ctx.setup();
      store = result.store;
      cleanup = result.cleanup;
      checkArchived = result.checkArchived;
    });

    afterEach(async () => {
      await cleanup();
    });

    // ---- Document CRUD ---------------------------------------------------

    describe("loadDocument / saveDocument", () => {
      it("loads a valid document", async () => {
        const doc = await store.loadDocument();
        expect(doc).toBeDefined();
        expect(doc.title).toBeTruthy();
        expect(Array.isArray(doc.items)).toBe(true);
      });

      it("loads a valid document with schema version", async () => {
        const doc = await store.loadDocument();
        expect(doc.schema).toBe(SCHEMA_VERSION);
        expect(Array.isArray(doc.items)).toBe(true);
      });

      it("round-trips a document", async () => {
        const doc = await store.loadDocument();
        doc.title = "Round-Trip Title";
        await store.saveDocument(doc);

        const reloaded = await store.loadDocument();
        expect(reloaded.title).toBe("Round-Trip Title");
        expect(reloaded.schema).toBe(SCHEMA_VERSION);
      });

      it("round-trips a document with items", async () => {
        const doc = await store.loadDocument();
        const item: PRDItem = {
          id: "ct-e1",
          title: "Contract Epic",
          status: "pending",
          level: "epic",
        };
        doc.items.push(item);
        await store.saveDocument(doc);

        const reloaded = await store.loadDocument();
        expect(reloaded.items).toHaveLength(1);
        expect(reloaded.items[0].title).toBe("Contract Epic");
      });

      it("saveDocument replaces the full document state", async () => {
        // Add two items
        const doc = await store.loadDocument();
        doc.items.push(
          { id: "ct-a", title: "A", status: "pending", level: "epic" },
          { id: "ct-b", title: "B", status: "pending", level: "epic" },
        );
        await store.saveDocument(doc);

        // Replace with one item
        const doc2 = await store.loadDocument();
        doc2.items = [{ id: "ct-c", title: "C", status: "pending", level: "epic" }];
        await store.saveDocument(doc2);

        const final = await store.loadDocument();
        expect(final.items).toHaveLength(1);
        expect(final.items[0].id).toBe("ct-c");
      });

      it("round-trips a deep hierarchy (4 levels)", async () => {
        const doc = await store.loadDocument();
        doc.items.push({
          id: "ct-deep-e1",
          title: "Deep Epic",
          status: "pending",
          level: "epic",
          children: [
            {
              id: "ct-deep-f1",
              title: "Deep Feature",
              status: "in_progress",
              level: "feature",
              children: [
                {
                  id: "ct-deep-t1",
                  title: "Deep Task",
                  status: "completed",
                  level: "task",
                  children: [
                    {
                      id: "ct-deep-s1",
                      title: "Deep Subtask",
                      status: "pending",
                      level: "subtask",
                    },
                  ],
                },
              ],
            },
          ],
        });
        await store.saveDocument(doc);

        const reloaded = await store.loadDocument();
        expect(reloaded.items).toHaveLength(1);
        const epic = reloaded.items[0];
        expect(epic.title).toBe("Deep Epic");
        expect(epic.children).toHaveLength(1);
        const feature = epic.children![0];
        expect(feature.title).toBe("Deep Feature");
        expect(feature.status).toBe("in_progress");
        expect(feature.children).toHaveLength(1);
        const task = feature.children![0];
        expect(task.title).toBe("Deep Task");
        expect(task.status).toBe("completed");
        expect(task.children).toHaveLength(1);
        const subtask = task.children![0];
        expect(subtask.title).toBe("Deep Subtask");
        expect(subtask.level).toBe("subtask");
      });

      it("round-trips items with all optional fields", async () => {
        const doc = await store.loadDocument();
        doc.items.push({
          id: "ct-full",
          title: "Fully Loaded",
          status: "blocked",
          level: "task",
          description: "A thorough task",
          acceptanceCriteria: ["Criterion A", "Criterion B"],
          priority: "critical",
          tags: ["auth", "security"],
          source: "hench",
          blockedBy: ["ct-other"],
          startedAt: "2024-06-01T00:00:00Z",
          completedAt: "2024-06-02T12:00:00Z",
        });
        await store.saveDocument(doc);

        const reloaded = await store.loadDocument();
        const item = reloaded.items[0];
        expect(item.description).toBe("A thorough task");
        expect(item.acceptanceCriteria).toEqual(["Criterion A", "Criterion B"]);
        expect(item.priority).toBe("critical");
        expect(item.tags).toEqual(["auth", "security"]);
        expect(item.source).toBe("hench");
        expect(item.blockedBy).toEqual(["ct-other"]);
        expect(item.startedAt).toBe("2024-06-01T00:00:00Z");
        expect(item.completedAt).toBe("2024-06-02T12:00:00Z");
      });

      it("round-trips items with only required fields", async () => {
        const doc = await store.loadDocument();
        doc.items.push({
          id: "ct-min",
          title: "Minimal",
          status: "pending",
          level: "epic",
        });
        await store.saveDocument(doc);

        const reloaded = await store.loadDocument();
        const item = reloaded.items[0];
        expect(item.id).toBe("ct-min");
        expect(item.title).toBe("Minimal");
        expect(item.status).toBe("pending");
        expect(item.level).toBe("epic");
      });

      // Passthrough fields are only preserved by adapters that store raw JSON
      // (e.g. FileStore). Remote adapters like Notion only persist known properties.
      it.skipIf(factory().supportsPassthrough === false)(
        "round-trips passthrough fields on document and items",
        async () => {
          const doc: PRDDocument = {
            schema: SCHEMA_VERSION,
            title: "Extended",
            items: [
              {
                id: "ct-ext",
                title: "Extended Item",
                status: "pending",
                level: "epic",
                customMeta: { nested: true, count: 42 },
              } as PRDItem,
            ],
            projectMeta: "preserved",
          } as PRDDocument;
          await store.saveDocument(doc);

          const reloaded = await store.loadDocument();
          expect((reloaded as Record<string, unknown>).projectMeta).toBe("preserved");
          expect((reloaded.items[0] as Record<string, unknown>).customMeta).toEqual({
            nested: true,
            count: 42,
          });
        },
      );

      it("saveDocument rejects an invalid document", async () => {
        const invalid = { schema: SCHEMA_VERSION, title: "Bad" } as unknown as PRDDocument;
        await expect(store.saveDocument(invalid)).rejects.toThrow();
      });
    });

    describe("getItem", () => {
      it("returns item by id", async () => {
        const doc = await store.loadDocument();
        doc.items.push({
          id: "ct-t1",
          title: "Task",
          status: "pending",
          level: "task",
        });
        await store.saveDocument(doc);

        const item = await store.getItem("ct-t1");
        expect(item).not.toBeNull();
        expect(item!.title).toBe("Task");
      });

      it("returns null for unknown id", async () => {
        const item = await store.getItem("nonexistent-id");
        expect(item).toBeNull();
      });
    });

    describe("addItem", () => {
      it("adds item to root when no parentId", async () => {
        await store.addItem({
          id: "ct-root",
          title: "Root Item",
          status: "pending",
          level: "epic",
        });

        const doc = await store.loadDocument();
        const found = doc.items.find((i) => i.id === "ct-root");
        expect(found).toBeDefined();
        expect(found!.title).toBe("Root Item");
      });

      it("adds item under parent when parentId provided", async () => {
        await store.addItem({
          id: "ct-parent",
          title: "Parent",
          status: "pending",
          level: "epic",
        });
        await store.addItem(
          {
            id: "ct-child",
            title: "Child",
            status: "pending",
            level: "feature",
          },
          "ct-parent",
        );

        const doc = await store.loadDocument();
        const parent = doc.items.find((i) => i.id === "ct-parent");
        expect(parent).toBeDefined();
        expect(parent!.children).toBeDefined();
        expect(parent!.children!.some((c) => c.id === "ct-child")).toBe(true);
      });

      it("throws when parentId does not exist", async () => {
        await expect(
          store.addItem(
            { id: "ct-orphan", title: "Orphan", status: "pending", level: "task" },
            "nonexistent-parent",
          ),
        ).rejects.toThrow();
      });
    });

    describe("updateItem", () => {
      it("updates item fields", async () => {
        await store.addItem({
          id: "ct-upd",
          title: "Before",
          status: "pending",
          level: "task",
        });

        await store.updateItem("ct-upd", { status: "completed", title: "After" });

        const item = await store.getItem("ct-upd");
        expect(item!.status).toBe("completed");
        expect(item!.title).toBe("After");
      });

      it("throws when item does not exist", async () => {
        await expect(
          store.updateItem("nonexistent-id", { status: "completed" }),
        ).rejects.toThrow();
      });
    });

    describe("removeItem", () => {
      it("removes an existing item", async () => {
        await store.addItem({
          id: "ct-rm",
          title: "Remove Me",
          status: "pending",
          level: "task",
        });

        await store.removeItem("ct-rm");

        const item = await store.getItem("ct-rm");
        expect(item).toBeNull();
      });

      it("throws when item does not exist", async () => {
        await expect(store.removeItem("nonexistent-id")).rejects.toThrow();
      });

      it.skipIf(factory().supportsArchival !== true)(
        "archives removed items instead of hard-deleting",
        async () => {
          // Add an item, then remove it via saveDocument (dropping it from the tree)
          await store.addItem({
            id: "ct-archive",
            title: "Will be archived",
            status: "pending",
            level: "epic",
          });

          // Save a document without the item — adapter should archive it
          const doc = await store.loadDocument();
          doc.items = [];
          await store.saveDocument(doc);

          // The item should no longer be retrievable via the store
          const item = await store.getItem("ct-archive");
          expect(item).toBeNull();

          // But the adapter should have archived (soft-deleted) it
          expect(checkArchived).toBeDefined();
          const archived = await checkArchived!("ct-archive");
          expect(archived).toBe(true);
        },
      );
    });

    // ---- Configuration ---------------------------------------------------

    describe("loadConfig / saveConfig", () => {
      it("loads a valid config with project name", async () => {
        const config = await store.loadConfig();
        expect(config.schema).toBe(SCHEMA_VERSION);
        expect(typeof config.project).toBe("string");
        expect(typeof config.adapter).toBe("string");
      });

      it("round-trips config changes", async () => {
        const config = await store.loadConfig();
        config.model = "test-model";
        await store.saveConfig(config);

        const reloaded = await store.loadConfig();
        expect(reloaded.model).toBe("test-model");
      });
    });

    // ---- Execution log ---------------------------------------------------

    describe("appendLog / readLog", () => {
      it("appends and reads entries in chronological order", async () => {
        await store.appendLog({
          timestamp: "2024-01-01T00:00:00Z",
          event: "first",
          detail: "entry-1",
        });
        await store.appendLog({
          timestamp: "2024-01-02T00:00:00Z",
          event: "second",
          detail: "entry-2",
        });

        const entries = await store.readLog();
        expect(entries).toHaveLength(2);
        expect(entries[0].event).toBe("first");
        expect(entries[1].event).toBe("second");
      });

      it("respects limit parameter (returns most recent N)", async () => {
        for (let i = 0; i < 5; i++) {
          await store.appendLog({
            timestamp: `2024-01-0${i + 1}T00:00:00Z`,
            event: `event-${i}`,
            detail: `detail-${i}`,
          });
        }

        const entries = await store.readLog(2);
        expect(entries).toHaveLength(2);
        expect(entries[0].detail).toBe("detail-3");
        expect(entries[1].detail).toBe("detail-4");
      });

      it("returns empty array when no log exists", async () => {
        // The log file was seeded empty; this should still work
        const entries = await store.readLog();
        expect(Array.isArray(entries)).toBe(true);
      });
    });

    // ---- Workflow ---------------------------------------------------------

    describe("loadWorkflow / saveWorkflow", () => {
      it("loads workflow content", async () => {
        const content = await store.loadWorkflow();
        expect(typeof content).toBe("string");
      });

      it("round-trips workflow content", async () => {
        await store.saveWorkflow("# Updated Workflow\n\nNew content");
        const content = await store.loadWorkflow();
        expect(content).toBe("# Updated Workflow\n\nNew content");
      });
    });

    // ---- Capabilities ----------------------------------------------------

    describe("capabilities", () => {
      it("returns a valid StoreCapabilities object", () => {
        const caps = store.capabilities();
        expect(typeof caps.adapter).toBe("string");
        expect(caps.adapter.length).toBeGreaterThan(0);
        expect(typeof caps.supportsTransactions).toBe("boolean");
        expect(typeof caps.supportsWatch).toBe("boolean");
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Run the contract against the FileStore adapter
// ---------------------------------------------------------------------------

describeStoreContract("FileStore", () => ({
  supportsPassthrough: true,
  setup: async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-contract-"));
    const rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);

    // Seed the minimal files FileStore expects
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Contract Test",
      items: [],
    };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        project: "contract-test",
        adapter: "file",
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    const store = new FileStore(rexDir);
    return {
      store,
      cleanup: async () => rm(tmpDir, { recursive: true, force: true }),
    };
  },
}));

// ---------------------------------------------------------------------------
// Run the contract against the NotionStore adapter
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * In-memory mock Notion client for contract tests.
 * Mirrors the mock in notion-adapter.test.ts but kept local so the
 * contract suite stays self-contained.
 */
class ContractMockNotionClient implements NotionClient {
  pages: Map<string, any> = new Map();
  blocks: Map<string, any[]> = new Map();
  database: any = { id: "db-contract", properties: {} };
  private nextId = 1;

  async getDatabase(_databaseId: string): Promise<any> {
    return this.database;
  }

  async queryDatabase(_databaseId: string): Promise<any[]> {
    return [...this.pages.values()].filter((p) => !p.archived);
  }

  async getPage(pageId: string): Promise<any> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    return page;
  }

  async createPage(params: {
    parent: { database_id?: string; page_id?: string };
    properties: Record<string, any>;
    children?: any[];
  }): Promise<any> {
    const id = `notion-page-${this.nextId++}`;
    const page = {
      id,
      parent: params.parent,
      properties: params.properties,
      archived: false,
    };
    this.pages.set(id, page);
    if (params.children) {
      this.blocks.set(id, params.children);
    }
    return page;
  }

  async updatePage(
    pageId: string,
    properties: Record<string, any>,
  ): Promise<any> {
    const page = this.pages.get(pageId);
    if (!page) throw new Error(`Page not found: ${pageId}`);
    page.properties = { ...page.properties, ...properties };
    return page;
  }

  async archivePage(pageId: string): Promise<void> {
    const page = this.pages.get(pageId);
    if (page) page.archived = true;
  }

  async getBlockChildren(pageId: string): Promise<any[]> {
    return this.blocks.get(pageId) ?? [];
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describeStoreContract("NotionStore", () => ({
  supportsPassthrough: false,
  supportsArchival: true,
  setup: async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-contract-notion-"));
    const rexDir = join(tmpDir, ".rex");
    await ensureNotionRexDir(rexDir);

    // Seed local files (config, log, workflow — NotionStore needs these)
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        project: "contract-test",
        adapter: "notion",
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    const adapterConfig: NotionAdapterConfig = {
      token: "secret_contract_test",
      databaseId: "db-contract",
    };
    const mockClient = new ContractMockNotionClient();
    const store = new NotionStore(rexDir, mockClient, adapterConfig);

    return {
      store,
      cleanup: async () => rm(tmpDir, { recursive: true, force: true }),
      /** Check if an item was archived by looking up its Notion page by PRD ID. */
      checkArchived: async (itemId: string): Promise<boolean> => {
        for (const page of mockClient.pages.values()) {
          const prdId =
            page.properties?.["PRD ID"]?.rich_text?.[0]?.text?.content;
          if (prdId === itemId) {
            return page.archived === true;
          }
        }
        return false;
      },
    };
  },
}));
