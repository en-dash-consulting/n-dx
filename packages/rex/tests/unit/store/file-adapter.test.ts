import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FileStore, ensureRexDir } from "../../../src/store/file-adapter.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";
import { serializeDocument } from "../../../src/store/markdown-serializer.js";
import { PRD_MARKDOWN_FILENAME } from "../../../src/store/prd-md-migration.js";

describe("FileStore", () => {
  let rexDir: string;
  let store: FileStore;

  beforeEach(async () => {
    const tmpDir = await mkdtemp(join(tmpdir(), "rex-test-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
    store = new FileStore(rexDir);

    // Seed minimal files — prd.md is the primary storage
    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Test",
      items: [],
    };
    await writeFile(join(rexDir, PRD_MARKDOWN_FILENAME), serializeDocument(doc), "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");
  });

  afterEach(async () => {
    await rm(rexDir, { recursive: true, force: true });
  });

  describe("loadDocument / saveDocument", () => {
    it("loads a valid document", async () => {
      const doc = await store.loadDocument();
      expect(doc.schema).toBe(SCHEMA_VERSION);
      expect(doc.title).toBe("Test");
      expect(doc.items).toEqual([]);
    });

    it("round-trips a document", async () => {
      const doc = await store.loadDocument();
      doc.items.push({
        id: "e1",
        title: "Epic",
        status: "pending",
        level: "epic",
      });
      await store.saveDocument(doc);
      const reloaded = await store.loadDocument();
      expect(reloaded.items.length).toBe(1);
      expect(reloaded.items[0].title).toBe("Epic");
    });

    it("saveDocument validates before writing", async () => {
      const invalid = { schema: SCHEMA_VERSION, title: "Missing items" } as unknown as PRDDocument;
      await expect(store.saveDocument(invalid)).rejects.toThrow();

      // Verify the original document is untouched
      const doc = await store.loadDocument();
      expect(doc.title).toBe("Test");
    });

    it("saveDocument does not create prd.json when absent", async () => {
      const doc = await store.loadDocument();
      doc.items.push({ id: "e1", title: "Epic", status: "pending", level: "epic" });
      await store.saveDocument(doc);
      await expect(access(join(rexDir, "prd.json"))).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("saveDocument does not modify a pre-existing prd.json", async () => {
      const legacyContent = toCanonicalJSON({ schema: SCHEMA_VERSION, title: "Legacy", items: [] });
      await writeFile(join(rexDir, "prd.json"), legacyContent, "utf-8");

      const doc = await store.loadDocument();
      doc.items.push({ id: "e1", title: "Epic", status: "pending", level: "epic" });
      await store.saveDocument(doc);

      const after = await readFile(join(rexDir, "prd.json"), "utf-8");
      expect(after).toBe(legacyContent);
    });
  });

  describe("loadDocument — JSON fallback (migration path)", () => {
    // These tests exercise the legacy migration path where prd.md is absent
    // and loadDocument falls back to prd.json. No prd.md is seeded here.

    let jsonRexDir: string;
    let jsonStore: FileStore;

    beforeEach(async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), "rex-json-fallback-"));
      jsonRexDir = join(tmpDir, ".rex");
      await ensureRexDir(jsonRexDir);
      jsonStore = new FileStore(jsonRexDir);
    });

    afterEach(async () => {
      await rm(jsonRexDir, { recursive: true, force: true });
    });

    it("throws on malformed JSON in prd.json", async () => {
      await writeFile(join(jsonRexDir, "prd.json"), "{not valid json", "utf-8");
      await expect(jsonStore.loadDocument()).rejects.toThrow();
    });

    it("throws on schema-invalid prd.json", async () => {
      await writeFile(
        join(jsonRexDir, "prd.json"),
        JSON.stringify({ title: "No schema", items: [] }),
        "utf-8",
      );
      await expect(jsonStore.loadDocument()).rejects.toThrow("Invalid prd.json");
    });

    it("throws on prd.json with invalid item fields", async () => {
      await writeFile(
        join(jsonRexDir, "prd.json"),
        JSON.stringify({
          schema: SCHEMA_VERSION,
          title: "Bad Items",
          items: [{ id: "x", title: "X", status: "bogus", level: "epic" }],
        }),
        "utf-8",
      );
      await expect(jsonStore.loadDocument()).rejects.toThrow("Invalid prd.json");
    });
  });

  describe("getItem", () => {
    it("returns item by id", async () => {
      const doc = await store.loadDocument();
      doc.items.push({
        id: "t1",
        title: "Task",
        status: "pending",
        level: "task",
      });
      await store.saveDocument(doc);
      const item = await store.getItem("t1");
      expect(item).not.toBeNull();
      expect(item!.title).toBe("Task");
    });

    it("returns null for unknown id", async () => {
      const item = await store.getItem("nonexistent");
      expect(item).toBeNull();
    });
  });

  describe("addItem", () => {
    it("adds item to root", async () => {
      const item: PRDItem = {
        id: "e1",
        title: "Epic",
        status: "pending",
        level: "epic",
      };
      await store.addItem(item);
      const doc = await store.loadDocument();
      expect(doc.items.length).toBe(1);
      expect(doc.items[0].id).toBe("e1");
    });

    it("adds item under parent", async () => {
      const epic: PRDItem = {
        id: "e1",
        title: "Epic",
        status: "pending",
        level: "epic",
      };
      await store.addItem(epic);

      const feature: PRDItem = {
        id: "f1",
        title: "Feature",
        status: "pending",
        level: "feature",
      };
      await store.addItem(feature, "e1");

      const doc = await store.loadDocument();
      expect(doc.items[0].children!.length).toBe(1);
      expect(doc.items[0].children![0].id).toBe("f1");
    });

    it("throws for nonexistent parent", async () => {
      const item: PRDItem = {
        id: "f1",
        title: "Feature",
        status: "pending",
        level: "feature",
      };
      await expect(store.addItem(item, "nope")).rejects.toThrow(
        'Parent "nope" not found',
      );
    });
  });

  describe("updateItem", () => {
    it("updates item fields", async () => {
      await store.addItem({
        id: "t1",
        title: "Task",
        status: "pending",
        level: "task",
      });
      await store.updateItem("t1", { status: "completed" });
      const item = await store.getItem("t1");
      expect(item!.status).toBe("completed");
    });

    it("throws for unknown id", async () => {
      await expect(
        store.updateItem("nope", { status: "completed" }),
      ).rejects.toThrow('Item "nope" not found');
    });
  });

  describe("appendLog / readLog", () => {
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
      expect(entries.length).toBe(2);
      expect(entries[0].detail).toBe("first");
      expect(entries[1].detail).toBe("second");
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await store.appendLog({
          timestamp: `2024-01-0${i + 1}T00:00:00Z`,
          event: "test",
          detail: `entry-${i}`,
        });
      }
      const entries = await store.readLog(2);
      expect(entries.length).toBe(2);
      expect(entries[0].detail).toBe("entry-3");
      expect(entries[1].detail).toBe("entry-4");
    });

    it("returns empty array when no log file", async () => {
      await rm(join(rexDir, "execution-log.jsonl"));
      const entries = await store.readLog();
      expect(entries).toEqual([]);
    });
  });

  describe("workflow", () => {
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

  describe("config", () => {
    it("loads config", async () => {
      const config = await store.loadConfig();
      expect(config.project).toBe("test");
      expect(config.adapter).toBe("file");
    });

    it("saves and reloads config", async () => {
      const config = await store.loadConfig();
      config.sourcevision = "enabled";
      await store.saveConfig(config);
      const reloaded = await store.loadConfig();
      expect(reloaded.sourcevision).toBe("enabled");
    });
  });

  describe("capabilities", () => {
    it("returns file adapter capabilities", () => {
      const caps = store.capabilities();
      expect(caps.adapter).toBe("file");
      expect(caps.supportsTransactions).toBe(true);
      expect(caps.supportsWatch).toBe(false);
    });
  });
});
