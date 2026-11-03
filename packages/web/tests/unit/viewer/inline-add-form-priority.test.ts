// @vitest-environment jsdom
/**
 * The tree's inline "+" add form offers and sends a priority only for a child
 * that keeps one: a v2 subtask (under a task whose parent is a change)
 * carries none, a v1 subtask (under a task in a feature) does.
 */
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { InlineAddForm } from "../../../src/viewer/components/prd-tree/inline-add-form.js";
import type { ItemType } from "../../../src/viewer/external.js";

function mount(grandparentType: ItemType | null) {
  const root = document.createElement("div");
  const onSubmit = vi.fn().mockResolvedValue(undefined);
  act(() => {
    render(h(InlineAddForm, { parentType: "task", parentId: "task-1", grandparentType, depth: 1, onSubmit, onCancel: vi.fn() }), root);
  });
  return { root, onSubmit };
}

function setValue(el: Element | null, value: string, event = "input") {
  if (!el) throw new Error("element missing");
  act(() => {
    (el as HTMLInputElement).value = value;
    el.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

async function openExtraAndSubmit(root: HTMLElement, priority?: string) {
  setValue(root.querySelector(".prd-inline-add-title"), "Wire the callback");
  act(() => { root.querySelector(".prd-inline-add-more")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  if (priority) setValue(root.querySelector(".prd-inline-add-priority"), priority, "change");
  await act(async () => { root.querySelector(".prd-inline-add-submit")!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
}

describe("InlineAddForm priority", () => {
  it("offers no priority for a subtask under a v2 task, and sends none", async () => {
    const { root, onSubmit } = mount("change");
    await openExtraAndSubmit(root);
    expect(root.querySelector(".prd-inline-add-priority")).toBeNull();
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: "subtask", title: "Wire the callback" }));
    expect(onSubmit.mock.calls[0][0].priority).toBeUndefined();
  });

  it("keeps the priority for a subtask under a v1 task", async () => {
    const { root, onSubmit } = mount("feature");
    await openExtraAndSubmit(root, "high");
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ type: "subtask", priority: "high" }));
  });
});
