// @vitest-environment jsdom
/**
 * The Prioritized toggle under a change's (a v1 epic's) priority: it sets and
 * clears the flag through onUpdate, and no other item type shows it.
 *
 * @see src/viewer/components/prd-tree/task-detail.ts
 */
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { TaskDetail } from "../../../src/viewer/components/prd-tree/task-detail.js";
import type { PRDItemData } from "../../../src/viewer/components/prd-tree/types.js";

function mount(item: PRDItemData, onUpdate = vi.fn()): HTMLDivElement {
  const root = document.createElement("div");
  act(() => { render(h(TaskDetail, { item, allItems: [item], onUpdate }), root); });
  return root;
}

const toggle = (root: HTMLElement) => root.querySelector<HTMLInputElement>(".task-prioritized-toggle input");

function click(el: HTMLInputElement) {
  act(() => {
    el.checked = !el.checked;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

describe("TaskDetail prioritized toggle", () => {
  it("sets the flag on an unflagged epic", () => {
    const onUpdate = vi.fn();
    const root = mount({ id: "e1", title: "Epic", status: "pending", level: "epic" }, onUpdate);
    const box = toggle(root)!;
    expect(box.checked).toBe(false);
    click(box);
    expect(onUpdate).toHaveBeenCalledWith("e1", { prioritized: true });
  });

  it("clears it with false on a flagged epic", () => {
    const onUpdate = vi.fn();
    const root = mount({ id: "e1", title: "Epic", status: "pending", level: "epic", prioritized: true }, onUpdate);
    const box = toggle(root)!;
    expect(box.checked).toBe(true);
    click(box);
    expect(onUpdate).toHaveBeenCalledWith("e1", { prioritized: false });
  });

  it("is absent on a task", () => {
    expect(toggle(mount({ id: "t1", title: "Task", status: "pending", level: "task" }))).toBeNull();
  });
});
