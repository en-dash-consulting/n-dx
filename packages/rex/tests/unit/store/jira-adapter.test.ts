/**
 * Unit tests for the Jira adapter (JiraStore).
 *
 * The Jira REST layer is replaced by an in-memory MockJiraClient, so these
 * tests exercise the full adapter + mapping logic without network calls —
 * mirroring asana-adapter.test.ts / github-projects-adapter.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import { JiraStore, ensureJiraRexDir } from "../../../src/store/jira-adapter.js";
import type {
  JiraClient,
  JiraIssue,
  JiraCreateParams,
  JiraUpdateParams,
} from "../../../src/store/jira-client.js";

// ---------------------------------------------------------------------------
// In-memory mock client
// ---------------------------------------------------------------------------

class MockJiraClient implements JiraClient {
  issues = new Map<string, JiraIssue>(); // keyed by key
  createCalls: JiraCreateParams[] = [];
  private nextId = 1;

  async listIssues(_projectKey: string): Promise<JiraIssue[]> {
    return [...this.issues.values()];
  }

  async createIssue(params: JiraCreateParams): Promise<JiraIssue> {
    this.createCalls.push(params);
    const key = `${params.projectKey}-${this.nextId++}`;
    const issue: JiraIssue = {
      key,
      summary: params.summary,
      description: params.description,
      labels: params.labels ?? [],
    };
    this.issues.set(key, issue);
    return issue;
  }

  async updateIssue(key: string, params: JiraUpdateParams): Promise<void> {
    const issue = this.issues.get(key);
    if (!issue) throw new Error(`Issue not found: ${key}`);
    issue.summary = params.summary;
    issue.description = params.description;
    if (params.labels) issue.labels = params.labels;
  }

  async deleteIssue(key: string): Promise<void> {
    this.issues.delete(key);
  }

  /** Test helper: find a stored issue by the PRD id in its description footer. */
  byPrdId(prdId: string): JiraIssue | undefined {
    for (const issue of this.issues.values()) {
      const m = issue.description.match(/<!--\s*n-dx-meta:\s*([\s\S]*?)-->/);
      if (m && JSON.parse(m[1].trim()).id === prdId) return issue;
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
        tags: ["platform", "q3 roadmap"],
        children: [
          {
            id: "feat-1",
            title: "Feature One",
            status: "blocked",
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

describe("JiraStore", () => {
  let tmpDir: string;
  let rexDir: string;
  let client: MockJiraClient;
  let store: JiraStore;

  const baseConfig = {
    domain: "acme.atlassian.net",
    email: "me@acme.com",
    apiToken: "tok",
    projectKey: "PRD",
    issueType: "Task",
    syncLabels: true,
  };

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-jira-"));
    rexDir = join(tmpDir, ".rex");
    await ensureJiraRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "Test Project", adapter: "jira" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    client = new MockJiraClient();
    store = new JiraStore(rexDir, client, baseConfig);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("round-trips a document tree through save/load", async () => {
    await store.saveDocument(sampleDoc());
    const loaded = await store.loadDocument();

    expect(loaded.title).toBe("Test Project");
    const epic = loaded.items[0];
    expect(epic.id).toBe("epic-1");
    expect(epic.level).toBe("epic");
    expect(epic.status).toBe("in_progress");
    expect(epic.description).toBe("The first epic");
    expect(epic.priority).toBe("high");
    expect(epic.tags).toEqual(["platform", "q3 roadmap"]);

    const feat = epic.children?.[0] as PRDItem;
    expect(feat.id).toBe("feat-1");
    expect(feat.level).toBe("feature");
    expect(feat.status).toBe("blocked");

    const task = feat.children?.[0] as PRDItem;
    expect(task.id).toBe("task-1");
    expect(task.status).toBe("completed");
    expect(task.acceptanceCriteria).toEqual(["Thing is done", "Tests pass"]);
  });

  it("creates issues with the configured project key and issue type", async () => {
    await store.saveDocument(sampleDoc());
    expect(client.createCalls.length).toBe(3);
    for (const call of client.createCalls) {
      expect(call.projectKey).toBe("PRD");
      expect(call.issueType).toBe("Task");
    }
  });

  it("encodes PRD id and parentId in the description footer", async () => {
    await store.saveDocument(sampleDoc());
    const feat = client.byPrdId("feat-1");
    const meta = JSON.parse(feat!.description.match(/<!--\s*n-dx-meta:\s*([\s\S]*?)-->/)![1].trim());
    expect(meta.id).toBe("feat-1");
    expect(meta.parentId).toBe("epic-1");
    expect(meta.level).toBe("feature");
  });

  it("renders human-readable description and acceptance criteria", async () => {
    await store.saveDocument(sampleDoc());
    const task = client.byPrdId("task-1");
    expect(task?.description).toContain("Do the thing");
    expect(task?.description).toContain("## Acceptance Criteria");
    expect(task?.description).toContain("- [ ] Thing is done");
  });

  it("writes sanitized PRD tags as Jira labels when syncLabels is on", async () => {
    await store.saveDocument(sampleDoc());
    const epic = client.byPrdId("epic-1");
    // "q3 roadmap" -> "q3-roadmap" (Jira labels cannot contain spaces).
    expect(epic?.labels).toEqual(["platform", "q3-roadmap"]);
  });

  it("omits labels when syncLabels is disabled", async () => {
    const noLabels = new JiraStore(rexDir, new MockJiraClient(), { ...baseConfig, syncLabels: false });
    await noLabels.saveDocument(sampleDoc());
    const loaded = await noLabels.loadDocument();
    // Tags still round-trip via the footer even though labels weren't written.
    expect(loaded.items[0].tags).toEqual(["platform", "q3 roadmap"]);
  });

  it("updates existing issues without creating duplicates", async () => {
    await store.saveDocument(sampleDoc());
    const count = client.issues.size;

    const doc = sampleDoc();
    doc.items[0].title = "Epic One (renamed)";
    await store.saveDocument(doc);

    expect(client.issues.size).toBe(count);
    expect(client.byPrdId("epic-1")?.summary).toBe("Epic One (renamed)");
  });

  it("deletes issues that no longer exist in the document", async () => {
    await store.saveDocument(sampleDoc());
    expect(client.byPrdId("task-1")).toBeDefined();

    const doc = sampleDoc();
    doc.items[0].children![0].children = [];
    await store.saveDocument(doc);

    expect(client.byPrdId("task-1")).toBeUndefined();
  });

  it("getItem resolves an item by PRD id", async () => {
    await store.saveDocument(sampleDoc());
    expect((await store.getItem("feat-1"))?.title).toBe("Feature One");
    expect(await store.getItem("nope")).toBeNull();
  });

  it("addItem creates an item under an existing parent", async () => {
    await store.saveDocument(sampleDoc());
    await store.addItem(
      { id: "sub-1", title: "Subtask One", status: "pending", level: "subtask" },
      "task-1",
    );
    const loaded = await store.loadDocument();
    const task = loaded.items[0].children![0].children![0];
    expect(task.children?.some((c) => c.id === "sub-1")).toBe(true);
  });

  it("addItem rejects an unknown parent", async () => {
    await store.saveDocument(sampleDoc());
    await expect(
      store.addItem({ id: "x", title: "X", status: "pending", level: "task" }, "nope"),
    ).rejects.toThrow(/not found/);
  });

  it("updateItem edits an existing issue and preserves its parent link", async () => {
    await store.saveDocument(sampleDoc());
    await store.updateItem("feat-1", { status: "completed" });
    const loaded = await store.loadDocument();
    const feat = loaded.items[0].children?.[0];
    expect(feat?.id).toBe("feat-1");
    expect(feat?.status).toBe("completed");
  });

  it("removeItem deletes the issue", async () => {
    await store.saveDocument(sampleDoc());
    await store.removeItem("epic-1");
    expect(client.byPrdId("epic-1")).toBeUndefined();
  });

  it("reconstructs foreign issues (no footer) as root items by depth", async () => {
    client.issues.set("PRD-99", {
      key: "PRD-99",
      summary: "Manually created",
      description: "Just a plain issue description",
      labels: [],
    });
    const loaded = await store.loadDocument();
    const item = loaded.items.find((i) => i.title === "Manually created");
    expect(item?.id).toBe("PRD-99"); // falls back to the issue key
    expect(item?.level).toBe("epic"); // depth 0
    expect(item?.status).toBe("pending");
    expect(item?.description).toBe("Just a plain issue description");
  });

  it("reports jira as its adapter", () => {
    expect(store.capabilities().adapter).toBe("jira");
  });
});
