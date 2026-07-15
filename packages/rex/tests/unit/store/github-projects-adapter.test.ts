/**
 * Unit tests for the GitHub Projects adapter (GitHubProjectsStore).
 *
 * The GraphQL layer is replaced by an in-memory MockGitHubProjectsClient, so
 * these tests exercise the full adapter + mapping logic without network calls —
 * mirroring the approach in asana-adapter.test.ts / notion-adapter.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import {
  GitHubProjectsStore,
  ensureGitHubProjectsRexDir,
} from "../../../src/store/github-projects-adapter.js";
import type {
  GitHubProjectsClient,
  GitHubProjectItem,
  DraftContent,
} from "../../../src/store/github-projects-client.js";

// ---------------------------------------------------------------------------
// In-memory mock client
// ---------------------------------------------------------------------------

class MockGitHubProjectsClient implements GitHubProjectsClient {
  items = new Map<string, GitHubProjectItem>(); // keyed by contentId
  private nextId = 1;

  async listItems(_projectId: string): Promise<GitHubProjectItem[]> {
    return [...this.items.values()];
  }

  async createDraftItem(_projectId: string, content: DraftContent): Promise<GitHubProjectItem> {
    const n = this.nextId++;
    const item: GitHubProjectItem = {
      itemId: `PVTI_${n}`,
      contentId: `DI_${n}`,
      title: content.title,
      body: content.body,
    };
    this.items.set(item.contentId, item);
    return item;
  }

  async updateDraftItem(contentId: string, content: DraftContent): Promise<GitHubProjectItem> {
    const item = this.items.get(contentId);
    if (!item) throw new Error(`Draft not found: ${contentId}`);
    item.title = content.title;
    item.body = content.body;
    return item;
  }

  async deleteItem(_projectId: string, itemId: string): Promise<void> {
    for (const [key, item] of this.items) {
      if (item.itemId === itemId) {
        this.items.delete(key);
        return;
      }
    }
  }

  /** Test helper: find a stored item by the PRD id in its body footer. */
  byPrdId(prdId: string): GitHubProjectItem | undefined {
    for (const item of this.items.values()) {
      const m = item.body.match(/<!--\s*n-dx-meta:\s*([\s\S]*?)-->/);
      if (m && JSON.parse(m[1].trim()).id === prdId) return item;
    }
    return undefined;
  }
}

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
            status: "blocked",
            level: "feature",
            tags: ["ui"],
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

describe("GitHubProjectsStore", () => {
  let tmpDir: string;
  let rexDir: string;
  let client: MockGitHubProjectsClient;
  let store: GitHubProjectsStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-github-"));
    rexDir = join(tmpDir, ".rex");
    await ensureGitHubProjectsRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "Test Project", adapter: "github" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    client = new MockGitHubProjectsClient();
    store = new GitHubProjectsStore(rexDir, client, { token: "ghp_test", projectId: "PVT_abc" });
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
    expect(epic.level).toBe("epic");
    expect(epic.status).toBe("in_progress");
    expect(epic.description).toBe("The first epic");
    expect(epic.priority).toBe("high");

    const feat = epic.children?.[0] as PRDItem;
    expect(feat.id).toBe("feat-1");
    expect(feat.level).toBe("feature");
    expect(feat.status).toBe("blocked");
    expect(feat.tags).toEqual(["ui"]);

    const task = feat.children?.[0] as PRDItem;
    expect(task.id).toBe("task-1");
    expect(task.level).toBe("task");
    expect(task.status).toBe("completed");
    expect(task.acceptanceCriteria).toEqual(["Thing is done", "Tests pass"]);
  });

  it("encodes PRD id and parentId in the draft-issue footer", async () => {
    await store.saveDocument(sampleDoc());
    const featItem = client.byPrdId("feat-1");
    expect(featItem).toBeDefined();
    const meta = JSON.parse(
      featItem!.body.match(/<!--\s*n-dx-meta:\s*([\s\S]*?)-->/)![1].trim(),
    );
    expect(meta.id).toBe("feat-1");
    expect(meta.parentId).toBe("epic-1");
    expect(meta.level).toBe("feature");
  });

  it("renders human-readable description and acceptance criteria in the body", async () => {
    await store.saveDocument(sampleDoc());
    const taskItem = client.byPrdId("task-1");
    expect(taskItem?.body).toContain("Do the thing");
    expect(taskItem?.body).toContain("## Acceptance Criteria");
    expect(taskItem?.body).toContain("- [ ] Thing is done");
  });

  it("updates existing draft issues without creating duplicates", async () => {
    await store.saveDocument(sampleDoc());
    const countAfterFirst = client.items.size;

    const doc = sampleDoc();
    doc.items[0].title = "Epic One (renamed)";
    await store.saveDocument(doc);

    expect(client.items.size).toBe(countAfterFirst);
    expect(client.byPrdId("epic-1")?.title).toBe("Epic One (renamed)");
  });

  it("deletes items that no longer exist in the document", async () => {
    await store.saveDocument(sampleDoc());
    expect(client.byPrdId("task-1")).toBeDefined();

    const doc = sampleDoc();
    doc.items[0].children![0].children = [];
    await store.saveDocument(doc);

    expect(client.byPrdId("task-1")).toBeUndefined();
  });

  it("getItem resolves an item by PRD id", async () => {
    await store.saveDocument(sampleDoc());
    const item = await store.getItem("feat-1");
    expect(item?.title).toBe("Feature One");
    expect(await store.getItem("nope")).toBeNull();
  });

  it("addItem creates an item under an existing parent", async () => {
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
    const meta = JSON.parse(created!.body.match(/<!--\s*n-dx-meta:\s*([\s\S]*?)-->/)![1].trim());
    expect(meta.parentId).toBe("task-1");

    // And it appears nested under task-1 on reload.
    const loaded = await store.loadDocument();
    const task = loaded.items[0].children![0].children![0];
    expect(task.children?.some((c) => c.id === "sub-1")).toBe(true);
  });

  it("addItem rejects an unknown parent", async () => {
    await store.saveDocument(sampleDoc());
    const orphan: PRDItem = { id: "x", title: "X", status: "pending", level: "task" };
    await expect(store.addItem(orphan, "nope")).rejects.toThrow(/not found/);
  });

  it("updateItem edits an existing item and preserves its parent link", async () => {
    await store.saveDocument(sampleDoc());
    await store.updateItem("feat-1", { status: "completed" });

    const loaded = await store.loadDocument();
    const feat = loaded.items[0].children?.[0];
    expect(feat?.id).toBe("feat-1");
    expect(feat?.status).toBe("completed");
  });

  it("removeItem deletes the item", async () => {
    await store.saveDocument(sampleDoc());
    await store.removeItem("epic-1");
    expect(client.byPrdId("epic-1")).toBeUndefined();
  });

  it("reconstructs foreign draft issues (no footer) as root items by depth", async () => {
    client.items.set("DI_raw", {
      itemId: "PVTI_raw",
      contentId: "DI_raw",
      title: "Manually created",
      body: "Just a plain draft issue body",
    });

    const loaded = await store.loadDocument();
    const item = loaded.items.find((i) => i.title === "Manually created");
    expect(item).toBeDefined();
    expect(item?.id).toBe("DI_raw"); // falls back to content id
    expect(item?.level).toBe("epic"); // depth 0
    expect(item?.status).toBe("pending");
    expect(item?.description).toBe("Just a plain draft issue body");
  });

  it("reports github as its adapter", () => {
    expect(store.capabilities().adapter).toBe("github");
  });
});
