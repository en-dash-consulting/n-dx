// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  entriesForWorkspace,
  queuePositionOf,
  type HubQueueSnapshot,
} from "../../../src/viewer/hooks/use-hub-queue.js";

/**
 * The pure half of the hub-queue hook: which queued runs belong to the
 * workspace on screen, and where a task sits in the wait.
 *
 * The fetching half is exercised end to end in
 * tests/integration/hub-queue-visibility.test.ts, against a real hub — a
 * mocked `fetch` here would only assert that the hook calls the URL this file
 * already names.
 */

function snapshot(overrides: Partial<HubQueueSnapshot> = {}): HubQueueSnapshot {
  return {
    entries: [
      { projectId: "alpha", workspace: null, taskId: "t1", enqueuedAt: "2026-09-16T10:00:00.000Z" },
      { projectId: "alpha", workspace: "feature", taskId: "t2", enqueuedAt: "2026-09-16T10:01:00.000Z" },
      { projectId: "alpha", workspace: null, taskId: "t3", enqueuedAt: "2026-09-16T10:02:00.000Z" },
    ],
    running: 4,
    freeMemoryBytes: 8 * 1024 * 1024 * 1024,
    limits: { maxSessions: 4, memoryFloorBytes: 2 * 1024 * 1024 * 1024 },
    memoryPaused: false,
    ...overrides,
  };
}

describe("entriesForWorkspace", () => {
  it("selects the anchor's entries with null, not with a name", () => {
    expect(entriesForWorkspace(snapshot(), null).map((e) => e.taskId)).toEqual(["t1", "t3"]);
  });

  it("selects a worktree's entries by key", () => {
    expect(entriesForWorkspace(snapshot(), "feature").map((e) => e.taskId)).toEqual(["t2"]);
    // A strip showing one worktree must not react to another's entry.
    expect(entriesForWorkspace(snapshot(), "other")).toEqual([]);
  });

  it("keeps the queue's order within a workspace", () => {
    const entries = entriesForWorkspace(snapshot(), null);
    expect(entries[0].enqueuedAt < entries[1].enqueuedAt).toBe(true);
  });

  it("is empty before the first answer, and where there is no hub", () => {
    expect(entriesForWorkspace(null, null)).toEqual([]);
    expect(entriesForWorkspace(null, "feature")).toEqual([]);
  });
});

describe("queuePositionOf", () => {
  it("counts over the whole queue, not the workspace's slice", () => {
    // t2 is the only entry for "feature", but it is second in the wait — and
    // the wait is for the machine.
    expect(queuePositionOf(snapshot(), "t1")).toBe(1);
    expect(queuePositionOf(snapshot(), "t2")).toBe(2);
    expect(queuePositionOf(snapshot(), "t3")).toBe(3);
  });

  it("is 0 for a task that is not waiting", () => {
    expect(queuePositionOf(snapshot(), "not-queued")).toBe(0);
    expect(queuePositionOf(null, "t1")).toBe(0);
  });
});
