// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

const item = (overrides: Partial<PRDItemData> = {}): PRDItemData => ({
  id: "task-1",
  title: "Add the Apple Pay button to the Safari checkout",
  status: "pending",
  level: "task",
  ...overrides,
});

function mount(props: { item: PRDItemData; allItems?: PRDItemData[]; onUpdate?: (id: string, u: Partial<PRDItemData>) => void }) {
  const root = document.createElement("div");
  act(() => { render(h(TaskDetail, { allItems: [props.item], ...props }), root); });
  return root;
}

function click(el: Element | null) {
  act(() => { el?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

function type(el: Element | null, value: string, key = "Enter") {
  act(() => {
    (el as HTMLInputElement).value = value;
    el!.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => { el!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });
}

describe("TaskDetail short title", () => {
  it("keeps the full title as the heading and shows the short title beside it", () => {
    const root = mount({ item: item({ shortTitle: "Apple Pay button" }), onUpdate: vi.fn() });
    expect(root.querySelector(".task-title-display")?.textContent).toContain("Add the Apple Pay button to the Safari checkout");
    expect(root.querySelector(".task-short-title")?.textContent).toContain("Apple Pay button");
  });

  it("adds a short title through onUpdate", () => {
    const onUpdate = vi.fn();
    const root = mount({ item: item(), onUpdate });
    click(root.querySelector(".task-add-short-title-btn"));
    type(root.querySelector(".task-short-title-input"), "  Apple Pay button ");
    expect(onUpdate).toHaveBeenCalledWith("task-1", { shortTitle: "Apple Pay button" });
  });

  it("clears the short title with an empty value", () => {
    const onUpdate = vi.fn();
    const root = mount({ item: item({ shortTitle: "Apple Pay button" }), onUpdate });
    click(root.querySelector(".task-short-title.editable"));
    type(root.querySelector(".task-short-title-input"), "");
    expect(onUpdate).toHaveBeenCalledWith("task-1", { shortTitle: "" });
  });

  it("Escape leaves it unchanged", () => {
    const onUpdate = vi.fn();
    const root = mount({ item: item({ shortTitle: "Apple Pay button" }), onUpdate });
    click(root.querySelector(".task-short-title.editable"));
    type(root.querySelector(".task-short-title-input"), "Other", "Escape");
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it("is read-only, and absent when unset, without onUpdate", () => {
    expect(mount({ item: item({ shortTitle: "Apple Pay button" }) }).querySelector(".task-short-title.editable")).toBeNull();
    expect(mount({ item: item() }).querySelector(".task-short-title-section")).toBeNull();
  });

  it("names children by their short title, with the full title as the tooltip", () => {
    const child = item({ id: "sub-1", level: "subtask", title: "Render the button only on Safari", shortTitle: "Safari only" });
    const parent = item({ children: [child] });
    const root = mount({ item: parent, allItems: [parent] });
    const name = root.querySelector(".task-child-title");
    expect(name?.textContent).toBe("Safari only");
    expect(name?.getAttribute("title")).toBe("Render the button only on Safari");
  });
});
