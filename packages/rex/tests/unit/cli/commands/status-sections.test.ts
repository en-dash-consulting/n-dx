import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  findAutoCompletable,
  renderAutoCompletableHints,
} from "../../../../src/cli/commands/status-sections.js";
import { makeItem } from "../../../helpers/index.js";
import type { PRDItem } from "../../../../src/schema/index.js";

/** A parent with the given status whose two children are both completed. */
function completableParent(id: string, title: string, status: PRDItem["status"]): PRDItem {
  return makeItem({
    id,
    title,
    level: "feature",
    status,
    children: [
      makeItem({ id: `${id}-t1`, title: "Task 1", status: "completed" }),
      makeItem({ id: `${id}-t2`, title: "Task 2", status: "completed" }),
    ],
  });
}

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
    expect(findAutoCompletable(items)).toEqual([
      { id: "f1", title: "Feature 1", status: "in_progress" },
    ]);
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

describe("renderAutoCompletableHints", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  const output = (): string => logSpy.mock.calls.map((c) => c.join(" ")).join("\n");

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("prints nothing when no parent is auto-completable", () => {
    renderAutoCompletableHints([completableParent("f1", "Feature 1", "completed")]);
    expect(logSpy).not.toHaveBeenCalled();
  });

  it("does not advertise `rex fix` when every auto-completable parent is in_progress", () => {
    renderAutoCompletableHints([
      completableParent("f1", "Feature 1", "in_progress"),
      completableParent("f2", "Feature 2", "in_progress"),
    ]);
    const text = output();
    expect(text).toContain("Feature 1");
    expect(text).toContain("Feature 2");
    // `rex fix`'s stuck_parent kind only touches pending parents, so telling
    // the operator to run it here sends them at a no-op.
    expect(text).not.toMatch(/Run .*rex fix/);
    expect(text).toMatch(/rex fix.*will not/);
  });

  it("tells the operator to run `rex fix` when a pending parent is listed", () => {
    renderAutoCompletableHints([completableParent("f1", "Feature 1", "pending")]);
    const text = output();
    expect(text).toMatch(/Run .*rex fix/);
    expect(text).not.toMatch(/will not/);
  });

  it("separates the parents `rex fix` will act on from the ones it will not", () => {
    renderAutoCompletableHints([
      completableParent("f1", "Pending feature", "pending"),
      completableParent("f2", "Claimed feature", "in_progress"),
    ]);
    const lines = logSpy.mock.calls.map((c) => c.join(" "));
    const fixLine = lines.findIndex((l) => /Run .*rex fix/.test(l));
    const skipLine = lines.findIndex((l) => /rex fix.*will not/.test(l));
    const pendingItem = lines.findIndex((l) => l.includes("Pending feature"));
    const claimedItem = lines.findIndex((l) => l.includes("Claimed feature"));

    expect(fixLine).toBeGreaterThan(-1);
    expect(skipLine).toBeGreaterThan(-1);
    // Each item sits under the line describing what happens to it.
    expect(pendingItem).toBeLessThan(fixLine);
    expect(claimedItem).toBeGreaterThan(fixLine);
    expect(claimedItem).toBeLessThan(skipLine);
  });
});
