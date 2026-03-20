import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NotionStore, ensureNotionRexDir } from "../../../src/store/notion-adapter.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDItem } from "../../../src/schema/index.js";
import type { NotionClient, NotionAdapterConfig } from "../../../src/store/notion-client.js";

// ---------------------------------------------------------------------------
// Mock Notion Client — in-memory page store
// ---------------------------------------------------------------------------

class MockNotionClient implements NotionClient {
  pages: Map<string, any> = new Map();
  blocks: Map<string, any[]> = new Map();
  database: any = { id: "db-test", properties: {} };
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

  // Test helper: seed a page that looks like a Notion response
  seedPage(opts: {
    id: string;
    prdId: string;
    title: string;
    level: string;
    status?: string;
    parentPageId?: string;
    databaseId?: string;
    description?: string;
    priority?: string;
    tags?: string[];
    blocks?: any[];
  }): void {
    const props: any = {
      Name: { title: [{ plain_text: opts.title }] },
      Status: { status: { name: opts.status ?? "Not started" } },
      Level: { select: { name: opts.level } },
      "PRD ID": { rich_text: [{ plain_text: opts.prdId }] },
    };
    if (opts.description) {
      props.Description = { rich_text: [{ plain_text: opts.description }] };
    }
    if (opts.priority) {
      props.Priority = { select: { name: opts.priority } };
    }
    if (opts.tags) {
      props.Tags = { multi_select: opts.tags.map((t) => ({ name: t })) };
    }
    const parent = opts.parentPageId
      ? { page_id: opts.parentPageId }
      : { database_id: opts.databaseId ?? "db-test" };

    this.pages.set(opts.id, {
      id: opts.id,
      parent,
      properties: props,
      archived: false,
    });
    if (opts.blocks) {
      this.blocks.set(opts.id, opts.blocks);
    }
  }
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("NotionStore", () => {
  let rexDir: string;
  let store: NotionStore;
  let mockClient: MockNotionClient;
  const adapterConfig: NotionAdapterConfig = {
    token: "secret_test",
    databaseId: "db-test",
  };

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-notion-test-"));
    rexDir = join(tmpDir, ".n-dx/rex");
    await ensureNotionRexDir(rexDir);
    mockClient = new MockNotionClient();
    store = new NotionStore(rexDir, mockClient, adapterConfig);

    // Seed config and local files
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        project: "test-project",
        adapter: "notion",
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");
  });

  afterEach(async () => {
    await rm(rexDir, { recursive: true, force: true });
  });

  describe("loadDocument", () => {
    it("returns empty document from empty database", async () => {
      const doc = await store.loadDocument();
      expect(doc.schema).toBe(SCHEMA_VERSION);
      expect(doc.title).toBe("test-project");
      expect(doc.items).toEqual([]);
    });

    it("reconstructs a tree from flat Notion pages", async () => {
      mockClient.seedPage({
        id: "n-e1",
        prdId: "e1",
        title: "Epic One",
        level: "epic",
        status: "In progress",
      });
      mockClient.seedPage({
        id: "n-f1",
        prdId: "f1",
        title: "Feature One",
        level: "feature",
        parentPageId: "n-e1",
      });
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task One",
        level: "task",
        parentPageId: "n-f1",
        status: "Done",
      });

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(1);

      const epic = doc.items[0];
      expect(epic.id).toBe("e1");
      expect(epic.status).toBe("in_progress");
      expect(epic.children).toHaveLength(1);

      const feature = epic.children![0];
      expect(feature.id).toBe("f1");
      expect(feature.children).toHaveLength(1);

      const task = feature.children![0];
      expect(task.id).toBe("t1");
      expect(task.status).toBe("completed");
    });

    it("extracts description from Notion properties", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        description: "Task description here",
      });

      const doc = await store.loadDocument();
      expect(doc.items[0].description).toBe("Task description here");
    });

    it("extracts description from body blocks as fallback", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        blocks: [
          {
            type: "paragraph",
            paragraph: { rich_text: [{ plain_text: "From blocks" }] },
          },
        ],
      });

      const doc = await store.loadDocument();
      expect(doc.items[0].description).toBe("From blocks");
    });

    it("extracts acceptance criteria from body blocks", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        blocks: [
          {
            type: "heading_2",
            heading_2: { rich_text: [{ plain_text: "Acceptance Criteria" }] },
          },
          {
            type: "to_do",
            to_do: { rich_text: [{ plain_text: "Tests pass" }], checked: false },
          },
          {
            type: "to_do",
            to_do: { rich_text: [{ plain_text: "Code reviewed" }], checked: true },
          },
        ],
      });

      const doc = await store.loadDocument();
      expect(doc.items[0].acceptanceCriteria).toEqual([
        "Tests pass",
        "Code reviewed",
      ]);
    });

    it("maps priority and tags from Notion", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        priority: "High",
        tags: ["api", "auth"],
      });

      const doc = await store.loadDocument();
      expect(doc.items[0].priority).toBe("high");
      expect(doc.items[0].tags).toEqual(["api", "auth"]);
    });
  });

  describe("saveDocument", () => {
    it("creates pages for new items", async () => {
      const doc = {
        schema: SCHEMA_VERSION,
        title: "test-project",
        items: [
          {
            id: "e1",
            title: "New Epic",
            status: "pending" as const,
            level: "epic" as const,
          },
        ],
      };

      await store.saveDocument(doc);

      const pages = await mockClient.queryDatabase("db-test");
      expect(pages).toHaveLength(1);
      expect(pages[0].properties.Name.title[0].text.content).toBe("New Epic");
    });

    it("updates existing pages", async () => {
      mockClient.seedPage({
        id: "n-e1",
        prdId: "e1",
        title: "Old Title",
        level: "epic",
      });

      const doc = {
        schema: SCHEMA_VERSION,
        title: "test-project",
        items: [
          {
            id: "e1",
            title: "Updated Title",
            status: "in_progress" as const,
            level: "epic" as const,
          },
        ],
      };

      await store.saveDocument(doc);

      const page = mockClient.pages.get("n-e1");
      expect(page!.properties.Name.title[0].text.content).toBe(
        "Updated Title",
      );
      expect(page!.properties.Status.status.name).toBe("In progress");
    });

    it("archives removed items", async () => {
      mockClient.seedPage({
        id: "n-e1",
        prdId: "e1",
        title: "Will be removed",
        level: "epic",
      });

      const doc = {
        schema: SCHEMA_VERSION,
        title: "test-project",
        items: [], // empty — e1 removed
      };

      await store.saveDocument(doc);

      const page = mockClient.pages.get("n-e1");
      expect(page!.archived).toBe(true);
    });

    it("creates nested items with correct parents", async () => {
      const doc = {
        schema: SCHEMA_VERSION,
        title: "test-project",
        items: [
          {
            id: "e1",
            title: "Epic",
            status: "pending" as const,
            level: "epic" as const,
            children: [
              {
                id: "f1",
                title: "Feature",
                status: "pending" as const,
                level: "feature" as const,
              },
            ],
          },
        ],
      };

      await store.saveDocument(doc);

      const pages = await mockClient.queryDatabase("db-test");
      expect(pages).toHaveLength(2);

      // Epic should have database parent
      const epicPage = pages.find(
        (p) => p.properties?.Name?.title?.[0]?.text?.content === "Epic",
      );
      expect(epicPage!.parent.database_id).toBe("db-test");
    });
  });

  describe("getItem", () => {
    it("returns item by id", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "My Task",
        level: "task",
      });

      const item = await store.getItem("t1");
      expect(item).not.toBeNull();
      expect(item!.title).toBe("My Task");
    });

    it("returns null for unknown id", async () => {
      const item = await store.getItem("nonexistent");
      expect(item).toBeNull();
    });
  });

  describe("addItem", () => {
    it("creates a new page in Notion", async () => {
      const item: PRDItem = {
        id: "e1",
        title: "New Epic",
        status: "pending",
        level: "epic",
      };

      await store.addItem(item);

      const pages = await mockClient.queryDatabase("db-test");
      expect(pages).toHaveLength(1);
      expect(pages[0].properties.Name.title[0].text.content).toBe("New Epic");
    });

    it("creates page under parent when parentId given", async () => {
      mockClient.seedPage({
        id: "n-e1",
        prdId: "e1",
        title: "Epic",
        level: "epic",
      });

      const feature: PRDItem = {
        id: "f1",
        title: "Feature",
        status: "pending",
        level: "feature",
      };

      await store.addItem(feature, "e1");

      const pages = await mockClient.queryDatabase("db-test");
      // Should have 2 pages: the seeded epic + the new feature
      expect(pages).toHaveLength(2);
      const featurePage = pages.find(
        (p) => p.properties?.Name?.title?.[0]?.text?.content === "Feature",
      );
      expect(featurePage).toBeDefined();
      // Feature should have epic as parent
      expect(featurePage!.parent.page_id).toBe("n-e1");
    });

    it("throws when parentId does not exist", async () => {
      const task: PRDItem = {
        id: "t1",
        title: "Orphan Task",
        status: "pending",
        level: "task",
      };

      await expect(store.addItem(task, "nonexistent-parent")).rejects.toThrow(
        'Parent "nonexistent-parent" not found',
      );
    });

    it("maps all item fields to Notion properties", async () => {
      const item: PRDItem = {
        id: "t1",
        title: "Full Task",
        status: "in_progress",
        level: "task",
        description: "Do the thing",
        priority: "high",
        tags: ["api", "auth"],
        source: "hench",
        blockedBy: ["t0"],
      };

      await store.addItem(item);

      const pages = await mockClient.queryDatabase("db-test");
      expect(pages).toHaveLength(1);
      const props = pages[0].properties;
      expect(props.Name.title[0].text.content).toBe("Full Task");
      expect(props.Status.status.name).toBe("In progress");
      expect(props.Level.select.name).toBe("task");
      expect(props["PRD ID"].rich_text[0].text.content).toBe("t1");
      expect(props.Description.rich_text[0].text.content).toBe("Do the thing");
      expect(props.Priority.select.name).toBe("High");
      expect(props.Tags.multi_select).toEqual([{ name: "api" }, { name: "auth" }]);
      expect(props.Source.rich_text[0].text.content).toBe("hench");
      expect(props["Blocked By"].rich_text[0].text.content).toBe("t0");
    });

    it("includes body blocks for description and acceptance criteria", async () => {
      const item: PRDItem = {
        id: "t1",
        title: "Task with AC",
        status: "pending",
        level: "task",
        description: "Task description",
        acceptanceCriteria: ["Tests pass", "Code reviewed"],
      };

      await store.addItem(item);

      const pages = await mockClient.queryDatabase("db-test");
      const pageId = pages[0].id;
      const blocks = mockClient.blocks.get(pageId);
      expect(blocks).toBeDefined();
      expect(blocks!.length).toBeGreaterThan(0);

      // Should have description paragraph
      const descBlock = blocks!.find(
        (b: any) => b.type === "paragraph",
      );
      expect(descBlock).toBeDefined();

      // Should have acceptance criteria heading + to_do items
      const headingBlock = blocks!.find(
        (b: any) => b.type === "heading_2",
      );
      expect(headingBlock).toBeDefined();

      const todoBlocks = blocks!.filter((b: any) => b.type === "to_do");
      expect(todoBlocks).toHaveLength(2);
    });

    it("invalidates status group cache after add", async () => {
      // Prime the cache
      await store.loadDocument();

      const item: PRDItem = {
        id: "e1",
        title: "Epic",
        status: "pending",
        level: "epic",
      };
      await store.addItem(item);

      // The next loadDocument should re-fetch the database (cache invalidated)
      const spy = vi.spyOn(mockClient, "getDatabase");
      await store.loadDocument();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("updateItem", () => {
    it("updates an existing item's properties", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        status: "Not started",
      });

      await store.updateItem("t1", { status: "completed" });

      const page = mockClient.pages.get("n-t1");
      expect(page!.properties.Status.status.name).toBe("Done");
    });

    it("merges multiple fields in a single update", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        status: "Not started",
      });

      await store.updateItem("t1", {
        title: "Updated Task",
        status: "in_progress",
        priority: "high",
      });

      const page = mockClient.pages.get("n-t1");
      expect(page!.properties.Name.title[0].text.content).toBe("Updated Task");
      expect(page!.properties.Status.status.name).toBe("In progress");
      expect(page!.properties.Priority.select.name).toBe("High");
    });

    it("preserves unchanged fields during update", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
        status: "Not started",
        priority: "High",
        tags: ["api"],
      });

      await store.updateItem("t1", { status: "completed" });

      const page = mockClient.pages.get("n-t1");
      expect(page!.properties.Status.status.name).toBe("Done");
      // Priority should still be set (merged from existing item)
      expect(page!.properties.Priority.select.name).toBe("High");
    });

    it("invalidates status group cache after update", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
      });

      // Prime the cache
      await store.loadDocument();

      await store.updateItem("t1", { status: "completed" });

      const spy = vi.spyOn(mockClient, "getDatabase");
      await store.loadDocument();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("throws for unknown id", async () => {
      await expect(
        store.updateItem("nope", { status: "completed" }),
      ).rejects.toThrow('Item "nope" not found');
    });
  });

  describe("removeItem", () => {
    it("archives the Notion page", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
      });

      await store.removeItem("t1");

      const page = mockClient.pages.get("n-t1");
      expect(page!.archived).toBe(true);
    });

    it("removed item is no longer returned by getItem", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
      });

      await store.removeItem("t1");

      const item = await store.getItem("t1");
      expect(item).toBeNull();
    });

    it("removed item is excluded from loadDocument", async () => {
      mockClient.seedPage({
        id: "n-e1",
        prdId: "e1",
        title: "Epic",
        level: "epic",
      });
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
      });

      await store.removeItem("t1");

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].id).toBe("e1");
    });

    it("invalidates status group cache after remove", async () => {
      mockClient.seedPage({
        id: "n-t1",
        prdId: "t1",
        title: "Task",
        level: "task",
      });

      // Prime the cache
      await store.loadDocument();

      await store.removeItem("t1");

      const spy = vi.spyOn(mockClient, "getDatabase");
      await store.loadDocument();
      expect(spy).toHaveBeenCalled();
      spy.mockRestore();
    });

    it("throws for unknown id", async () => {
      await expect(store.removeItem("nope")).rejects.toThrow(
        'Item "nope" not found',
      );
    });
  });

  describe("config (file-backed)", () => {
    it("loads config from local file", async () => {
      const config = await store.loadConfig();
      expect(config.project).toBe("test-project");
      expect(config.adapter).toBe("notion");
    });

    it("saves and reloads config", async () => {
      const config = await store.loadConfig();
      config.sourcevision = "enabled";
      await store.saveConfig(config);
      const reloaded = await store.loadConfig();
      expect(reloaded.sourcevision).toBe("enabled");
    });
  });

  describe("log (file-backed)", () => {
    it("appends and reads log entries", async () => {
      await store.appendLog({
        timestamp: "2024-01-01T00:00:00Z",
        event: "test",
        detail: "first",
      });
      await store.appendLog({
        timestamp: "2024-01-02T00:00:00Z",
        event: "test",
        detail: "second",
      });
      const entries = await store.readLog();
      expect(entries).toHaveLength(2);
      expect(entries[0].detail).toBe("first");
      expect(entries[1].detail).toBe("second");
    });

    it("respects limit", async () => {
      for (let i = 0; i < 5; i++) {
        await store.appendLog({
          timestamp: `2024-01-0${i + 1}T00:00:00Z`,
          event: "test",
          detail: `entry-${i}`,
        });
      }
      const entries = await store.readLog(2);
      expect(entries).toHaveLength(2);
      expect(entries[0].detail).toBe("entry-3");
    });
  });

  describe("workflow (file-backed)", () => {
    it("loads workflow", async () => {
      const content = await store.loadWorkflow();
      expect(content).toBe("# Workflow");
    });

    it("saves and reloads workflow", async () => {
      await store.saveWorkflow("# New Workflow\n\nStep 1");
      const content = await store.loadWorkflow();
      expect(content).toBe("# New Workflow\n\nStep 1");
    });
  });

  describe("capabilities", () => {
    it("returns notion adapter capabilities", () => {
      const caps = store.capabilities();
      expect(caps.adapter).toBe("notion");
      expect(caps.supportsTransactions).toBe(false);
      expect(caps.supportsWatch).toBe(false);
    });
  });
});
