/**
 * Unit tests for the Asana adapter (AsanaStore).
 *
 * The Asana HTTP layer is replaced by an in-memory MockAsanaClient, so these
 * tests exercise the full adapter + mapping logic without any network calls —
 * mirroring the approach in notion-adapter.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { AsanaStore, ensureAsanaRexDir } from "../../../src/store/asana-adapter.js";
import type {
  AsanaClient,
  AsanaTask,
  AsanaCreateParams,
  AsanaUpdateParams,
} from "../../../src/store/asana-client.js";

// ---------------------------------------------------------------------------
// In-memory mock client
// ---------------------------------------------------------------------------

class MockAsanaClient implements AsanaClient {
  tasks = new Map<string, AsanaTask>();
  private nextId = 1;

  async listTasks(_projectId: string): Promise<AsanaTask[]> {
    return [...this.tasks.values()];
  }

  async createTask(params: AsanaCreateParams): Promise<AsanaTask> {
    const gid = `asana-${this.nextId++}`;
    const task: AsanaTask = {
      gid,
      name: params.name,
      notes: params.notes,
      completed: params.completed ?? false,
      parent: params.parent ? { gid: params.parent } : null,
      external: params.external ?? null,
    };
    this.tasks.set(gid, task);
    return task;
  }

  async updateTask(gid: string, params: AsanaUpdateParams): Promise<AsanaTask> {
    const task = this.tasks.get(gid);
    if (!task) throw new Error(`Task not found: ${gid}`);
    if (params.name !== undefined) task.name = params.name;
    if (params.notes !== undefined) task.notes = params.notes;
    if (params.completed !== undefined) task.completed = params.completed;
    if (params.external !== undefined) task.external = params.external;
    return task;
  }

  async deleteTask(gid: string): Promise<void> {
    this.tasks.delete(gid);
  }

  /** Test helper: find a stored task by the PRD id in its external field. */
  byPrdId(prdId: string): AsanaTask | undefined {
    for (const task of this.tasks.values()) {
      if (task.external?.gid === prdId) return task;
    }
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function sampleDoc(): PRDDocument {
  return {
    schema: SCHEMA_VERSION,
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        status: "in_progress",
        level: "epic",
        description: "The first epic",
        priority: "high",
        children: [
          {
            id: "feat-1",
            title: "Feature One",
            status: "pending",
            level: "feature",
            children: [
              {
                id: "task-1",
                title: "Task One",
                status: "completed",
                level: "task",
                description: "Do the thing",
                acceptanceCriteria: ["Thing is done", "Tests pass"],
                priority: "medium",
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("AsanaStore", () => {
  let tmpDir: string;
  let rexDir: string;
  let client: MockAsanaClient;
  let store: AsanaStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-asana-"));
    rexDir = join(tmpDir, ".rex");
    await ensureAsanaRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "Test Project", adapter: "asana" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    client = new MockAsanaClient();
    store = new AsanaStore(rexDir, client, { token: "1/test", projectId: "12345" });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("round-trips a document tree through save/load", async () => {
    await store.saveDocument(sampleDoc());
    const loaded = await store.loadDocument();

    expect(loaded.title).toBe("Test Project");
    expect(loaded.items).toHaveLength(1);

    const epic = loaded.items[0];
    expect(epic.id).toBe("epic-1");
    expect(epic.title).toBe("Epic One");
    expect(epic.level).toBe("epic");
    expect(epic.status).toBe("in_progress");
    expect(epic.description).toBe("The first epic");
    expect(epic.priority).toBe("high");

    const feat = epic.children?.[0] as PRDItem;
    expect(feat.id).toBe("feat-1");
    expect(feat.level).toBe("feature");

    const task = feat.children?.[0] as PRDItem;
    expect(task.id).toBe("task-1");
    expect(task.level).toBe("task");
    expect(task.status).toBe("completed");
    expect(task.description).toBe("Do the thing");
    expect(task.acceptanceCriteria).toEqual(["Thing is done", "Tests pass"]);
    expect(task.priority).toBe("medium");
  });

  it("stores the PRD id in the task's external.gid", async () => {
    await store.saveDocument(sampleDoc());
    const epicTask = client.byPrdId("epic-1");
    expect(epicTask).toBeDefined();
    expect(epicTask?.external?.gid).toBe("epic-1");
    // Level/status/priority survive in external.data.
    const meta = JSON.parse(epicTask!.external!.data as string);
    expect(meta.level).toBe("epic");
    expect(meta.status).toBe("in_progress");
    expect(meta.priority).toBe("high");
  });

  it("maps completed status to the Asana completed flag", async () => {
    await store.saveDocument(sampleDoc());
    expect(client.byPrdId("task-1")?.completed).toBe(true);
    expect(client.byPrdId("epic-1")?.completed).toBe(false);
  });

  it("attaches subtasks to their parent task via parent gid", async () => {
    await store.saveDocument(sampleDoc());
    const epicTask = client.byPrdId("epic-1");
    const featTask = client.byPrdId("feat-1");
    expect(featTask?.parent?.gid).toBe(epicTask?.gid);
  });

  it("updates existing tasks without creating duplicates", async () => {
    await store.saveDocument(sampleDoc());
    const countAfterFirst = client.tasks.size;

    const doc = sampleDoc();
    doc.items[0].title = "Epic One (renamed)";
    await store.saveDocument(doc);

    expect(client.tasks.size).toBe(countAfterFirst);
    expect(client.byPrdId("epic-1")?.name).toBe("Epic One (renamed)");
  });

  it("deletes tasks that no longer exist in the document", async () => {
    await store.saveDocument(sampleDoc());
    expect(client.byPrdId("task-1")).toBeDefined();

    const doc = sampleDoc();
    // Drop the task from the tree.
    doc.items[0].children![0].children = [];
    await store.saveDocument(doc);

    expect(client.byPrdId("task-1")).toBeUndefined();
  });

  it("getItem resolves an item by PRD id", async () => {
    await store.saveDocument(sampleDoc());
    const item = await store.getItem("feat-1");
    expect(item?.title).toBe("Feature One");
    expect(await store.getItem("does-not-exist")).toBeNull();
  });

  it("addItem creates a subtask under an existing parent", async () => {
    await store.saveDocument(sampleDoc());
    const subtask: PRDItem = {
      id: "sub-1",
      title: "Subtask One",
      status: "pending",
      level: "subtask",
    };
    await store.addItem(subtask, "task-1");

    const created = client.byPrdId("sub-1");
    expect(created).toBeDefined();
    expect(created?.parent?.gid).toBe(client.byPrdId("task-1")?.gid);
  });

  it("addItem rejects an unknown parent", async () => {
    await store.saveDocument(sampleDoc());
    const orphan: PRDItem = { id: "x", title: "X", status: "pending", level: "task" };
    await expect(store.addItem(orphan, "nope")).rejects.toThrow(/not found/);
  });

  it("updateItem edits an existing task", async () => {
    await store.saveDocument(sampleDoc());
    await store.updateItem("feat-1", { status: "completed" });
    expect(client.byPrdId("feat-1")?.completed).toBe(true);
  });

  it("removeItem deletes the task", async () => {
    await store.saveDocument(sampleDoc());
    await store.removeItem("epic-1");
    expect(client.byPrdId("epic-1")).toBeUndefined();
  });

  it("reconstructs foreign tasks (no external metadata) by depth and completed flag", async () => {
    // Simulate a task created directly in the Asana UI.
    client.tasks.set("raw-1", {
      gid: "raw-1",
      name: "Manually created",
      notes: "Some notes",
      completed: true,
      parent: null,
      external: null,
    });

    const loaded = await store.loadDocument();
    const item = loaded.items.find((i) => i.title === "Manually created");
    expect(item).toBeDefined();
    expect(item?.id).toBe("raw-1"); // falls back to the Asana gid
    expect(item?.level).toBe("epic"); // depth 0
    expect(item?.status).toBe("completed"); // from completed flag
    expect(item?.description).toBe("Some notes");
  });

  it("reports asana as its adapter", () => {
    expect(store.capabilities().adapter).toBe("asana");
  });
});
