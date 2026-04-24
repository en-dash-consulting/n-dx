import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore, ensureRexDir } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";
import { parseDocument } from "../../src/store/markdown-parser.js";
import { PRD_MARKDOWN_FILENAME } from "../../src/store/prd-md-migration.js";
import type { PRDStore } from "../../src/store/index.js";
import type { PRDItem, PRDDocument } from "../../src/schema/index.js";

async function readJsonDoc(rexDir: string): Promise<PRDDocument> {
  return JSON.parse(await readFile(join(rexDir, "prd.json"), "utf-8")) as PRDDocument;
}

async function readMarkdownDoc(rexDir: string): Promise<PRDDocument> {
  const parsed = parseDocument(await readFile(join(rexDir, PRD_MARKDOWN_FILENAME), "utf-8"));
  if (!parsed.ok) throw parsed.error;
  return parsed.data;
}

async function expectCanonicalFilesInSync(rexDir: string): Promise<PRDDocument> {
  const [jsonDoc, markdownDoc] = await Promise.all([
    readJsonDoc(rexDir),
    readMarkdownDoc(rexDir),
  ]);
  expect(markdownDoc).toEqual(jsonDoc);
  return markdownDoc;
}

describe("Store roundtrip integration", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-integ-"));
    rexDir = join(tmpDir, ".rex");
    await ensureRexDir(rexDir);
    store = createStore("file", rexDir);

    const doc: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Integration Test",
      items: [],
    };
    await writeFile(join(rexDir, "prd.json"), toCanonicalJSON(doc), "utf-8");
    await writeFile(join(rexDir, "prd.md"), `---\nschema: ${SCHEMA_VERSION}\n---\n\n# Integration Test\n`, "utf-8");
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "test", adapter: "file" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Test Workflow", "utf-8");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("full lifecycle keeps prd.md primary and prd.json synchronized", async () => {
    // Add an epic
    const epic: PRDItem = {
      id: "epic-1",
      title: "Auth System",
      status: "pending",
      level: "epic",
      priority: "high",
    };
    await store.addItem(epic);
    await expectCanonicalFilesInSync(rexDir);

    // Add a feature under the epic
    const feature: PRDItem = {
      id: "feat-1",
      title: "OAuth Flow",
      status: "pending",
      level: "feature",
    };
    await store.addItem(feature, "epic-1");
    await expectCanonicalFilesInSync(rexDir);

    // Add tasks under the feature
    const task1: PRDItem = {
      id: "task-1",
      title: "Implement token exchange",
      status: "pending",
      level: "task",
      priority: "critical",
      acceptanceCriteria: ["Tokens exchanged", "Errors handled"],
    };
    const task2: PRDItem = {
      id: "task-2",
      title: "Add refresh logic",
      status: "pending",
      level: "task",
      blockedBy: ["task-1"],
    };
    await store.addItem(task1, "feat-1");
    await store.addItem(task2, "feat-1");
    const afterAdd = await expectCanonicalFilesInSync(rexDir);

    // Read back the full document
    const doc = await store.loadDocument();
    expect(doc).toEqual(afterAdd);
    expect(doc.items.length).toBe(1);
    expect(doc.items[0].children!.length).toBe(1);
    expect(doc.items[0].children![0].children!.length).toBe(2);

    // Get individual item
    const retrieved = await store.getItem("task-1");
    expect(retrieved).not.toBeNull();
    expect(retrieved!.acceptanceCriteria).toEqual([
      "Tokens exchanged",
      "Errors handled",
    ]);

    // Update status
    await store.updateItem("task-1", { status: "completed" });
    await expectCanonicalFilesInSync(rexDir);
    const updated = await store.getItem("task-1");
    expect(updated!.status).toBe("completed");

    // Remove an item
    await store.removeItem("task-2");
    await expectCanonicalFilesInSync(rexDir);
    const afterRemove = await store.loadDocument();
    expect(afterRemove.items[0].children![0].children!.length).toBe(1);
  });

  it("passthrough preserves unknown fields", async () => {
    // Write doc with unknown fields directly
    const docWithExtras: PRDDocument = {
      schema: SCHEMA_VERSION,
      title: "Extended",
      items: [
        {
          id: "e1",
          title: "Epic",
          status: "pending",
          level: "epic",
          customMeta: { internal: true },
        } as PRDItem,
      ],
      projectMeta: "preserved",
    } as PRDDocument;
    await store.saveDocument(docWithExtras);
    await expectCanonicalFilesInSync(rexDir);

    const reloaded = await store.loadDocument();
    expect((reloaded as Record<string, unknown>).projectMeta).toBe("preserved");
    expect((reloaded.items[0] as Record<string, unknown>).customMeta).toEqual({
      internal: true,
    });
  });

  it("persists override marker metadata only when explicitly provided", async () => {
    await store.addItem({
      id: "epic-normal",
      title: "Normal Epic",
      status: "pending",
      level: "epic",
    });
    await expectCanonicalFilesInSync(rexDir);

    await store.addItem({
      id: "epic-force",
      title: "Force-created Epic",
      status: "pending",
      level: "epic",
      overrideMarker: {
        type: "duplicate_guard_override",
        reason: "exact_title",
        reasonRef: "exact_title:epic-existing",
        matchedItemId: "epic-existing",
        matchedItemTitle: "Existing Epic",
        matchedItemLevel: "epic",
        matchedItemStatus: "completed",
        createdAt: "2026-02-22T20:30:44.000Z",
      },
    });

    const normal = await store.getItem("epic-normal");
    const forceCreated = await store.getItem("epic-force");

    expect(normal?.overrideMarker).toBeUndefined();
    expect(forceCreated?.overrideMarker).toEqual({
      type: "duplicate_guard_override",
      reason: "exact_title",
      reasonRef: "exact_title:epic-existing",
      matchedItemId: "epic-existing",
      matchedItemTitle: "Existing Epic",
      matchedItemLevel: "epic",
      matchedItemStatus: "completed",
      createdAt: "2026-02-22T20:30:44.000Z",
    });
  });

  it("log append and read", async () => {
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "session_start",
    });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "item_added",
      itemId: "e1",
      detail: "Added epic",
    });
    await store.appendLog({
      timestamp: new Date().toISOString(),
      event: "session_end",
    });

    const all = await store.readLog();
    expect(all.length).toBe(3);

    const last2 = await store.readLog(2);
    expect(last2.length).toBe(2);
    expect(last2[0].event).toBe("item_added");
    expect(last2[1].event).toBe("session_end");
  });

  it("log entries are returned in chronological order", async () => {
    const t1 = "2024-01-01T00:00:00Z";
    const t2 = "2024-01-01T01:00:00Z";
    const t3 = "2024-01-01T02:00:00Z";

    await store.appendLog({ timestamp: t1, event: "first" });
    await store.appendLog({ timestamp: t2, event: "second" });
    await store.appendLog({ timestamp: t3, event: "third" });

    const entries = await store.readLog();
    expect(entries[0].event).toBe("first");
    expect(entries[1].event).toBe("second");
    expect(entries[2].event).toBe("third");
    expect(entries[0].timestamp).toBe(t1);
    expect(entries[2].timestamp).toBe(t3);
  });

  it("log validates entries before persisting", async () => {
    await expect(
      store.appendLog({ event: "missing_timestamp" } as never),
    ).rejects.toThrow("Invalid log entry");
  });

  it("document save validates before persisting", async () => {
    const badDoc = {
      schema: SCHEMA_VERSION,
      title: "Bad",
      items: [
        {
          id: "t1",
          title: "Task",
          status: "bad_status",
          level: "task",
        },
      ],
    } as unknown as PRDDocument;
    await expect(store.saveDocument(badDoc)).rejects.toThrow("Invalid document");
  });

  it("migrates from prd.json and continues reading from prd.md", async () => {
    await unlink(join(rexDir, "prd.md"));

    const doc = await store.loadDocument();
    expect(doc.title).toBe("Integration Test");

    const migrated = await readMarkdownDoc(rexDir);
    expect(migrated).toEqual(await readJsonDoc(rexDir));

    await writeFile(
      join(rexDir, "prd.json"),
      toCanonicalJSON({
        schema: SCHEMA_VERSION,
        title: "Corrupted JSON Should Be Ignored",
        items: [{ id: "json-only", title: "JSON only", status: "pending", level: "epic" }],
      }),
      "utf-8",
    );

    const secondRead = await store.loadDocument();
    expect(secondRead).toEqual(migrated);
    expect(secondRead.title).toBe("Integration Test");
  });

  it("serializes rapid single-file mutations without corrupting markdown", async () => {
    await store.addItem({
      id: "epic-1",
      title: "Concurrent Epic",
      status: "pending",
      level: "epic",
    });

    await Promise.all([
      store.updateItem("epic-1", { title: "Concurrent Epic Updated" }),
      store.addItem({
        id: "epic-2",
        title: "Second Epic",
        status: "pending",
        level: "epic",
      }),
    ]);

    const synced = await expectCanonicalFilesInSync(rexDir);
    expect(synced.items).toHaveLength(2);
    expect(synced.items.map((item) => item.id).sort()).toEqual(["epic-1", "epic-2"]);
    expect(synced.items.find((item) => item.id === "epic-1")?.title).toBe("Concurrent Epic Updated");
  });

  it("loads and round-trips workflow content", async () => {
    const workflow = await store.loadWorkflow();
    expect(workflow).toBe("# Test Workflow");

    const updatedWorkflow = "# Updated Workflow\n\n1. Step one\n2. Step two\n";
    await store.saveWorkflow(updatedWorkflow);

    const reloaded = await store.loadWorkflow();
    expect(reloaded).toBe(updatedWorkflow);
  });

  it("loads and round-trips config", async () => {
    const config = await store.loadConfig();
    expect(config.schema).toBe(SCHEMA_VERSION);
    expect(config.project).toBe("test");
    expect(config.adapter).toBe("file");
  });

  it("loads config with local file overrides", async () => {
    // Write .n-dx.json with rex overrides
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        rex: {
          project: "overridden-project",
          validate: "pnpm build && pnpm typecheck",
          test: "pnpm test",
        },
      }, null, 2) + "\n",
    );

    const config = await store.loadConfig();
    expect(config.project).toBe("overridden-project");
    expect(config.validate).toBe("pnpm build && pnpm typecheck");
    expect(config.test).toBe("pnpm test");
    // Non-overridden values remain
    expect(config.adapter).toBe("file");
  });

  it("reads empty log when no log file exists", async () => {
    // Create a fresh store without the log file
    const tmpDir2 = await mkdtemp(join(tmpdir(), "rex-integ-nolog-"));
    const rexDir2 = join(tmpDir2, ".rex");
    await ensureRexDir(rexDir2);
    const store2 = createStore("file", rexDir2);

    await writeFile(join(rexDir2, "prd.json"), toCanonicalJSON({
      schema: SCHEMA_VERSION,
      title: "Test",
      items: [],
    }), "utf-8");

    const entries = await store2.readLog();
    expect(entries).toEqual([]);

    await rm(tmpDir2, { recursive: true, force: true });
  });

  it("reports file adapter capabilities", () => {
    const caps = store.capabilities();
    expect(caps.adapter).toBe("file");
    expect(caps.supportsTransactions).toBe(true);
    expect(caps.supportsWatch).toBe(false);
  });
});
