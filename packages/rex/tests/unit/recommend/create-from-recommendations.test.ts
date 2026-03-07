import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

/**
 * Create a minimal fixture project with .rex/ and empty PRD.
 */
async function writeFixtureProject(
  dir: string,
  items: PRDItem[] = [],
): Promise<void> {
  await mkdir(join(dir, ".rex"), { recursive: true });

  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test-project",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "test-project",
      items,
    }),
    "utf-8",
  );
}

async function readPrd(dir: string): Promise<PRDDocument> {
  const raw = await readFile(join(dir, ".rex", "prd.json"), "utf-8");
  return JSON.parse(raw) as PRDDocument;
}

async function readLog(dir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(dir, ".rex", "execution-log.jsonl"), "utf-8");
    return raw.trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

describe("createItemsFromRecommendations", () => {
  let tmpDir: string;
  let createItemsFromRecommendations: typeof import("../../../src/recommend/create-from-recommendations.js")["createItemsFromRecommendations"];
  let resolveStore: typeof import("../../../src/store/index.js")["resolveStore"];

  beforeEach(async () => {
    vi.resetModules();
    vi.doMock("@n-dx/llm-client", () => ({
      PROJECT_DIRS: {
        REX: ".rex",
        SOURCEVISION: ".sourcevision",
      },
      formatUsage: () => "",
      toCanonicalJSON: (value: unknown) => JSON.stringify(value, null, 2),
      result: () => {},
      info: () => {},
      setQuiet: () => {},
      isQuiet: () => false,
    }));

    ({ createItemsFromRecommendations } = await import(
      "../../../src/recommend/create-from-recommendations.js"
    ));
    ({ resolveStore } = await import("../../../src/store/index.js"));

    tmpDir = await mkdtemp(join(tmpdir(), "rex-create-rec-test-"));
  });

  afterEach(async () => {
    vi.doUnmock("@n-dx/llm-client");
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Empty input ─────────────────────────────────────────────────────

  it("returns empty result for zero recommendations", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, []);

    expect(result.created).toHaveLength(0);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  // ── Basic creation ──────────────────────────────────────────────────

  it("creates a single epic from a recommendation", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Improve auth system",
        level: "epic",
        description: "Multiple auth issues found",
        priority: "critical",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].title).toBe("Improve auth system");
    expect(result.created[0].level).toBe("epic");

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].title).toBe("Improve auth system");
    expect(doc.items[0].status).toBe("pending");
    expect(doc.items[0].priority).toBe("critical");
    expect(doc.items[0].source).toBe("sourcevision");
  });

  it("creates multiple items atomically", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Address auth issues",
        level: "epic",
        description: "Auth findings",
        priority: "critical",
        source: "sourcevision",
      },
      {
        title: "Address perf issues",
        level: "epic",
        description: "Perf findings",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Address security issues",
        level: "epic",
        description: "Security findings",
        priority: "medium",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(3);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(3);
    expect(doc.items[0].title).toBe("Address auth issues");
    expect(doc.items[1].title).toBe("Address perf issues");
    expect(doc.items[2].title).toBe("Address security issues");
  });

  // ── Metadata preservation ───────────────────────────────────────────

  it("preserves recommendation metadata and quality scores on created items", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Address auth issues",
        level: "epic",
        description: "Auth findings",
        priority: "critical",
        source: "sourcevision",
        tags: ["auth", "security"],
        meta: {
          findingHashes: ["abc123", "def456"],
          category: "auth",
          severityDistribution: { critical: 1, warning: 1 },
          findingCount: 2,
        },
      },
    ]);

    const doc = await readPrd(tmpDir);
    const item = doc.items[0];

    expect(item.source).toBe("sourcevision");
    expect(item.priority).toBe("critical");
    expect(item.tags).toEqual(["auth", "security"]);

    // Recommendation metadata
    const meta = item.recommendationMeta as {
      findingHashes: string[];
      category: string;
      severityDistribution: Record<string, number>;
      findingCount: number;
    };
    expect(meta).toBeDefined();
    expect(meta.findingHashes).toEqual(["abc123", "def456"]);
    expect(meta.category).toBe("auth");
    expect(meta.severityDistribution).toEqual({ critical: 1, warning: 1 });
    expect(meta.findingCount).toBe(2);
  });

  it("omits recommendationMeta when no meta is provided", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Simple recommendation",
        level: "epic",
        description: "No meta",
        priority: "low",
        source: "manual",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].recommendationMeta).toBeUndefined();
  });

  // ── Parent-child creation ───────────────────────────────────────────

  it("creates items under an existing parent", async () => {
    const epicId = "existing-epic-id";
    await writeFixtureProject(tmpDir, [
      {
        id: epicId,
        title: "Existing Epic",
        status: "pending",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "New feature under epic",
        level: "feature",
        description: "A feature recommendation",
        priority: "high",
        source: "sourcevision",
        parentId: epicId,
      },
    ]);

    expect(result.created).toHaveLength(1);
    expect(result.created[0].parentId).toBe(epicId);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1); // Still one root item
    expect(doc.items[0].children).toHaveLength(1);
    expect(doc.items[0].children![0].title).toBe("New feature under epic");
  });

  it("creates task under an existing feature", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature",
            status: "pending",
            level: "feature",
          },
        ],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "New task under feature",
        level: "task",
        description: "A task recommendation",
        priority: "medium",
        source: "sourcevision",
        parentId: "feature-1",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items[0].children![0].children).toHaveLength(1);
    expect(doc.items[0].children![0].children![0].title).toBe("New task under feature");
  });

  it("creates subtask under an existing task", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature",
            status: "pending",
            level: "feature",
            children: [
              {
                id: "task-1",
                title: "Task",
                status: "pending",
                level: "task",
              },
            ],
          },
        ],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "New subtask",
        level: "subtask",
        description: "A subtask recommendation",
        priority: "low",
        source: "sourcevision",
        parentId: "task-1",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    const subtask = doc.items[0].children![0].children![0].children![0];
    expect(subtask.title).toBe("New subtask");
    expect(subtask.level).toBe("subtask");
  });

  it("creates multiple children under the same parent", async () => {
    const epicId = "epic-1";
    await writeFixtureProject(tmpDir, [
      {
        id: epicId,
        title: "Existing Epic",
        status: "pending",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Feature A",
        level: "feature",
        description: "First feature",
        priority: "high",
        source: "sourcevision",
        parentId: epicId,
      },
      {
        title: "Feature B",
        level: "feature",
        description: "Second feature",
        priority: "medium",
        source: "sourcevision",
        parentId: epicId,
      },
    ]);

    expect(result.created).toHaveLength(2);
    const doc = await readPrd(tmpDir);
    expect(doc.items[0].children).toHaveLength(2);
    expect(doc.items[0].children![0].title).toBe("Feature A");
    expect(doc.items[0].children![1].title).toBe("Feature B");
  });

  // ── Validation: parent not found ────────────────────────────────────

  it("throws when parent ID does not exist", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Orphan feature",
          level: "feature",
          description: "No parent exists",
          priority: "high",
          source: "sourcevision",
          parentId: "nonexistent-parent",
        },
      ]),
    ).rejects.toThrow(/Parent "nonexistent-parent" not found/);

    // Verify nothing was created (atomic rollback)
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  // ── Validation: level hierarchy ─────────────────────────────────────

  it("throws when child level is invalid for the parent level", async () => {
    const taskId = "existing-task-id";
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature",
            status: "pending",
            level: "feature",
            children: [
              {
                id: taskId,
                title: "Task",
                status: "pending",
                level: "task",
              },
            ],
          },
        ],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Try to add a feature under a task (invalid per hierarchy)
    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Feature under task",
          level: "feature",
          description: "Invalid placement",
          priority: "high",
          source: "sourcevision",
          parentId: taskId,
        },
      ]),
    ).rejects.toThrow(/must be a child of a epic/);
  });

  it("throws when a subtask is added without a parent", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Subtask at root",
          level: "subtask",
          description: "Cannot be root",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/requires a parent/);
  });

  it("allows features at root level (recommendation workflow)", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Features from sourcevision recommendations are typically added at root
    const result = await createItemsFromRecommendations(store, [
      {
        title: "Address auth issues (3 findings)",
        level: "feature",
        description: "- Auth finding A\n- Auth finding B",
        priority: "critical",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].level).toBe("feature");
  });

  it("allows tasks at root level (recommendation workflow)", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Fix critical bug",
        level: "task",
        description: "Task at root",
        priority: "critical",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1);
    expect(doc.items[0].level).toBe("task");
  });

  it("throws when epic is placed under a feature (wrong hierarchy)", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature",
            status: "pending",
            level: "feature",
          },
        ],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Epic's LEVEL_HIERARCHY only allows null (root), so placing under
    // a feature should fail. The error comes from the insertion step
    // since epic's allowedParentLevels is empty after filtering null.
    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Nested epic",
          level: "epic",
          description: "Invalid",
          priority: "high",
          source: "sourcevision",
          parentId: "feature-1",
        },
      ]),
    ).rejects.toThrow(/Failed to insert "Nested epic" under parent "feature-1"/);
  });

  it("throws when subtask is placed under a feature (skipping task level)", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
        children: [
          {
            id: "feature-1",
            title: "Feature",
            status: "pending",
            level: "feature",
          },
        ],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Subtask under feature",
          level: "subtask",
          description: "Invalid: subtask needs task parent",
          priority: "low",
          source: "sourcevision",
          parentId: "feature-1",
        },
      ]),
    ).rejects.toThrow(/must be a child of a task/);
  });

  // ── Atomicity ───────────────────────────────────────────────────────

  it("creates zero items when validation fails for any item in the batch", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Mix of valid and invalid items
    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Valid epic",
          level: "epic",
          description: "This is fine",
          priority: "high",
          source: "sourcevision",
        },
        {
          title: "Invalid subtask at root",
          level: "subtask",
          description: "This should fail",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/requires a parent/);

    // Verify NOTHING was created — atomic rollback
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  it("rolls back all items when the last item in a batch fails validation", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Valid epic 1",
          level: "epic",
          description: "OK",
          priority: "high",
          source: "sourcevision",
        },
        {
          title: "Valid epic 2",
          level: "epic",
          description: "OK",
          priority: "medium",
          source: "sourcevision",
        },
        {
          title: "Invalid subtask at root",
          level: "subtask",
          description: "Fails",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/requires a parent/);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(0);
  });

  it("does not write log entries when batch fails validation", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Valid epic",
          level: "epic",
          description: "OK",
          priority: "high",
          source: "sourcevision",
        },
        {
          title: "Invalid subtask at root",
          level: "subtask",
          description: "Fails",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow();

    const logLines = await readLog(tmpDir);
    expect(logLines).toHaveLength(0);
  });

  // ── Logging ─────────────────────────────────────────────────────────

  it("logs item_added events for each created item", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Auth epic",
        level: "epic",
        description: "Auth findings",
        priority: "critical",
        source: "sourcevision",
      },
      {
        title: "Perf epic",
        level: "epic",
        description: "Perf findings",
        priority: "high",
        source: "sourcevision",
      },
    ]);

    const logLines = await readLog(tmpDir);
    expect(logLines).toHaveLength(2);

    const entries = logLines.map((l) => JSON.parse(l));
    expect(entries[0].event).toBe("item_added");
    expect(entries[0].detail).toContain("Auth epic");
    expect(entries[0].detail).toContain("from recommendation");
    expect(entries[1].event).toBe("item_added");
    expect(entries[1].detail).toContain("Perf epic");
  });

  it("logs include the item ID", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Logged item",
        level: "epic",
        description: "Test",
        priority: "medium",
        source: "sourcevision",
      },
    ]);

    const logLines = await readLog(tmpDir);
    const entry = JSON.parse(logLines[0]);
    expect(entry.itemId).toBe(result.created[0].id);
  });

  it("log entries have valid ISO timestamps", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Timestamped",
        level: "epic",
        description: "Test",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const logLines = await readLog(tmpDir);
    const entry = JSON.parse(logLines[0]);
    expect(entry.timestamp).toBeDefined();
    // Should be a valid ISO date
    const date = new Date(entry.timestamp);
    expect(date.getTime()).not.toBeNaN();
  });

  // ── Preserves existing items ────────────────────────────────────────

  it("preserves existing PRD items when adding recommendations", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "existing-1",
        title: "Existing Epic",
        status: "in_progress",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "New recommendation",
        level: "epic",
        description: "From sourcevision",
        priority: "high",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(2);
    expect(doc.items[0].id).toBe("existing-1");
    expect(doc.items[0].title).toBe("Existing Epic");
    expect(doc.items[1].title).toBe("New recommendation");
  });

  it("preserves existing item statuses when adding recommendations", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "in-progress-item",
        title: "In Progress",
        status: "in_progress",
        level: "epic",
      },
      {
        id: "completed-item",
        title: "Completed",
        status: "completed",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "New recommendation",
        level: "epic",
        description: "New",
        priority: "high",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(3);
    expect(doc.items[0].status).toBe("in_progress");
    expect(doc.items[1].status).toBe("completed");
    expect(doc.items[2].status).toBe("pending");
  });

  // ── Return value ────────────────────────────────────────────────────

  it("returns created item IDs that match persisted items", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Test item",
        level: "epic",
        description: "Test",
        priority: "medium",
        source: "test",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items[0].id).toBe(result.created[0].id);
  });

  it("returns parentId in creation result for child items", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "parent-epic",
        title: "Parent Epic",
        status: "pending",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Child feature",
        level: "feature",
        description: "Under parent",
        priority: "high",
        source: "sourcevision",
        parentId: "parent-epic",
      },
    ]);

    expect(result.created[0].parentId).toBe("parent-epic");
  });

  it("returns undefined parentId for root-level items", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Root item",
        level: "epic",
        description: "At root",
        priority: "medium",
        source: "sourcevision",
      },
    ]);

    expect(result.created[0].parentId).toBeUndefined();
  });

  it("generates unique IDs for each created item", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Item A",
        level: "epic",
        description: "A",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Item B",
        level: "epic",
        description: "B",
        priority: "medium",
        source: "sourcevision",
      },
      {
        title: "Item C",
        level: "epic",
        description: "C",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const ids = result.created.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(3);
  });

  // ── Tags ────────────────────────────────────────────────────────────

  it("applies tags when provided", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Tagged item",
        level: "epic",
        description: "Has tags",
        priority: "low",
        source: "sourcevision",
        tags: ["auth", "critical-fix"],
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].tags).toEqual(["auth", "critical-fix"]);
  });

  it("omits tags field when no tags are provided", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "No tags",
        level: "epic",
        description: "No tags here",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].tags).toBeUndefined();
  });

  it("omits tags field when tags array is empty", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Empty tags",
        level: "epic",
        description: "Empty tags array",
        priority: "low",
        source: "sourcevision",
        tags: [],
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].tags).toBeUndefined();
  });

  // ── Mixed levels in a single batch ──────────────────────────────────

  it("creates items of different levels in a single batch", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "New Epic",
        level: "epic",
        description: "Epic",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "New Feature",
        level: "feature",
        description: "Feature at root",
        priority: "medium",
        source: "sourcevision",
      },
      {
        title: "New Task",
        level: "task",
        description: "Task at root",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(3);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(3);
    expect(doc.items[0].level).toBe("epic");
    expect(doc.items[1].level).toBe("feature");
    expect(doc.items[2].level).toBe("task");
  });

  // ── Conflict detection: DAG integrity ─────────────────────────────

  it("succeeds when existing items have valid blockedBy references", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "task-a",
        title: "Task A",
        status: "pending",
        level: "task",
      },
      {
        id: "task-b",
        title: "Task B",
        status: "pending",
        level: "task",
        blockedBy: ["task-a"],
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // Adding a new item should succeed — existing DAG is valid
    const result = await createItemsFromRecommendations(store, [
      {
        title: "New epic",
        level: "epic",
        description: "Should work",
        priority: "medium",
        source: "sourcevision",
      },
    ]);

    expect(result.created).toHaveLength(1);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(3);
  });

  // ── Description edge cases ──────────────────────────────────────────

  it("handles multiline descriptions", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const description = "- Finding A\n- Finding B\n- Finding C\n\nSummary: Multiple issues detected.";
    await createItemsFromRecommendations(store, [
      {
        title: "Multi-line",
        level: "epic",
        description,
        priority: "high",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].description).toBe(description);
  });

  it("handles empty description", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "No description",
        level: "epic",
        description: "",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].description).toBe("");
  });

  // ── All priority levels ─────────────────────────────────────────────

  it("creates items with all valid priority levels", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Critical",
        level: "epic",
        description: "Critical",
        priority: "critical",
        source: "sourcevision",
      },
      {
        title: "High",
        level: "epic",
        description: "High",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Medium",
        level: "epic",
        description: "Medium",
        priority: "medium",
        source: "sourcevision",
      },
      {
        title: "Low",
        level: "epic",
        description: "Low",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(4);
    expect(doc.items[0].priority).toBe("critical");
    expect(doc.items[1].priority).toBe("high");
    expect(doc.items[2].priority).toBe("medium");
    expect(doc.items[3].priority).toBe("low");
  });

  // ── Source field ────────────────────────────────────────────────────

  it("preserves custom source identifiers", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "From sourcevision",
        level: "epic",
        description: "SV",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Manual entry",
        level: "epic",
        description: "Manual",
        priority: "medium",
        source: "manual",
      },
    ]);

    const doc = await readPrd(tmpDir);
    expect(doc.items[0].source).toBe("sourcevision");
    expect(doc.items[1].source).toBe("manual");
  });

  // ── All created items have "pending" status ─────────────────────────

  it("always sets status to pending for all created items", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Item 1",
        level: "epic",
        description: "A",
        priority: "critical",
        source: "sourcevision",
      },
      {
        title: "Item 2",
        level: "feature",
        description: "B",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Item 3",
        level: "task",
        description: "C",
        priority: "low",
        source: "sourcevision",
      },
    ]);

    const doc = await readPrd(tmpDir);
    for (const item of doc.items) {
      expect(item.status).toBe("pending");
    }
  });

  // ── Partial metadata ────────────────────────────────────────────────

  it("preserves partial metadata (only some fields)", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await createItemsFromRecommendations(store, [
      {
        title: "Partial meta",
        level: "epic",
        description: "Has partial meta",
        priority: "medium",
        source: "sourcevision",
        meta: {
          category: "auth",
          findingCount: 5,
        },
      },
    ]);

    const doc = await readPrd(tmpDir);
    const meta = doc.items[0].recommendationMeta as Record<string, unknown>;
    expect(meta).toBeDefined();
    expect(meta.category).toBe("auth");
    expect(meta.findingCount).toBe(5);
    expect(meta.findingHashes).toBeUndefined();
    expect(meta.severityDistribution).toBeUndefined();
  });

  // ── Large batch creation ────────────────────────────────────────────

  it("handles a large batch of recommendations (10 items)", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const recommendations = Array.from({ length: 10 }, (_, i) => ({
      title: `Recommendation ${i + 1}`,
      level: "epic" as const,
      description: `Description for item ${i + 1}`,
      priority: "medium" as const,
      source: "sourcevision",
    }));

    const result = await createItemsFromRecommendations(store, recommendations);

    expect(result.created).toHaveLength(10);
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(10);

    // Verify all items were created with correct titles
    for (let i = 0; i < 10; i++) {
      expect(doc.items[i].title).toBe(`Recommendation ${i + 1}`);
    }

    // Verify all log entries were written
    const logLines = await readLog(tmpDir);
    expect(logLines).toHaveLength(10);
  });

  // ── Conflict: invalid parent-child within batch ─────────────────────

  it("rejects batch when one item references invalid parent while others are valid", async () => {
    await writeFixtureProject(tmpDir, [
      {
        id: "epic-1",
        title: "Epic",
        status: "pending",
        level: "epic",
      },
    ]);
    const store = await resolveStore(join(tmpDir, ".rex"));

    // First item is valid (under epic), second references nonexistent parent
    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Valid feature",
          level: "feature",
          description: "OK",
          priority: "high",
          source: "sourcevision",
          parentId: "epic-1",
        },
        {
          title: "Orphan feature",
          level: "feature",
          description: "Invalid parent",
          priority: "medium",
          source: "sourcevision",
          parentId: "does-not-exist",
        },
      ]),
    ).rejects.toThrow(/Parent "does-not-exist" not found/);

    // Neither item should be created
    const doc = await readPrd(tmpDir);
    expect(doc.items).toHaveLength(1); // Only the pre-existing epic
    expect(doc.items[0].children).toBeUndefined();
  });

  // ── Validation error messages ───────────────────────────────────────

  it("includes item title in placement error messages", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "My Orphan Subtask",
          level: "subtask",
          description: "No parent",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/[Ss]ubtask.*requires a parent/);
  });

  it("reports multiple placement errors when several items fail", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    await expect(
      createItemsFromRecommendations(store, [
        {
          title: "Subtask A",
          level: "subtask",
          description: "Fail A",
          priority: "low",
          source: "sourcevision",
        },
        {
          title: "Subtask B",
          level: "subtask",
          description: "Fail B",
          priority: "low",
          source: "sourcevision",
        },
      ]),
    ).rejects.toThrow(/Placement validation failed/);
  });

  // ── Creation result structure ───────────────────────────────────────

  it("returns level in creation result for each item", async () => {
    await writeFixtureProject(tmpDir);
    const store = await resolveStore(join(tmpDir, ".rex"));

    const result = await createItemsFromRecommendations(store, [
      {
        title: "Epic A",
        level: "epic",
        description: "E",
        priority: "high",
        source: "sourcevision",
      },
      {
        title: "Feature B",
        level: "feature",
        description: "F",
        priority: "medium",
        source: "sourcevision",
      },
    ]);

    expect(result.created[0].level).toBe("epic");
    expect(result.created[1].level).toBe("feature");
  });

  // ── Conflict detection: skip strategy ──────────────────────────────

  describe("conflict strategy: skip", () => {
    it("skips recommendations that conflict with existing items", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "existing-auth",
          title: "Address auth issues (3 findings)",
          status: "pending",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Address auth issues (3 findings)",
            level: "feature",
            description: "Duplicate",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "Implement dark mode",
            level: "feature",
            description: "New feature",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0].title).toBe("Implement dark mode");
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped![0].title).toBe("Address auth issues (3 findings)");
      expect(result.conflictReport).toBeDefined();
      expect(result.conflictReport!.hasConflicts).toBe(true);

      const doc = await readPrd(tmpDir);
      // Original + 1 new (the non-conflicting one)
      expect(doc.items).toHaveLength(2);
      expect(doc.items[0].title).toBe("Address auth issues (3 findings)"); // existing
      expect(doc.items[1].title).toBe("Implement dark mode"); // new
    });

    it("creates all items when no conflicts exist", async () => {
      await writeFixtureProject(tmpDir);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "New feature A",
            level: "feature",
            description: "A",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "New feature B",
            level: "feature",
            description: "B",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(2);
      expect(result.skipped).toBeUndefined();
    });

    it("returns empty created list when all recommendations conflict", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Address auth issues",
          status: "pending",
          level: "feature",
        },
        {
          id: "e2",
          title: "Fix performance problems",
          status: "pending",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Address auth issues",
            level: "feature",
            description: "Dup 1",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "Fix performance problems",
            level: "feature",
            description: "Dup 2",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(2);

      const doc = await readPrd(tmpDir);
      expect(doc.items).toHaveLength(2); // Only original items
    });

    it("does not write log entries for skipped items", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Existing feature",
          status: "pending",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      await createItemsFromRecommendations(
        store,
        [
          {
            title: "Existing feature",
            level: "feature",
            description: "Dup",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      const logLines = await readLog(tmpDir);
      expect(logLines).toHaveLength(0);
    });

    it("includes skip reason referencing the matched item", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Auth security fix",
          status: "pending",
          level: "task",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Auth security fix",
            level: "task",
            description: "Same thing",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.skipped).toHaveLength(1);
      expect(result.skipped![0].reason).toContain("Auth security fix");
      expect(result.skipped![0].reason).toContain("task");
    });
  });

  // ── Conflict detection: skip + reparent completed items ────────────

  describe("completed items do not block recommendations", () => {
    it("creates recommendation at original level when only completed items match", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "completed-feature",
          title: "Address auth issues (3 findings)",
          status: "completed",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Address auth issues (6 findings)",
            level: "feature",
            description: "Updated findings",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      // No conflict — completed items are excluded from conflict detection
      expect(result.created).toHaveLength(1);
      expect(result.created[0].level).toBe("feature");
      expect(result.skipped).toBeUndefined();
      expect(result.reparented).toBeUndefined();

      // Both items exist in PRD
      const doc = await readPrd(tmpDir);
      expect(doc.items).toHaveLength(2);
    });

    it("creates task when completed task has same title", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "completed-task",
          title: "Fix memory leak",
          status: "completed",
          level: "task",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Fix memory leak",
            level: "task",
            description: "New findings",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0].level).toBe("task");
      expect(result.skipped).toBeUndefined();
    });

    it("creates epic when completed epic has same title", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "completed-epic",
          title: "Improve security",
          status: "completed",
          level: "epic",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Improve security",
            level: "epic",
            description: "New security findings",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0].level).toBe("epic");
      expect(result.skipped).toBeUndefined();
    });

    it("creates subtask when completed subtask has same title", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "parent-task",
          title: "Parent task",
          status: "pending",
          level: "task",
          children: [
            {
              id: "completed-subtask",
              title: "Check logs",
              status: "completed",
              level: "subtask",
            },
          ],
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Check logs",
            level: "subtask",
            description: "Same subtask, new findings",
            priority: "low",
            source: "sourcevision",
            parentId: "parent-task",
          },
        ],
        { conflictStrategy: "skip" },
      );

      // Should be created — completed subtask doesn't block
      expect(result.created).toHaveLength(1);
      expect(result.skipped).toBeUndefined();
    });

    it("skips active-item conflicts but allows completed-item matches", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "active-feature",
          title: "Fix database migration errors",
          status: "in_progress",
          level: "feature",
        },
        {
          id: "completed-feature",
          title: "Address auth issues (3 findings)",
          status: "completed",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Fix database migration errors",
            level: "feature",
            description: "Conflicts with active",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "Address auth issues (6 findings)",
            level: "feature",
            description: "Completed item — no conflict",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "Brand new feature",
            level: "feature",
            description: "No conflict",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      // 2 created (auth + brand new), 1 skipped (db migration→active)
      expect(result.created).toHaveLength(2);
      expect(result.skipped).toHaveLength(1);
      expect(result.skipped![0].title).toBe("Fix database migration errors");
      expect(result.reparented).toBeUndefined();
    });

    it("creates items alongside completed items in nested PRD", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "epic-1",
          title: "Existing Epic",
          status: "in_progress",
          level: "epic",
          children: [
            {
              id: "feature-1",
              title: "Address auth issues",
              status: "completed",
              level: "feature",
            },
          ],
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Address auth issues",
            level: "feature",
            description: "New findings after completion",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "New perf feature",
            level: "feature",
            description: "No conflict",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      // Both created as root features (no conflict with completed item)
      expect(result.created).toHaveLength(2);
      expect(result.skipped).toBeUndefined();
      expect(result.reparented).toBeUndefined();

      const doc = await readPrd(tmpDir);
      // Original epic + 2 new root features
      expect(doc.items).toHaveLength(3);
    });
  });

  // ── Conflict detection: error strategy ─────────────────────────────

  describe("conflict strategy: error", () => {
    it("throws when conflicts are detected", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Address auth issues",
          status: "pending",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      await expect(
        createItemsFromRecommendations(
          store,
          [
            {
              title: "Address auth issues",
              level: "feature",
              description: "Duplicate",
              priority: "high",
              source: "sourcevision",
            },
          ],
          { conflictStrategy: "error" },
        ),
      ).rejects.toThrow(/Conflict detection found 1 conflicting/);

      const doc = await readPrd(tmpDir);
      expect(doc.items).toHaveLength(1); // Only original
    });

    it("includes match details in error message", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Fix auth bug",
          status: "pending",
          level: "task",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      await expect(
        createItemsFromRecommendations(
          store,
          [
            {
              title: "Fix auth bug",
              level: "task",
              description: "Same",
              priority: "high",
              source: "sourcevision",
            },
          ],
          { conflictStrategy: "error" },
        ),
      ).rejects.toThrow(/Fix auth bug.*conflicts with existing.*task.*Fix auth bug/);
    });

    it("does not throw when no conflicts exist", async () => {
      await writeFixtureProject(tmpDir);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Brand new feature",
            level: "feature",
            description: "No conflict",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "error" },
      );

      expect(result.created).toHaveLength(1);
    });
  });

  // ── Conflict detection: force strategy ─────────────────────────────

  describe("conflict strategy: force", () => {
    it("creates all items regardless of conflicts (default behavior)", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Address auth issues",
          status: "pending",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Address auth issues",
            level: "feature",
            description: "Duplicate but forced",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "force" },
      );

      expect(result.created).toHaveLength(1);
      expect(result.skipped).toBeUndefined();
      expect(result.conflictReport).toBeUndefined();

      const doc = await readPrd(tmpDir);
      expect(doc.items).toHaveLength(2); // Both exist
    });

    it("default strategy is force (backwards compatible)", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "e1",
          title: "Address auth issues",
          status: "pending",
          level: "feature",
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      // No options = force strategy (backwards compat)
      const result = await createItemsFromRecommendations(store, [
        {
          title: "Address auth issues",
          level: "feature",
          description: "Duplicate but no options passed",
          priority: "high",
          source: "sourcevision",
        },
      ]);

      expect(result.created).toHaveLength(1);
      expect(result.skipped).toBeUndefined();

      const doc = await readPrd(tmpDir);
      expect(doc.items).toHaveLength(2);
    });
  });

  // ── PRD consistency with partial creation ──────────────────────────

  describe("PRD consistency with partial creation", () => {
    it("maintains valid PRD state when some items are skipped", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "epic-1",
          title: "Existing Epic",
          status: "in_progress",
          level: "epic",
          children: [
            {
              id: "feature-1",
              title: "Address auth issues",
              status: "pending",
              level: "feature",
            },
          ],
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Address auth issues",
            level: "feature",
            description: "Conflicts with existing",
            priority: "high",
            source: "sourcevision",
          },
          {
            title: "New perf feature",
            level: "feature",
            description: "No conflict",
            priority: "medium",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(1);
      expect(result.created[0].title).toBe("New perf feature");

      const doc = await readPrd(tmpDir);
      // Original epic (with child) + new root feature
      expect(doc.items).toHaveLength(2);
      expect(doc.items[0].id).toBe("epic-1");
      expect(doc.items[0].children).toHaveLength(1);
      expect(doc.items[0].status).toBe("in_progress");
      expect(doc.items[1].title).toBe("New perf feature");
    });

    it("preserves existing item relationships when all recommendations are skipped", async () => {
      await writeFixtureProject(tmpDir, [
        {
          id: "epic-1",
          title: "Epic A",
          status: "pending",
          level: "epic",
          children: [
            {
              id: "feature-1",
              title: "Feature A",
              status: "pending",
              level: "feature",
            },
          ],
        },
      ]);
      const store = await resolveStore(join(tmpDir, ".rex"));

      const result = await createItemsFromRecommendations(
        store,
        [
          {
            title: "Feature A",
            level: "feature",
            description: "Same as existing",
            priority: "high",
            source: "sourcevision",
          },
        ],
        { conflictStrategy: "skip" },
      );

      expect(result.created).toHaveLength(0);
      expect(result.skipped).toHaveLength(1);

      // PRD should be completely unchanged
      const doc = await readPrd(tmpDir);
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].children).toHaveLength(1);
      expect(doc.items[0].children![0].title).toBe("Feature A");
    });
  });
});
