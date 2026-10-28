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

// A v2 subtask carries no priority (rex's change-add rule), so the form must
// not offer one the server would drop without a word. The tree tells the two
// layouts apart: on v2 a task sits under a change, on v1 under a feature.
describe("TaskDetail add subtask: priority only where a subtask keeps it", () => {
  function mountUnder(parent: PRDItemData, task: PRDItemData) {
    const root = document.createElement("div");
    const onAddChild = vi.fn().mockResolvedValue(undefined);
    const tree = [{ ...parent, children: [task] }] as PRDItemData[];
    act(() => { render(h(TaskDetail, { item: task, allItems: tree, onUpdate: vi.fn(), onAddChild }), root); });
    click(root.querySelector(".task-add-child-btn"));
    setValue(root.querySelector(".task-add-child-title"), "Check the button");
    click(root.querySelector(".task-add-child-more"));
    return { root, onAddChild };
  }

  it("on a v2 task, shows no priority control and sends none", async () => {
    const v2Task = { id: "t-1", title: "Wire the button", status: "pending", level: "task", type: "task" } as PRDItemData;
    const { root, onAddChild } = mountUnder(change, v2Task);
    expect(root.querySelector(".task-add-child-form")?.textContent).toContain("Add Subtask");
    expect(root.querySelector(".task-add-child-priority")).toBeNull();
    expect(root.querySelector(".task-add-child-more")?.getAttribute("title")).not.toMatch(/priority/i);
    await act(async () => { root.querySelector(".task-add-child-submit")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onAddChild).toHaveBeenCalledTimes(1);
    expect(onAddChild.mock.calls[0][0]).toMatchObject({ type: "subtask", parentId: "t-1" });
    expect(onAddChild.mock.calls[0][0].priority).toBeUndefined();
  });

  it("on a v1 task, still offers priority and sends it", async () => {
    const feature = { id: "f-1", title: "Checkout", status: "pending", level: "feature" } as PRDItemData;
    const v1Task = { id: "t-2", title: "Split the god file", status: "pending", level: "task" } as PRDItemData;
    const { root, onAddChild } = mountUnder(feature, v1Task);
    setValue(root.querySelector(".task-add-child-priority"), "high", "change");
    await act(async () => { root.querySelector(".task-add-child-submit")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onAddChild.mock.calls[0][0]).toMatchObject({ type: "subtask", parentId: "t-2", priority: "high" });
  });
});
