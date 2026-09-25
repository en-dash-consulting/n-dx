// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  act(() => { render(vnode, root); });
  return root;
}

function makeItem(overrides: Partial<PRDItemData> = {}): PRDItemData {
  return {
    id: "test-item-1",
    title: "Test Item",
    status: "pending",
    level: "task",
    ...overrides,
  };
}

describe("TaskDetail requirements section", () => {
  it("renders requirements count in section label", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Test requirement",
          category: "security",
          validationType: "automated",
          acceptanceCriteria: ["Must pass"],
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    expect(root.textContent).toContain("Requirements (1)");
  });

  it("renders requirements with zero count when none exist", () => {
    const item = makeItem();
    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );
    expect(root.textContent).toContain("Requirements (0)");
  });

  it("renders requirement category badge", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Security requirement",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: ["Auth required"],
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    const badge = root.querySelector(".req-cat-security");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Security");
  });

  it("renders requirement validation type badge", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Perf req",
          category: "performance",
          validationType: "metric",
          acceptanceCriteria: ["Response < 200ms"],
          threshold: 200,
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    const badge = root.querySelector(".req-val-metric");
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain("Metric");
  });

  it("renders requirement title and description", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "My Requirement",
          description: "A detailed description",
          category: "technical",
          validationType: "automated",
          acceptanceCriteria: [],
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    expect(root.textContent).toContain("My Requirement");
    expect(root.textContent).toContain("A detailed description");
  });

  it("renders acceptance criteria as list items", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Req",
          category: "quality",
          validationType: "automated",
          acceptanceCriteria: ["Criterion 1", "Criterion 2"],
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    const criteria = root.querySelectorAll(".task-requirement-criteria li");
    expect(criteria.length).toBe(2);
    expect(criteria[0].textContent).toBe("Criterion 1");
    expect(criteria[1].textContent).toBe("Criterion 2");
  });

  it("renders validation command when present", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Coverage",
          category: "quality",
          validationType: "metric",
          acceptanceCriteria: [],
          validationCommand: "npm test -- --coverage",
          threshold: 80,
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    expect(root.textContent).toContain("npm test -- --coverage");
    expect(root.textContent).toContain("threshold: 80");
  });

  it("shows add requirement button when onUpdate is provided", () => {
    const item = makeItem();
    const onUpdate = vi.fn();

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item], onUpdate }),
    );

    const addBtn = root.querySelector(".task-req-add-btn");
    expect(addBtn).not.toBeNull();
    expect(addBtn?.textContent).toContain("Add requirement");
  });

  it("does not show add button when onUpdate is not provided", () => {
    const item = makeItem();

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    const addBtn = root.querySelector(".task-req-add-btn");
    expect(addBtn).toBeNull();
  });

  it("renders remove button for each requirement when onUpdate is provided", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Req 1",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: [],
        },
        {
          id: "req-2",
          title: "Req 2",
          category: "technical",
          validationType: "automated",
          acceptanceCriteria: [],
        },
      ],
    });
    const onUpdate = vi.fn();

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item], onUpdate }),
    );

    const removeBtns = root.querySelectorAll(".task-req-remove-btn");
    expect(removeBtns.length).toBe(2);
  });

  it("renders multiple requirements with different categories", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Security req",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: [],
        },
        {
          id: "req-2",
          title: "Performance req",
          category: "performance",
          validationType: "metric",
          acceptanceCriteria: [],
        },
        {
          id: "req-3",
          title: "Quality req",
          category: "quality",
          validationType: "automated",
          acceptanceCriteria: [],
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    expect(root.textContent).toContain("Requirements (3)");
    expect(root.querySelector(".req-cat-security")).not.toBeNull();
    expect(root.querySelector(".req-cat-performance")).not.toBeNull();
    expect(root.querySelector(".req-cat-quality")).not.toBeNull();
  });

  it("renders filter dropdown when more than 2 requirements", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Sec req",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: [],
        },
        {
          id: "req-2",
          title: "Perf req",
          category: "performance",
          validationType: "metric",
          acceptanceCriteria: [],
        },
        {
          id: "req-3",
          title: "Tech req",
          category: "technical",
          validationType: "automated",
          acceptanceCriteria: [],
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    const filter = root.querySelector(".task-req-filter-select");
    expect(filter).not.toBeNull();
  });

  it("renders requirement priority badge when set", () => {
    const item = makeItem({
      requirements: [
        {
          id: "req-1",
          title: "Critical req",
          category: "security",
          validationType: "manual",
          acceptanceCriteria: [],
          priority: "critical",
        },
      ],
    });

    const root = renderToDiv(
      h(TaskDetail, { item, allItems: [item] }),
    );

    const badge = root.querySelector(".prd-priority-critical");
    expect(badge).not.toBeNull();
  });
});
