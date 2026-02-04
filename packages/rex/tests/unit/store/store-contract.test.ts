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
import type { PRDStore } from "../../../src/store/types.js";
import type { PRDItem, PRDDocument } from "../../../src/schema/index.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { FileStore, ensureRexDir } from "../../../src/store/file-adapter.js";

// ---------------------------------------------------------------------------
// Reusable contract test suite
// ---------------------------------------------------------------------------

function describeStoreContract(
  name: string,
  factory: () => {
    setup: () => Promise<{ store: PRDStore; cleanup: () => Promise<void> }>;
  },
) {
  describe(`PRDStore contract: ${name}`, () => {
    let store: PRDStore;
    let cleanup: () => Promise<void>;

    beforeEach(async () => {
      const ctx = factory();
      const result = await ctx.setup();
      store = result.store;
      cleanup = result.cleanup;
    });

    afterEach(async () => {
      await cleanup();
    });

    // ---- Document CRUD ---------------------------------------------------

    describe("loadDocument / saveDocument", () => {
      it("loads a valid document with schema version", async () => {
        const doc = await store.loadDocument();
        expect(doc.schema).toBe(SCHEMA_VERSION);
        expect(Array.isArray(doc.items)).toBe(true);
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
