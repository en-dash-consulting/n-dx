import { describe, it, expect } from "vitest";
import { checkStructureHealth } from "../../../src/core/health.js";
import type { PRDItem } from "../../../src/schema/index.js";

function makeItem(id: string, level: string, children?: PRDItem[]): PRDItem {
  return { id, title: `Item ${id}`, level, status: "pending", children } as PRDItem;
}

describe("checkStructureHealth", () => {
  it("returns healthy for a well-structured tree", () => {
    const items = [
      makeItem("e1", "epic", [
        makeItem("f1", "feature", [makeItem("t1", "task"), makeItem("t2", "task")]),
        makeItem("f2", "feature", [makeItem("t3", "task"), makeItem("t4", "task")]),
      ]),
    ];
    const result = checkStructureHealth(items);
    expect(result.healthy).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns when too many top-level epics", () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem(`e${i}`, "epic"));
    const result = checkStructureHealth(items, { maxTopLevelEpics: 15 });
    expect(result.healthy).toBe(false);
    expect(result.warnings.some((w) => w.type === "too-many-epics")).toBe(true);
    expect(result.warnings[0].actual).toBe(20);
  });

  it("warns when tree is too deep", () => {
    const items = [
      makeItem("e1", "epic", [
        makeItem("f1", "feature", [
          makeItem("t1", "task", [
            makeItem("s1", "subtask", [
              makeItem("s2", "subtask", [makeItem("s3", "subtask")]),
            ]),
          ]),
        ]),
      ]),
    ];
    const result = checkStructureHealth(items, { maxTreeDepth: 4 });
    expect(result.warnings.some((w) => w.type === "too-deep")).toBe(true);
  });

  it("warns on oversized containers", () => {
    const children = Array.from({ length: 25 }, (_, i) => makeItem(`t${i}`, "task"));
    const items = [makeItem("e1", "epic", [makeItem("f1", "feature", children)])];
    const result = checkStructureHealth(items, { maxChildrenPerContainer: 20 });
    expect(result.warnings.some((w) => w.type === "oversized-container")).toBe(true);
  });

  it("warns on undersized containers", () => {
    const items = [makeItem("e1", "epic", [makeItem("f1", "feature", [makeItem("t1", "task")])])];
    const result = checkStructureHealth(items, { minChildrenPerContainer: 2 });
    expect(result.warnings.some((w) => w.type === "undersized-container")).toBe(true);
  });

  it("ignores deleted items", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      ...makeItem(`e${i}`, "epic"),
      status: i < 10 ? "pending" : "deleted",
    })) as PRDItem[];
    const result = checkStructureHealth(items, { maxTopLevelEpics: 15 });
    expect(result.healthy).toBe(true);
  });

  it("uses defaults when no overrides provided", () => {
    const items = [makeItem("e1", "epic", [
      makeItem("f1", "feature", [makeItem("t1", "task"), makeItem("t2", "task")]),
      makeItem("f2", "feature", [makeItem("t3", "task"), makeItem("t4", "task")]),
    ])];
    const result = checkStructureHealth(items);
    expect(result.healthy).toBe(true);
  });
});
