// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function renderDetail(
  item: PRDItemData,
  taskUsage?: { totalTokens: number; runCount: number },
  weeklyBudget?: { budget: number | null; source: "vendor_model" | "vendor_default" | "global_default" | "missing_budget" },
) {
  const root = document.createElement("div");
  act(() => {
    render(h(TaskDetail, { item, allItems: [item], taskUsage, weeklyBudget }), root);
  });
  return root;
}

describe("TaskDetail usage", () => {
  it("shows aggregated task token usage when provided", () => {
    const item: PRDItemData = {
      id: "task-1",
      title: "Task One",
      status: "pending",
      level: "task",
    };
    const root = renderDetail(item, { totalTokens: 1234, runCount: 2 }, { budget: 50_000, source: "vendor_default" });
    expect(root.textContent).toContain("1.2k tokens");
    expect(root.textContent).toContain("2%");
    expect(root.textContent).toContain("2 associated runs");
  });

  it("shows explicit zero state when no usage is associated", () => {
    const item: PRDItemData = {
      id: "task-2",
      title: "Task Two",
      status: "pending",
      level: "task",
    };
    const root = renderDetail(item);
    expect(root.textContent).toContain("0 tokens");
    expect(root.textContent).toContain("No budget");
    expect(root.textContent).toContain("0 associated runs");
  });

  it("shows missing budget fallback reason state", () => {
    const item: PRDItemData = {
      id: "task-3",
      title: "Task Three",
      status: "pending",
      level: "task",
    };
    const root = renderDetail(item, { totalTokens: 999, runCount: 1 }, { budget: null, source: "missing_budget" });
    expect(root.textContent).toContain("No budget");
    expect(root.textContent).toContain("reason: missing_budget");
    const utilNode = root.querySelector(".task-usage-value[data-utilization-reason='missing_budget']");
    expect(utilNode).not.toBeNull();
  });
});
