// @vitest-environment jsdom
/**
 * The detail panel's add-child form: on a v2 change it offers a task, never a
 * feature or an epic, and sends title, description, criteria and priority.
 */
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

/** A root change as rex projects it: v1 level epic, type change. */
const change: PRDItemData = { id: "chg-1", title: "Support gift cards", status: "pending", level: "epic", type: "change" } as PRDItemData;

function mount(item: PRDItemData, onAddChild = vi.fn().mockResolvedValue(undefined)) {
  const root = document.createElement("div");
  act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate: vi.fn(), onAddChild }), root); });
  return { root, onAddChild };
}

function click(el: Element | null) {
  act(() => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

function setValue(el: Element | null, value: string, event = "input") {
  if (!el) throw new Error("element missing");
  act(() => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

describe("TaskDetail add child on a v2 change", () => {
  it("offers a task, not a feature or an epic", () => {
    const { root } = mount(change);
    const button = root.querySelector(".task-add-child-btn");
    expect(button?.textContent).toBe("+ Add Task");
    click(button);
    const form = root.querySelector(".task-add-child-form")!;
    expect(form.textContent).toContain("Add Task");
    expect(form.textContent).not.toMatch(/feature|epic/i);
  });

  it("sends the title, description, criteria and priority with type task", async () => {
    const { root, onAddChild } = mount(change);
    click(root.querySelector(".task-add-child-btn"));
    setValue(root.querySelector(".task-add-child-title"), "Balance check");
    click(root.querySelector(".task-add-child-more"));
    setValue(root.querySelector(".task-add-child-description"), "Shoppers see their balance.");
    setValue(root.querySelector(".task-add-child-criteria"), "Balance shows\n\n  Zero balance says so  \n");
    setValue(root.querySelector(".task-add-child-priority"), "high", "change");
    await act(async () => { root.querySelector(".task-add-child-submit")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

    expect(onAddChild).toHaveBeenCalledWith({
      title: "Balance check",
      parentId: "chg-1",
      type: "task",
      description: "Shoppers see their balance.",
      acceptanceCriteria: ["Balance shows", "Zero balance says so"],
      priority: "high",
    });
  });

  it("leaves criteria out when none are given", async () => {
    const { root, onAddChild } = mount(change);
    click(root.querySelector(".task-add-child-btn"));
    setValue(root.querySelector(".task-add-child-title"), "Bare task");
    await act(async () => { root.querySelector(".task-add-child-submit")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onAddChild.mock.calls[0][0]).not.toHaveProperty("acceptanceCriteria");
  });
});
