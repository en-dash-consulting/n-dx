import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../../../src/core/identity.js", () => ({
  resolveActor: vi.fn().mockResolvedValue("Test Actor <test@example.com>"),
}));

import {
  detectChangedFields,
  isModifiedSinceSync,
  resolveConflicts,
  reconcile,
  conflictToLogEntry,
  stampModified,
  stampSynced,
  stampActor,
  extractSyncMeta,
} from "../../../src/core/sync.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(
  overrides: Partial<PRDItem> & { id: string; title: string },
): PRDItem {
  return {
    status: "pending",
    level: "task",
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("detectChangedFields", () => {
  it("returns empty array when items are identical", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    expect(detectChangedFields(item, { ...item })).toEqual([]);
  });

  it("detects changed title", () => {
    const local = makeItem({ id: "t1", title: "Task A" });
    const remote = makeItem({ id: "t1", title: "Task B" });
    expect(detectChangedFields(local, remote)).toEqual(["title"]);
  });

  it("detects changed status", () => {
    const local = makeItem({ id: "t1", title: "Task", status: "pending" });
    const remote = makeItem({ id: "t1", title: "Task", status: "completed" });
    expect(detectChangedFields(local, remote)).toEqual(["status"]);
  });

  it("detects multiple changed fields", () => {
    const local = makeItem({ id: "t1", title: "A", status: "pending", priority: "low" });
    const remote = makeItem({ id: "t1", title: "B", status: "completed", priority: "high" });
    expect(detectChangedFields(local, remote)).toEqual(["priority", "status", "title"]);
  });

  it("ignores sync metadata fields (lastModified, lastSyncedAt, remoteId)", () => {
    const local = makeItem({ id: "t1", title: "Task" });
    const remote = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: "2024-01-01T00:00:00Z",
      lastSyncedAt: "2024-01-01T00:00:00Z",
      remoteId: "notion-123",
    };
    expect(detectChangedFields(local, remote)).toEqual([]);
  });

  it("ignores structural fields (id, level)", () => {
    // id and level should never differ, but if they somehow do, don't flag them
    const local = makeItem({ id: "t1", title: "Task", level: "task" });
    const remote = makeItem({ id: "t1", title: "Task", level: "task" });
    expect(detectChangedFields(local, remote)).toEqual([]);
  });

  it("ignores children field", () => {
    const local = makeItem({
      id: "e1",
      title: "Epic",
      level: "epic",
      children: [makeItem({ id: "t1", title: "Task" })],
    });
    const remote = makeItem({ id: "e1", title: "Epic", level: "epic" });
    expect(detectChangedFields(local, remote)).toEqual([]);
  });

  it("detects field present only on one side", () => {
    const local = makeItem({ id: "t1", title: "Task" });
    const remote = makeItem({ id: "t1", title: "Task", description: "Added desc" });
    expect(detectChangedFields(local, remote)).toEqual(["description"]);
  });

  it("compares arrays deeply", () => {
    const local = makeItem({
      id: "t1",
      title: "Task",
      tags: ["a", "b"],
    });
    const remote = makeItem({
      id: "t1",
      title: "Task",
      tags: ["a", "b"],
    });
    expect(detectChangedFields(local, remote)).toEqual([]);
  });

  it("detects array differences", () => {
    const local = makeItem({
      id: "t1",
      title: "Task",
      acceptanceCriteria: ["AC1"],
    });
    const remote = makeItem({
      id: "t1",
      title: "Task",
      acceptanceCriteria: ["AC1", "AC2"],
    });
    expect(detectChangedFields(local, remote)).toEqual(["acceptanceCriteria"]);
  });
});

describe("isModifiedSinceSync", () => {
  it("returns false when no lastModified", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    expect(isModifiedSinceSync(item)).toBe(false);
  });

  it("returns true when lastModified exists but no lastSyncedAt (never synced)", () => {
    const item = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: "2024-01-01T00:00:00Z",
    };
    expect(isModifiedSinceSync(item)).toBe(true);
  });

  it("returns true when lastModified is after lastSyncedAt", () => {
    const item = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: "2024-01-02T00:00:00Z",
      lastSyncedAt: "2024-01-01T00:00:00Z",
    };
    expect(isModifiedSinceSync(item)).toBe(true);
  });

  it("returns false when lastModified equals lastSyncedAt", () => {
    const item = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: "2024-01-01T00:00:00Z",
      lastSyncedAt: "2024-01-01T00:00:00Z",
    };
    expect(isModifiedSinceSync(item)).toBe(false);
  });

  it("returns false when lastModified is before lastSyncedAt", () => {
    const item = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: "2024-01-01T00:00:00Z",
      lastSyncedAt: "2024-01-02T00:00:00Z",
    };
    expect(isModifiedSinceSync(item)).toBe(false);
  });
});

describe("resolveConflicts", () => {
  it("returns unmodified item when no differences", () => {
    const local = makeItem({ id: "t1", title: "Task" });
    const remote = makeItem({ id: "t1", title: "Task" });
    const { merged, conflicts } = resolveConflicts(local, remote);
    expect(conflicts).toEqual([]);
    expect(merged.title).toBe("Task");
  });

  it("uses remote value when remote is newer (last-write-wins)", () => {
    const local = {
      ...makeItem({ id: "t1", title: "Local Title" }),
      lastModified: "2024-01-01T00:00:00Z",
    };
    const remote = makeItem({ id: "t1", title: "Remote Title" });
    const { merged, conflicts } = resolveConflicts(
      local,
      remote,
      "2024-01-02T00:00:00Z",
    );
    expect(merged.title).toBe("Remote Title");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe("title");
    expect(conflicts[0].resolution).toBe("remote");
  });

  it("uses local value when local is newer (last-write-wins)", () => {
    const local = {
      ...makeItem({ id: "t1", title: "Local Title" }),
      lastModified: "2024-01-02T00:00:00Z",
    };
    const remote = makeItem({ id: "t1", title: "Remote Title" });
    const { merged, conflicts } = resolveConflicts(
      local,
      remote,
      "2024-01-01T00:00:00Z",
    );
    expect(merged.title).toBe("Local Title");
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe("title");
    expect(conflicts[0].resolution).toBe("local");
  });

  it("uses local value when timestamps are equal (local wins ties)", () => {
    const local = {
      ...makeItem({ id: "t1", title: "Local Title" }),
      lastModified: "2024-01-01T00:00:00Z",
    };
    const remote = makeItem({ id: "t1", title: "Remote Title" });
    const { merged, conflicts } = resolveConflicts(
      local,
      remote,
      "2024-01-01T00:00:00Z",
    );
    expect(merged.title).toBe("Local Title");
    expect(conflicts[0].resolution).toBe("local");
  });

  it("handles multiple conflicting fields with same resolution", () => {
    const local = {
      ...makeItem({ id: "t1", title: "Local", status: "pending" as const, priority: "low" as const }),
      lastModified: "2024-01-01T00:00:00Z",
    };
    const remote = makeItem({
      id: "t1",
      title: "Remote",
      status: "completed",
      priority: "high",
    });
    const { merged, conflicts } = resolveConflicts(
      local,
      remote,
      "2024-01-02T00:00:00Z",
    );
    expect(conflicts).toHaveLength(3); // title, status, priority
    // Remote is newer, so all fields should be remote values
    expect(merged.title).toBe("Remote");
    expect(merged.status).toBe("completed");
    expect(merged.priority).toBe("high");
  });

  it("defaults to local when no timestamps provided", () => {
    const local = makeItem({ id: "t1", title: "Local Title" });
    const remote = makeItem({ id: "t1", title: "Remote Title" });
    const { merged, conflicts } = resolveConflicts(local, remote);
    // Both lastModified are "" (empty), local wins ties
    expect(merged.title).toBe("Local Title");
    expect(conflicts[0].resolution).toBe("local");
  });

  it("records resolvedAt timestamp on conflicts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    const local = makeItem({ id: "t1", title: "A" });
    const remote = makeItem({ id: "t1", title: "B" });
    const { conflicts } = resolveConflicts(local, remote);
    expect(conflicts[0].resolvedAt).toBe("2024-06-15T12:00:00.000Z");

    vi.useRealTimers();
  });
});

describe("reconcile", () => {
  it("marks items as synced when only local exists", () => {
    const local = [makeItem({ id: "t1", title: "Task" })];
    const remote = new Map<string, PRDItem>();
    const result = reconcile(local, remote);
    expect(result.synced).toEqual(["t1"]);
    expect(result.conflicts).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("marks items as synced when identical", () => {
    const local = [makeItem({ id: "t1", title: "Task" })];
    const remote = new Map([["t1", makeItem({ id: "t1", title: "Task" })]]);
    const result = reconcile(local, remote);
    expect(result.synced).toEqual(["t1"]);
    expect(result.conflicts).toEqual([]);
  });

  it("marks items as synced when only one side changed", () => {
    // Local changed, remote did not
    const local = [
      {
        ...makeItem({ id: "t1", title: "Updated" }),
        lastModified: "2024-01-02T00:00:00Z",
        lastSyncedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const remote = new Map([
      ["t1", makeItem({ id: "t1", title: "Original" })],
    ]);
    const result = reconcile(local, remote);
    // Only local changed (no lastModified on remote, and remote not newer than lastSyncedAt)
    expect(result.synced).toEqual(["t1"]);
    expect(result.conflicts).toEqual([]);
  });

  it("detects conflicts when both sides changed", () => {
    const local = [
      {
        ...makeItem({ id: "t1", title: "Local Change" }),
        lastModified: "2024-01-02T00:00:00Z",
        lastSyncedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const remote = new Map([
      [
        "t1",
        {
          ...makeItem({ id: "t1", title: "Remote Change" }),
          lastModified: "2024-01-03T00:00:00Z",
        },
      ],
    ]);
    const result = reconcile(local, remote);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].field).toBe("title");
    expect(result.conflicts[0].resolution).toBe("remote"); // remote is newer
  });

  it("handles nested items in tree", () => {
    const local = [
      makeItem({
        id: "e1",
        title: "Epic",
        level: "epic",
        children: [
          {
            ...makeItem({ id: "t1", title: "Local Change" }),
            lastModified: "2024-01-02T00:00:00Z",
            lastSyncedAt: "2024-01-01T00:00:00Z",
          } as PRDItem,
        ],
      }),
    ];
    const remote = new Map([
      ["e1", makeItem({ id: "e1", title: "Epic", level: "epic" })],
      [
        "t1",
        {
          ...makeItem({ id: "t1", title: "Remote Change" }),
          lastModified: "2024-01-03T00:00:00Z",
        },
      ],
    ]);
    const result = reconcile(local, remote);
    expect(result.synced).toContain("e1");
    expect(result.conflicts.some((c) => c.itemId === "t1")).toBe(true);
  });

  it("returns multiple conflicts for multi-field changes", () => {
    const local = [
      {
        ...makeItem({ id: "t1", title: "Local", status: "pending" as const }),
        lastModified: "2024-01-02T00:00:00Z",
        lastSyncedAt: "2024-01-01T00:00:00Z",
      },
    ];
    const remote = new Map([
      [
        "t1",
        {
          ...makeItem({ id: "t1", title: "Remote", status: "completed" as const }),
          lastModified: "2024-01-03T00:00:00Z",
        },
      ],
    ]);
    const result = reconcile(local, remote);
    expect(result.conflicts.length).toBeGreaterThanOrEqual(2);
    const fields = result.conflicts.map((c) => c.field).sort();
    expect(fields).toContain("status");
    expect(fields).toContain("title");
  });
});

describe("conflictToLogEntry", () => {
  it("creates a valid log entry from a conflict record", () => {
    const entry = conflictToLogEntry({
      itemId: "t1",
      field: "title",
      localValue: "Local Title",
      remoteValue: "Remote Title",
      resolution: "remote",
      resolvedAt: "2024-01-01T00:00:00Z",
    });
    expect(entry.event).toBe("sync_conflict");
    expect(entry.itemId).toBe("t1");
    expect(entry.timestamp).toBe("2024-01-01T00:00:00Z");
    expect(entry.detail).toContain("title");
    expect(entry.detail).toContain("remote");
    expect(entry.field).toBe("title");
    expect(entry.resolution).toBe("remote");
  });

  it("serializes non-string values as JSON", () => {
    const entry = conflictToLogEntry({
      itemId: "t1",
      field: "tags",
      localValue: ["a", "b"],
      remoteValue: ["a", "b", "c"],
      resolution: "local",
      resolvedAt: "2024-01-01T00:00:00Z",
    });
    expect(entry.localValue).toBe(JSON.stringify(["a", "b"]));
    expect(entry.remoteValue).toBe(JSON.stringify(["a", "b", "c"]));
  });

  it("preserves string values as-is", () => {
    const entry = conflictToLogEntry({
      itemId: "t1",
      field: "status",
      localValue: "pending",
      remoteValue: "completed",
      resolution: "remote",
      resolvedAt: "2024-01-01T00:00:00Z",
    });
    expect(entry.localValue).toBe("pending");
    expect(entry.remoteValue).toBe("completed");
  });
});

describe("stampModified", () => {
  it("sets lastModified to current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    const item = makeItem({ id: "t1", title: "Task" });
    const stamped = await stampModified(item);
    expect(stamped.lastModified).toBe("2024-06-15T12:00:00.000Z");
    expect(stamped.id).toBe("t1");

    vi.useRealTimers();
  });

  it("accepts explicit timestamp", async () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const stamped = await stampModified(item, "2024-01-01T00:00:00Z");
    expect(stamped.lastModified).toBe("2024-01-01T00:00:00Z");
  });

  it("does not mutate original item", async () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const stamped = await stampModified(item, "2024-01-01T00:00:00Z");
    expect(item.lastModified).toBeUndefined();
    expect(stamped).not.toBe(item);
  });

  it("stamps lastModifiedBy with the resolved actor", async () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const stamped = await stampModified(item);
    expect(stamped.lastModifiedBy).toBe("Test Actor <test@example.com>");
  });

  it("accepts an explicit actor override", async () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const stamped = await stampModified(item, undefined, "someone-else");
    expect(stamped.lastModifiedBy).toBe("someone-else");
  });
});

describe("stampActor", () => {
  it("stamps actor with the resolved identity", async () => {
    const entry = { timestamp: "2024-01-01T00:00:00Z", event: "item_added" };
    const stamped = await stampActor(entry);
    expect(stamped.actor).toBe("Test Actor <test@example.com>");
    expect(stamped.event).toBe("item_added");
  });

  it("does not override an explicit actor already on the entry", async () => {
    const entry = {
      timestamp: "2024-01-01T00:00:00Z",
      event: "sync_conflict",
      actor: "remote-system",
    };
    const stamped = await stampActor(entry);
    expect(stamped.actor).toBe("remote-system");
  });

  it("accepts an explicit actor override argument", async () => {
    const entry = { timestamp: "2024-01-01T00:00:00Z", event: "item_added" };
    const stamped = await stampActor(entry, "explicit-actor");
    expect(stamped.actor).toBe("explicit-actor");
  });
});

describe("stampSynced", () => {
  it("sets lastSyncedAt to current time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T12:00:00Z"));

    const item = makeItem({ id: "t1", title: "Task" });
    const synced = stampSynced(item);
    expect(synced.lastSyncedAt).toBe("2024-06-15T12:00:00.000Z");

    vi.useRealTimers();
  });

  it("sets remoteId when provided", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const synced = stampSynced(item, "notion-abc-123", "2024-01-01T00:00:00Z");
    expect(synced.remoteId).toBe("notion-abc-123");
    expect(synced.lastSyncedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("does not add remoteId when not provided", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const synced = stampSynced(item, undefined, "2024-01-01T00:00:00Z");
    expect(synced.remoteId).toBeUndefined();
  });

  it("does not mutate original item", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const synced = stampSynced(item, "notion-123", "2024-01-01T00:00:00Z");
    expect(item.lastSyncedAt).toBeUndefined();
    expect(synced).not.toBe(item);
  });
});

describe("extractSyncMeta", () => {
  it("extracts metadata from item with sync fields", () => {
    const item = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: "2024-01-01T00:00:00Z",
      lastSyncedAt: "2024-01-02T00:00:00Z",
      remoteId: "notion-123",
    };
    const meta = extractSyncMeta(item);
    expect(meta.lastModified).toBe("2024-01-01T00:00:00Z");
    expect(meta.lastSyncedAt).toBe("2024-01-02T00:00:00Z");
    expect(meta.remoteId).toBe("notion-123");
  });

  it("returns undefined for missing sync fields", () => {
    const item = makeItem({ id: "t1", title: "Task" });
    const meta = extractSyncMeta(item);
    expect(meta.lastModified).toBeUndefined();
    expect(meta.lastSyncedAt).toBeUndefined();
    expect(meta.remoteId).toBeUndefined();
  });

  it("ignores non-string values for sync fields", () => {
    const item = {
      ...makeItem({ id: "t1", title: "Task" }),
      lastModified: 12345, // wrong type
    };
    const meta = extractSyncMeta(item);
    expect(meta.lastModified).toBeUndefined();
  });
});
