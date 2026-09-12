import { describe, it, expect } from "vitest";
import { findAutoCompletable } from "../../../../src/cli/commands/status-sections.js";
import { makeItem } from "../../../helpers/index.js";
import type { PRDItem } from "../../../../src/schema/index.js";

describe("findAutoCompletable", () => {
  it("includes a parent whose children are all completed", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "completed" }),
        ],
      }),
    ];
    expect(findAutoCompletable(items)).toEqual([{ id: "f1", title: "Feature 1" }]);
  });

  it("excludes a parent with a deferred child (GH #364)", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "deferred" }),
        ],
      }),
    ];
    expect(findAutoCompletable(items)).toEqual([]);
  });

  it("excludes a parent with a blocked child", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "blocked" }),
        ],
      }),
    ];
    expect(findAutoCompletable(items)).toEqual([]);
  });

  it("excludes a parent with a failing child", () => {
    const items: PRDItem[] = [
      makeItem({
        id: "f1",
        title: "Feature 1",
        level: "feature",
        status: "in_progress",
        children: [
          makeItem({ id: "t1", title: "Task 1", status: "completed" }),
          makeItem({ id: "t2", title: "Task 2", status: "failing" }),
        ],
      }),
    ];
    expect(findAutoCompletable(items)).toEqual([]);
  });
});
