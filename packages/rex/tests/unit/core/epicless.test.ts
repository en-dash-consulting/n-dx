import { describe, it, expect } from "vitest";
import { findEpiclessFeatures } from "../../../src/core/structural.js";
import type { PRDItem } from "../../../src/schema/index.js";

describe("findEpiclessFeatures", () => {
  it("detects features at root level", () => {
    const items: PRDItem[] = [
      {
        id: "f1",
        title: "Root Feature",
        level: "feature",
        status: "pending",
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      itemId: "f1",
      title: "Root Feature",
      status: "pending",
      childCount: 0,
    });
  });

  it("detects multiple epicless features", () => {
    const items: PRDItem[] = [
      {
        id: "f1",
        title: "Feature One",
        level: "feature",
        status: "pending",
      },
      {
        id: "e1",
        title: "An Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "f2",
            title: "Nested Feature",
            level: "feature",
            status: "pending",
          },
        ],
      },
      {
        id: "f3",
        title: "Feature Three",
        level: "feature",
        status: "in_progress",
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(2);
    expect(result[0].itemId).toBe("f1");
    expect(result[1].itemId).toBe("f3");
  });

  it("ignores features properly nested under epics", () => {
    const items: PRDItem[] = [
      {
        id: "e1",
        title: "Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "f1",
            title: "Nested Feature",
            level: "feature",
            status: "pending",
          },
        ],
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(0);
  });

  it("ignores deleted features at root level", () => {
    const items: PRDItem[] = [
      {
        id: "f1",
        title: "Deleted Root Feature",
        level: "feature",
        status: "deleted",
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(0);
  });

  it("ignores non-feature items at root level", () => {
    const items: PRDItem[] = [
      {
        id: "e1",
        title: "An Epic",
        level: "epic",
        status: "pending",
      },
      {
        id: "t1",
        title: "A Task",
        level: "task",
        status: "pending",
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(0);
  });

  it("returns empty array when no items exist", () => {
    const result = findEpiclessFeatures([]);
    expect(result).toHaveLength(0);
  });

  it("counts non-deleted children correctly", () => {
    const items: PRDItem[] = [
      {
        id: "f1",
        title: "Feature With Children",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "t1",
            title: "Task One",
            level: "task",
            status: "pending",
          },
          {
            id: "t2",
            title: "Task Two",
            level: "task",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-02T00:00:00.000Z",
          },
          {
            id: "t3",
            title: "Deleted Task",
            level: "task",
            status: "deleted",
          },
        ],
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(1);
    expect(result[0].childCount).toBe(2); // t1 + t2, not t3 (deleted)
  });

  it("reports zero children when all children are deleted", () => {
    const items: PRDItem[] = [
      {
        id: "f1",
        title: "Feature",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "t1",
            title: "Deleted",
            level: "task",
            status: "deleted",
          },
        ],
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result).toHaveLength(1);
    expect(result[0].childCount).toBe(0);
  });

  it("includes feature status in result", () => {
    const items: PRDItem[] = [
      {
        id: "f1",
        title: "In Progress Feature",
        level: "feature",
        status: "in_progress",
      },
    ];

    const result = findEpiclessFeatures(items);
    expect(result[0].status).toBe("in_progress");
  });
});
